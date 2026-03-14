import { randomUUID } from 'node:crypto';
import type { RunStatus, CodeTaskStatus, RunMode, RunScopeType } from '@zarb/shared-types';
import type { Db, RunRow, CodeTaskRow } from '@zarb/storage';
import { RunRepository, CodeTaskRepository } from '@zarb/storage';
import { RunEventWriter } from '@zarb/event-store';
import {
  assertRunTransition,
  isRunTerminal,
  PAUSABLE_RUN_STATUSES,
  CANCELLABLE_RUN_STATUSES,
} from './run-transitions.js';
import { assertCodeTaskTransition, isCodeTaskTerminal } from './code-task-transitions.js';
import { computeTimeoutAt, isTimedOut, DEFAULT_TIMEOUT_BUDGETS } from './timeout-policy.js';
import type { TimeoutBudgets, TimeoutStage } from './timeout-policy.js';

export interface OrchestratorOptions {
  timeoutBudgets?: TimeoutBudgets;
}

export interface StartRunInput {
  runId?: string;
  runMode: RunMode;
  scopeType?: RunScopeType;
  scopeValue?: string;
  workspacePath: string;
  explorationConfigJson?: string;
}

export interface CreateCodeTaskInput {
  taskId?: string;
  runId: string;
  parentTaskId?: string;
  testcaseId?: string;
  goal: string;
  workspacePath: string;
}

export class Orchestrator {
  private readonly runs: RunRepository;
  private readonly tasks: CodeTaskRepository;
  private readonly events: RunEventWriter;
  private readonly budgets: TimeoutBudgets;

  constructor(db: Db, opts: OrchestratorOptions = {}) {
    this.runs = new RunRepository(db);
    this.tasks = new CodeTaskRepository(db);
    this.events = new RunEventWriter(db);
    this.budgets = opts.timeoutBudgets ?? DEFAULT_TIMEOUT_BUDGETS;
  }

  // ---------------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------------

  startRun(input: StartRunInput): RunRow {
    const runId = input.runId ?? randomUUID();
    const now = new Date().toISOString();
    const firstStage: RunStatus = input.runMode === 'exploration' ? 'PLANNING_EXPLORATION' : 'RUNNING_TESTS';
    const firstTimeoutStage = toRunTimeoutStage(firstStage);
    const timeoutAt = firstTimeoutStage ? computeTimeoutAt(firstTimeoutStage, new Date(), this.budgets) : undefined;

    this.runs.create({
      runId,
      scopeType: input.scopeType ?? 'suite',
      ...(input.scopeValue ? { scopeValue: input.scopeValue } : {}),
      runMode: input.runMode,
      workspacePath: input.workspacePath,
      ...(input.explorationConfigJson ? { explorationConfigJson: input.explorationConfigJson } : {}),
      ...(timeoutAt ? { timeoutAt } : {}),
      startedAt: now,
    });

    this.runs.update(runId, { status: firstStage, currentStage: firstStage, updatedAt: now });
    this.appendRunEvent(runId, 'RUN_CREATED', 'run', runId, { runMode: input.runMode });
    this.appendRunEvent(runId, 'RUN_STARTED', 'run', runId, { stage: firstStage });
    return this.requireRun(runId);
  }

  advanceRun(runId: string, to: RunStatus): RunRow {
    const run = this.requireRun(runId);
    assertRunTransition(run.status, to);
    const now = new Date();
    const nowIso = now.toISOString();

    const update: Parameters<RunRepository['update']>[1] = { status: to, currentStage: to, updatedAt: nowIso };
    const timeoutStage = toRunTimeoutStage(to);
    if (timeoutStage) update.timeoutAt = computeTimeoutAt(timeoutStage, now, this.budgets);
    if (isRunTerminal(to)) update.endedAt = nowIso;
    if (run.status === 'PAUSED') update.pausedAt = null;

    this.runs.update(runId, update);
    this.appendRunEvent(runId, runEventForStatus(to), 'run', runId, { from: run.status, to });
    return this.requireRun(runId);
  }

  /**
   * pauseRun — safe-point pause model.
   * Only sets pauseRequested=true. The actual PAUSED transition happens
   * when the active step calls commitPause() at its safe point.
   */
  pauseRun(runId: string): RunRow {
    const run = this.requireRun(runId);
    if (!PAUSABLE_RUN_STATUSES.has(run.status)) {
      throw new Error(`Run ${runId} cannot be paused from status ${run.status}`);
    }
    this.runs.update(runId, { pauseRequested: true, updatedAt: new Date().toISOString() });
    return this.requireRun(runId);
  }

  /**
   * commitPause — called by the active step at its safe point when it detects
   * pauseRequested=true. Transitions the Run to PAUSED and records pausedAt.
   */
  commitPause(runId: string): RunRow {
    const run = this.requireRun(runId);
    if (!run.pause_requested) {
      throw new Error(`Run ${runId} has no pending pause request`);
    }
    assertRunTransition(run.status, 'PAUSED');
    const now = new Date().toISOString();
    this.runs.update(runId, {
      status: 'PAUSED',
      currentStage: run.status,  // remember where we paused
      pausedAt: now,
      pauseRequested: false,
      updatedAt: now,
    });
    this.appendRunEvent(runId, 'RUN_PAUSED', 'run', runId, { pausedAtStage: run.status });
    return this.requireRun(runId);
  }

  resumeRun(runId: string): RunRow {
    const run = this.requireRun(runId);
    if (run.status !== 'PAUSED') {
      throw new Error(`Run ${runId} is not paused (status: ${run.status})`);
    }
    const resumeTarget = (run.current_stage ?? 'RUNNING_TESTS') as RunStatus;
    assertRunTransition('PAUSED', resumeTarget);
    const now = new Date().toISOString();
    this.runs.update(runId, { status: resumeTarget, pauseRequested: false, pausedAt: null, updatedAt: now });
    this.appendRunEvent(runId, 'RUN_RESUMED', 'run', runId, { resumedToStage: resumeTarget });
    return this.requireRun(runId);
  }

  cancelRun(runId: string): RunRow {
    const run = this.requireRun(runId);
    if (!CANCELLABLE_RUN_STATUSES.has(run.status)) {
      throw new Error(`Run ${runId} cannot be cancelled from status ${run.status}`);
    }
    const now = new Date().toISOString();
    this.runs.update(runId, { status: 'CANCELLED', endedAt: now, updatedAt: now });
    this.appendRunEvent(runId, 'RUN_CANCELLED', 'run', runId, { from: run.status });
    return this.requireRun(runId);
  }

  checkRunTimeout(runId: string): boolean {
    return isTimedOut(this.requireRun(runId).timeout_at, new Date());
  }

  // ---------------------------------------------------------------------------
  // CodeTask lifecycle
  // ---------------------------------------------------------------------------

  createCodeTask(input: CreateCodeTaskInput): CodeTaskRow {
    const taskId = input.taskId ?? randomUUID();
    const now = new Date().toISOString();
    this.tasks.create({
      taskId,
      runId: input.runId,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.testcaseId ? { testcaseId: input.testcaseId } : {}),
      goal: input.goal,
      workspacePath: input.workspacePath,
      createdAt: now,
    });
    this.appendRunEvent(input.runId, 'CODE_TASK_CREATED', 'code_task', taskId, { taskId });
    this.recomputeRunStatus(input.runId);
    return this.requireTask(taskId);
  }

  advanceCodeTask(taskId: string, to: CodeTaskStatus): CodeTaskRow {
    const task = this.requireTask(taskId);
    assertCodeTaskTransition(task.status, to);
    const now = new Date();
    const nowIso = now.toISOString();

    const update: Parameters<CodeTaskRepository['update']>[1] = { status: to, updatedAt: nowIso };

    // Write CodeTask-level timeout_at for active execution stages
    const codeTaskTimeoutStage = toCodeTaskTimeoutStage(to);
    if (codeTaskTimeoutStage) {
      update.timeoutAt = computeTimeoutAt(codeTaskTimeoutStage, now, this.budgets);
    }

    this.tasks.update(taskId, update);
    this.appendRunEvent(task.run_id, codeTaskEventForStatus(to), 'code_task', taskId, { from: task.status, to });
    this.recomputeRunStatus(task.run_id);
    return this.requireTask(taskId);
  }

  approveCodeTask(taskId: string): CodeTaskRow {
    return this.advanceCodeTask(taskId, 'APPROVED');
  }

  rejectCodeTask(taskId: string): CodeTaskRow {
    const task = this.requireTask(taskId);
    if (task.status !== 'PENDING_APPROVAL' && task.status !== 'SUCCEEDED') {
      throw new Error(`CodeTask ${taskId} cannot be rejected from status ${task.status}`);
    }
    return this.advanceCodeTask(taskId, 'REJECTED');
  }

  cancelCodeTask(taskId: string): CodeTaskRow {
    const task = this.requireTask(taskId);
    if (isCodeTaskTerminal(task.status)) {
      throw new Error(`CodeTask ${taskId} is already terminal (${task.status})`);
    }
    return this.advanceCodeTask(taskId, 'CANCELLED');
  }

  retryCodeTask(taskId: string, goal?: string): CodeTaskRow {
    const original = this.requireTask(taskId);
    const childId = randomUUID();
    const now = new Date().toISOString();
    this.tasks.create({
      taskId: childId,
      runId: original.run_id,
      parentTaskId: taskId,
      ...(original.testcase_id ? { testcaseId: original.testcase_id } : {}),
      goal: goal ?? original.goal,
      workspacePath: original.workspace_path,
      attempt: original.attempt + 1,
      createdAt: now,
    });
    this.appendRunEvent(original.run_id, 'CODE_TASK_CREATED', 'code_task', childId, {
      taskId: childId, parentTaskId: taskId, attempt: original.attempt + 1,
    });
    this.recomputeRunStatus(original.run_id);
    return this.requireTask(childId);
  }

  /** Check if a CodeTask has exceeded its own timeout_at. */
  checkCodeTaskTimeout(taskId: string): boolean {
    return isTimedOut(this.requireTask(taskId).timeout_at, new Date());
  }

  // ---------------------------------------------------------------------------
  // Multi-CodeTask aggregation
  // ---------------------------------------------------------------------------

  /**
   * Recompute Run status from the aggregate view of all its CodeTasks.
   * Called after any CodeTask state change.
   *
   * Rules (from orchestrator-design.md §7.2):
   * - Any RUNNING task → Run stays RUNNING_CODE_TASK
   * - Any SUCCEEDED/COMMIT_PENDING task (no running) → AWAITING_REVIEW
   * - Any PENDING_APPROVAL/APPROVED/DRAFT task (no running, no awaiting review) → AWAITING_CODE_ACTION
   * - All tasks terminal → READY_TO_COMMIT if any COMMIT_PENDING, else COMPLETED
   * - Only applies when Run is in a code-task coordination stage
   */
  recomputeRunStatus(runId: string): void {
    const run = this.requireRun(runId);
    const CODE_TASK_STAGES: ReadonlySet<RunStatus> = new Set([
      'AWAITING_CODE_ACTION', 'RUNNING_CODE_TASK', 'AWAITING_REVIEW', 'READY_TO_COMMIT', 'COMPLETED',
    ]);
    // Only recompute when run is in a code-task coordination stage
    if (!CODE_TASK_STAGES.has(run.status) && run.status !== 'ANALYZING_FAILURES') return;

    const allTasks = this.tasks.list({ runId }).items;
    if (allTasks.length === 0) return;

    const statuses = allTasks.map((t) => t.status);
    const has = (s: CodeTaskStatus) => statuses.includes(s);

    let newStatus: RunStatus;

    if (has('RUNNING') || has('VERIFYING')) {
      newStatus = 'RUNNING_CODE_TASK';
    } else if (has('COMMIT_PENDING')) {
      newStatus = 'READY_TO_COMMIT';
    } else if (has('SUCCEEDED')) {
      newStatus = 'AWAITING_REVIEW';
    } else if (has('DRAFT') || has('PENDING_APPROVAL') || has('APPROVED')) {
      newStatus = 'AWAITING_CODE_ACTION';
    } else {
      // All tasks are terminal (COMMITTED / REJECTED / CANCELLED / FAILED)
      newStatus = 'COMPLETED';
    }

    if (newStatus !== run.status) {
      const now = new Date().toISOString();
      this.runs.update(runId, { status: newStatus, currentStage: newStatus, updatedAt: now });
      this.appendRunEvent(runId, runEventForStatus(newStatus), 'run', runId, { aggregated: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private requireRun(runId: string): RunRow {
    const row = this.runs.findById(runId);
    if (!row) throw new Error(`Run not found: ${runId}`);
    return row;
  }

  private requireTask(taskId: string): CodeTaskRow {
    const row = this.tasks.findById(taskId);
    if (!row) throw new Error(`CodeTask not found: ${taskId}`);
    return row;
  }

  private appendRunEvent(
    runId: string,
    eventType: Parameters<RunEventWriter['append']>[0]['eventType'],
    entityType: string,
    entityId: string,
    payload?: Record<string, unknown>,
  ): void {
    const input: Parameters<RunEventWriter['append']>[0] = {
      id: randomUUID(), runId, entityType, entityId, eventType,
      createdAt: new Date().toISOString(),
    };
    if (payload) input.payloadJson = JSON.stringify(payload);
    this.events.append(input);
  }
}

// ---------------------------------------------------------------------------
// Stage → timeout mapping helpers
// ---------------------------------------------------------------------------

function toRunTimeoutStage(status: RunStatus): TimeoutStage | undefined {
  const map: Partial<Record<RunStatus, TimeoutStage>> = {
    RUNNING_TESTS: 'RUNNING_TESTS',
    FETCHING_TRACES: 'FETCHING_TRACES',
    FETCHING_LOGS: 'FETCHING_LOGS',
    ANALYZING_FAILURES: 'ANALYZING_FAILURES',
    RUNNING_EXPLORATION: 'RUNNING_EXPLORATION',
  };
  return map[status];
}

function toCodeTaskTimeoutStage(status: CodeTaskStatus): TimeoutStage | undefined {
  const map: Partial<Record<CodeTaskStatus, TimeoutStage>> = {
    RUNNING: 'RUNNING',
    VERIFYING: 'VERIFYING',
  };
  return map[status];
}

function runEventForStatus(status: RunStatus): Parameters<RunEventWriter['append']>[0]['eventType'] {
  const map: Partial<Record<RunStatus, Parameters<RunEventWriter['append']>[0]['eventType']>> = {
    COMPLETED: 'RUN_COMPLETED',
    FAILED: 'RUN_STEP_DEGRADED',
    CANCELLED: 'RUN_CANCELLED',
    PAUSED: 'RUN_PAUSED',
  };
  return map[status] ?? 'RUN_STARTED';
}

function codeTaskEventForStatus(status: CodeTaskStatus): Parameters<RunEventWriter['append']>[0]['eventType'] {
  const map: Partial<Record<CodeTaskStatus, Parameters<RunEventWriter['append']>[0]['eventType']>> = {
    APPROVED: 'CODE_TASK_APPROVED',
    REJECTED: 'CODE_TASK_REJECTED',
    RUNNING: 'CODE_TASK_STARTED',
    SUCCEEDED: 'VERIFY_COMPLETED',
    COMMIT_PENDING: 'REVIEW_ACCEPTED',
    COMMITTED: 'COMMIT_CREATED',
    CANCELLED: 'RUN_CANCELLED',
    FAILED: 'RUN_STEP_DEGRADED',
  };
  return map[status] ?? 'CODE_TASK_STARTED';
}
