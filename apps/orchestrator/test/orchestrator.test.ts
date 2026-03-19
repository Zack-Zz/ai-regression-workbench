import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { openDb, runMigrations } from '@zarb/storage';
import { deriveRunStatusFromCodeTasks, isRunInCodeTaskCoordinationStage } from '@zarb/shared-types';
import { Orchestrator } from '../src/orchestrator.js';
import { isRunTransitionAllowed, PAUSABLE_RUN_STATUSES, CANCELLABLE_RUN_STATUSES } from '../src/run-transitions.js';
import { isCodeTaskTransitionAllowed } from '../src/code-task-transitions.js';
import { computeTimeoutAt, isTimedOut, DEFAULT_TIMEOUT_BUDGETS } from '../src/timeout-policy.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-orch-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  return () => { rmSync(dir, { recursive: true, force: true }); };
});

function makeOrch() {
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return new Orchestrator(db);
}

// ---------------------------------------------------------------------------
// Run transition table
// ---------------------------------------------------------------------------

describe('isRunTransitionAllowed', () => {
  it('allows CREATED -> RUNNING_TESTS', () => {
    expect(isRunTransitionAllowed('CREATED', 'RUNNING_TESTS')).toBe(true);
  });
  it('allows CREATED -> PLANNING_EXPLORATION', () => {
    expect(isRunTransitionAllowed('CREATED', 'PLANNING_EXPLORATION')).toBe(true);
  });
  it('rejects COMPLETED -> RUNNING_TESTS', () => {
    expect(isRunTransitionAllowed('COMPLETED', 'RUNNING_TESTS')).toBe(false);
  });
  it('rejects FAILED -> CANCELLED', () => {
    expect(isRunTransitionAllowed('FAILED', 'CANCELLED')).toBe(false);
  });
  it('allows any pausable status -> PAUSED', () => {
    for (const s of PAUSABLE_RUN_STATUSES) {
      expect(isRunTransitionAllowed(s, 'PAUSED'), `${s} -> PAUSED`).toBe(true);
    }
  });
  it('allows any cancellable status -> CANCELLED', () => {
    for (const s of CANCELLABLE_RUN_STATUSES) {
      expect(isRunTransitionAllowed(s, 'CANCELLED'), `${s} -> CANCELLED`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CodeTask transition table
// ---------------------------------------------------------------------------

describe('isCodeTaskTransitionAllowed', () => {
  it('allows DRAFT -> PENDING_APPROVAL', () => {
    expect(isCodeTaskTransitionAllowed('DRAFT', 'PENDING_APPROVAL')).toBe(true);
  });
  it('allows DRAFT -> APPROVED for direct approval flows', () => {
    expect(isCodeTaskTransitionAllowed('DRAFT', 'APPROVED')).toBe(true);
  });
  it('allows SUCCEEDED -> COMMIT_PENDING (review accept)', () => {
    expect(isCodeTaskTransitionAllowed('SUCCEEDED', 'COMMIT_PENDING')).toBe(true);
  });
  it('allows SUCCEEDED -> REJECTED (review reject)', () => {
    expect(isCodeTaskTransitionAllowed('SUCCEEDED', 'REJECTED')).toBe(true);
  });
  it('rejects COMMITTED -> RUNNING', () => {
    expect(isCodeTaskTransitionAllowed('COMMITTED', 'RUNNING')).toBe(false);
  });
});

describe('shared lifecycle helpers', () => {
  it('derives READY_TO_COMMIT before AWAITING_REVIEW when commit-pending tasks exist', () => {
    expect(deriveRunStatusFromCodeTasks(['SUCCEEDED', 'COMMIT_PENDING'])).toBe('READY_TO_COMMIT');
  });

  it('treats ANALYZING_FAILURES as a code-task coordination stage', () => {
    expect(isRunInCodeTaskCoordinationStage('ANALYZING_FAILURES')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TimeoutPolicy
// ---------------------------------------------------------------------------

describe('TimeoutPolicy', () => {
  it('computeTimeoutAt returns correct deadline', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const result = computeTimeoutAt('ANALYZING_FAILURES', now, DEFAULT_TIMEOUT_BUDGETS);
    expect(new Date(result).getTime()).toBe(now.getTime() + DEFAULT_TIMEOUT_BUDGETS.aiAnalysisMs);
  });

  it('isTimedOut returns false before deadline', () => {
    expect(isTimedOut(new Date(Date.now() + 60_000).toISOString(), new Date())).toBe(false);
  });

  it('isTimedOut returns true after deadline', () => {
    expect(isTimedOut(new Date(Date.now() - 1).toISOString(), new Date())).toBe(true);
  });

  it('isTimedOut returns false for null/undefined', () => {
    expect(isTimedOut(null, new Date())).toBe(false);
    expect(isTimedOut(undefined, new Date())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

describe('Orchestrator.startRun', () => {
  it('creates run in RUNNING_TESTS for regression', () => {
    const run = makeOrch().startRun({ runMode: 'regression', workspacePath: '/ws' });
    expect(run.status).toBe('RUNNING_TESTS');
    expect(run.timeout_at).toBeTruthy();
  });

  it('creates run in PLANNING_EXPLORATION for exploration (no timeout_at)', () => {
    const run = makeOrch().startRun({ runMode: 'exploration', workspacePath: '/ws' });
    expect(run.status).toBe('PLANNING_EXPLORATION');
    // PLANNING_EXPLORATION has no timeout budget
    expect(run.timeout_at).toBeNull();
  });

  it('emits RUN_CREATED and RUN_STARTED events', () => {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, MIGRATIONS_DIR);
    const run = new Orchestrator(db).startRun({ runMode: 'regression', workspacePath: '/ws' });
    const types = (db.prepare('SELECT event_type FROM run_events WHERE run_id = ?').all(run.run_id) as { event_type: string }[]).map((e) => e.event_type);
    expect(types).toContain('RUN_CREATED');
    expect(types).toContain('RUN_STARTED');
  });
});

describe('Orchestrator.advanceRun', () => {
  it('advances through valid stages', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    expect(orch.advanceRun(run.run_id, 'COLLECTING_ARTIFACTS').status).toBe('COLLECTING_ARTIFACTS');
  });

  it('throws on invalid transition', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    expect(() => orch.advanceRun(run.run_id, 'COMMITTED' as never)).toThrow(/Invalid Run transition/);
  });

  it('sets endedAt on terminal transition', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    orch.advanceRun(run.run_id, 'COLLECTING_ARTIFACTS');
    orch.advanceRun(run.run_id, 'FETCHING_TRACES');
    orch.advanceRun(run.run_id, 'FETCHING_LOGS');
    orch.advanceRun(run.run_id, 'ANALYZING_FAILURES');
    expect(orch.advanceRun(run.run_id, 'COMPLETED').ended_at).toBeTruthy();
  });

  it('writes timeout_at for timed stages', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    orch.advanceRun(run.run_id, 'COLLECTING_ARTIFACTS');
    expect(orch.advanceRun(run.run_id, 'FETCHING_TRACES').timeout_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Safe-point pause model
// ---------------------------------------------------------------------------

describe('Orchestrator.pauseRun — safe-point model', () => {
  it('pauseRun only sets pauseRequested, does NOT change status', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const after = orch.pauseRun(run.run_id);
    expect(after.pause_requested).toBe(1);
    expect(after.status).toBe('RUNNING_TESTS'); // status unchanged
    expect(after.paused_at).toBeNull();
  });

  it('commitPause transitions to PAUSED and records pausedAt', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    orch.pauseRun(run.run_id);
    const paused = orch.commitPause(run.run_id);
    expect(paused.status).toBe('PAUSED');
    expect(paused.paused_at).toBeTruthy();
    expect(paused.pause_requested).toBe(0);
    expect(paused.current_stage).toBe('RUNNING_TESTS'); // remembers where we paused
  });

  it('commitPause throws when no pause request pending', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    expect(() => orch.commitPause(run.run_id)).toThrow(/no pending pause/);
  });

  it('resumeRun restores to the stage stored in current_stage', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    orch.pauseRun(run.run_id);
    orch.commitPause(run.run_id);
    const resumed = orch.resumeRun(run.run_id);
    expect(resumed.status).toBe('RUNNING_TESTS');
    expect(resumed.paused_at).toBeNull();
  });

  it('pauseRun throws when run is terminal', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    orch.cancelRun(run.run_id);
    expect(() => orch.pauseRun(run.run_id)).toThrow(/cannot be paused/);
  });
});

describe('Orchestrator.cancelRun', () => {
  it('cancels an active run', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const cancelled = orch.cancelRun(run.run_id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.ended_at).toBeTruthy();
  });

  it('throws when cancelling a completed run', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    orch.advanceRun(run.run_id, 'COLLECTING_ARTIFACTS');
    orch.advanceRun(run.run_id, 'FETCHING_TRACES');
    orch.advanceRun(run.run_id, 'FETCHING_LOGS');
    orch.advanceRun(run.run_id, 'ANALYZING_FAILURES');
    orch.advanceRun(run.run_id, 'COMPLETED');
    expect(() => orch.cancelRun(run.run_id)).toThrow(/cannot be cancelled/);
  });
});

// ---------------------------------------------------------------------------
// CodeTask lifecycle + independent timeout_at
// ---------------------------------------------------------------------------

describe('CodeTask lifecycle', () => {
  it('creates in DRAFT status', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    expect(task.status).toBe('DRAFT');
    expect(task.attempt).toBe(1);
  });

  it('writes timeout_at when advancing to RUNNING', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    const running = orch.advanceCodeTask(task.task_id, 'RUNNING');
    expect(running.timeout_at).toBeTruthy();
  });

  it('writes timeout_at when advancing to VERIFYING', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    orch.advanceCodeTask(task.task_id, 'RUNNING');
    const verifying = orch.advanceCodeTask(task.task_id, 'VERIFYING');
    expect(verifying.timeout_at).toBeTruthy();
  });

  it('checkCodeTaskTimeout uses task own timeout_at', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    // No timeout_at set yet (DRAFT) → not timed out
    expect(orch.checkCodeTaskTimeout(task.task_id)).toBe(false);
  });

  it('rejects from PENDING_APPROVAL', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    expect(orch.rejectCodeTask(task.task_id).status).toBe('REJECTED');
  });

  it('throws on invalid transition', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    expect(() => orch.advanceCodeTask(task.task_id, 'COMMITTED')).toThrow(/Invalid CodeTask transition/);
  });
});

// ---------------------------------------------------------------------------
// retryCodeTask
// ---------------------------------------------------------------------------

describe('Orchestrator.retryCodeTask', () => {
  it('creates child with parentTaskId and incremented attempt', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const original = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    const child = orch.retryCodeTask(original.task_id);
    expect(child.parent_task_id).toBe(original.task_id);
    expect(child.attempt).toBe(original.attempt + 1);
    expect(child.status).toBe('DRAFT');
    expect(original.status).toBe('DRAFT'); // original NOT mutated
  });

  it('child can override goal', () => {
    const orch = makeOrch();
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    const original = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    expect(orch.retryCodeTask(original.task_id, 'new approach').goal).toBe('new approach');
  });
});

// ---------------------------------------------------------------------------
// Multi-CodeTask aggregation
// ---------------------------------------------------------------------------

describe('recomputeRunStatus — multi-CodeTask aggregation', () => {
  function setupRunAtCodeAction(orch: Orchestrator) {
    const run = orch.startRun({ runMode: 'regression', workspacePath: '/ws' });
    // Advance run to AWAITING_CODE_ACTION
    orch.advanceRun(run.run_id, 'COLLECTING_ARTIFACTS');
    orch.advanceRun(run.run_id, 'FETCHING_TRACES');
    orch.advanceRun(run.run_id, 'FETCHING_LOGS');
    orch.advanceRun(run.run_id, 'ANALYZING_FAILURES');
    orch.advanceRun(run.run_id, 'AWAITING_CODE_ACTION');
    return run;
  }

  it('Run moves to RUNNING_CODE_TASK when a task enters RUNNING', () => {
    const orch = makeOrch();
    const run = setupRunAtCodeAction(orch);
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    orch.advanceCodeTask(task.task_id, 'RUNNING');
    const updated = orch.checkRunTimeout(run.run_id); // just to get run state
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, MIGRATIONS_DIR);
    // Re-read run status from the same DB
    const runRow = (db.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(run.run_id) as { status: string } | undefined);
    // The orch already updated it — check via a fresh orch on same db
    const db2 = openDb(join(dir, 'test.db'));
    runMigrations(db2, MIGRATIONS_DIR);
    const orch2 = new Orchestrator(db2);
    const task2 = orch2.createCodeTask({ runId: run.run_id, goal: 'fix2', workspacePath: '/ws' });
    void task2; void updated; void runRow;
    // Verify via direct DB query on original orch's db
    const orch3 = makeOrch();
    const run3 = setupRunAtCodeAction(orch3);
    const t3 = orch3.createCodeTask({ runId: run3.run_id, goal: 'fix', workspacePath: '/ws' });
    orch3.advanceCodeTask(t3.task_id, 'PENDING_APPROVAL');
    orch3.approveCodeTask(t3.task_id);
    orch3.advanceCodeTask(t3.task_id, 'RUNNING');
    // recomputeRunStatus was called inside advanceCodeTask
    const db3 = openDb(join(dir, 'test.db'));
    runMigrations(db3, MIGRATIONS_DIR);
    const status = (db3.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(run3.run_id) as { status: string } | undefined)?.status;
    expect(status).toBe('RUNNING_CODE_TASK');
  });

  it('Run moves to AWAITING_REVIEW when task reaches SUCCEEDED', () => {
    const orch = makeOrch();
    const run = setupRunAtCodeAction(orch);
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    orch.advanceCodeTask(task.task_id, 'RUNNING');
    orch.advanceCodeTask(task.task_id, 'VERIFYING');
    orch.advanceCodeTask(task.task_id, 'SUCCEEDED');
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, MIGRATIONS_DIR);
    const status = (db.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(run.run_id) as { status: string } | undefined)?.status;
    expect(status).toBe('AWAITING_REVIEW');
  });

  it('Run moves to READY_TO_COMMIT when task reaches COMMIT_PENDING', () => {
    const orch = makeOrch();
    const run = setupRunAtCodeAction(orch);
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    orch.advanceCodeTask(task.task_id, 'RUNNING');
    orch.advanceCodeTask(task.task_id, 'VERIFYING');
    orch.advanceCodeTask(task.task_id, 'SUCCEEDED');
    orch.advanceCodeTask(task.task_id, 'COMMIT_PENDING'); // review accept
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, MIGRATIONS_DIR);
    const status = (db.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(run.run_id) as { status: string } | undefined)?.status;
    expect(status).toBe('READY_TO_COMMIT');
  });

  it('Run moves to COMPLETED when all tasks are terminal (COMMITTED)', () => {
    const orch = makeOrch();
    const run = setupRunAtCodeAction(orch);
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    orch.advanceCodeTask(task.task_id, 'RUNNING');
    orch.advanceCodeTask(task.task_id, 'VERIFYING');
    orch.advanceCodeTask(task.task_id, 'SUCCEEDED');
    orch.advanceCodeTask(task.task_id, 'COMMIT_PENDING');
    orch.advanceCodeTask(task.task_id, 'COMMITTED');
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, MIGRATIONS_DIR);
    const status = (db.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(run.run_id) as { status: string } | undefined)?.status;
    expect(status).toBe('COMPLETED');
  });

  it('Run stays AWAITING_CODE_ACTION when retry creates new DRAFT task', () => {
    const orch = makeOrch();
    const run = setupRunAtCodeAction(orch);
    const task = orch.createCodeTask({ runId: run.run_id, goal: 'fix', workspacePath: '/ws' });
    orch.advanceCodeTask(task.task_id, 'PENDING_APPROVAL');
    orch.approveCodeTask(task.task_id);
    orch.advanceCodeTask(task.task_id, 'RUNNING');
    orch.advanceCodeTask(task.task_id, 'VERIFYING');
    orch.advanceCodeTask(task.task_id, 'SUCCEEDED');
    orch.rejectCodeTask(task.task_id); // review reject
    orch.retryCodeTask(task.task_id);  // creates new DRAFT child
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, MIGRATIONS_DIR);
    const status = (db.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(run.run_id) as { status: string } | undefined)?.status;
    expect(status).toBe('AWAITING_CODE_ACTION');
  });
});
