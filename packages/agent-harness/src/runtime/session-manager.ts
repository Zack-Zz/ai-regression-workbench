import { randomUUID } from 'node:crypto';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AgentSessionKind } from '@zarb/shared-types';
import type { Db, AgentSessionRow } from '@zarb/storage';
import { AgentSessionRepository, agentContextSummaryPath, agentPromptSamplesPath, agentStepsPath, agentToolCallsPath } from '@zarb/storage';
import type { HarnessPolicy, StopConditions } from './harness-policy.js';
import type { ToolCallRecord } from './tool-registry.js';

export interface StartSessionInput {
  sessionId?: string;
  runId: string;
  taskId?: string;
  kind: AgentSessionKind;
  agentName: string;
  policy: HarnessPolicy;
  contextRefs?: Record<string, unknown>;
  dataRoot: string;
}

export interface StepRecord {
  stepIndex: number;
  description: string;
  outcome: string;
  timestamp: string;
}

export interface CheckpointData {
  checkpointId: string;
  stepIndex: number;
  timestamp: string;
  summary?: string;
}

export interface ApprovalRecord {
  approvalId: string;
  sessionId: string;
  stepIndex: number;
  toolName: string;
  requestedAt: string;
  grantedAt?: string;
  status: 'pending' | 'granted' | 'denied';
}

export interface PromptSampleRecord {
  sessionId: string;
  stepIndex: number;
  timestamp: string;
  phase: string;
  templateVersion: string;
  prompt: string;
  response?: string;
  promptContextSummary?: string;
  sampledBy: 'first-step' | 'interval' | 'forced';
  metadata?: Record<string, unknown>;
}

export interface StopConditionResult {
  shouldStop: boolean;
  reason?: string;
}

/**
 * HarnessSessionManager — manages agent session lifecycle.
 * Handles start/pause/resume/cancel, checkpoint persistence,
 * contextRefs disk write, step/tool-call trace appending,
 * approval persistence, sessionBudget enforcement, and stopConditions.
 * Derived from agent-harness-design.md §3, §5, §7, §8, §10.
 */
export class HarnessSessionManager {
  private readonly repo: AgentSessionRepository;

  constructor(private readonly db: Db) {
    this.repo = new AgentSessionRepository(db);
  }

  startSession(input: StartSessionInput): AgentSessionRow {
    const sessionId = input.sessionId ?? randomUUID();
    const now = new Date().toISOString();
    const policyJson = JSON.stringify(input.policy);
    const contextRefsJson = JSON.stringify(input.contextRefs ?? {});
    const tracePath = agentContextSummaryPath(sessionId);

    this.repo.save({
      sessionId,
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      kind: input.kind,
      agentName: input.agentName,
      status: 'running',
      policyJson,
      contextRefsJson,
      tracePath,
      startedAt: now,
      updatedAt: now,
    });

    // Persist contextRefs to disk (required for replay/eval)
    const absPath = join(input.dataRoot, tracePath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, JSON.stringify({ sessionId, contextRefs: input.contextRefs ?? {}, startedAt: now }, null, 2), 'utf8');

    return this.require(sessionId);
  }

  /**
   * commitPause — safe-point model: only called when active step is at safe point.
   * Persists checkpoint before transitioning to paused.
   */
  commitPause(sessionId: string, checkpoint: CheckpointData, dataRoot: string): AgentSessionRow {
    const session = this.require(sessionId);
    if (session.status !== 'running') {
      throw new Error(`Session ${sessionId} is not running (status: ${session.status})`);
    }
    const now = new Date().toISOString();
    this.persistCheckpoint(sessionId, checkpoint, dataRoot);
    this.repo.save({
      ...rowToInput(session),
      status: 'paused',
      checkpointId: checkpoint.checkpointId,
      updatedAt: now,
    });
    return this.require(sessionId);
  }

  resumeSession(sessionId: string): AgentSessionRow {
    const session = this.require(sessionId);
    if (session.status !== 'paused') {
      throw new Error(`Session ${sessionId} is not paused (status: ${session.status})`);
    }
    const now = new Date().toISOString();
    this.repo.save({ ...rowToInput(session), status: 'running', updatedAt: now });
    return this.require(sessionId);
  }

  cancelSession(sessionId: string): AgentSessionRow {
    const session = this.require(sessionId);
    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new Error(`Session ${sessionId} is already terminal (${session.status})`);
    }
    const now = new Date().toISOString();
    this.repo.save({ ...rowToInput(session), status: 'cancelled', endedAt: now, updatedAt: now });
    return this.require(sessionId);
  }

  completeSession(sessionId: string, summary?: string): AgentSessionRow {
    const session = this.require(sessionId);
    const now = new Date().toISOString();
    this.repo.save({
      ...rowToInput(session),
      status: 'completed',
      endedAt: now,
      updatedAt: now,
      ...(summary ? { summary } : {}),
    });
    return this.require(sessionId);
  }

  /**
   * requestApproval — transitions session to waiting-approval and persists
   * the approval request record to the trace file.
   */
  requestApproval(sessionId: string, toolName: string, stepIndex: number, dataRoot: string): ApprovalRecord {
    const session = this.require(sessionId);
    if (session.status !== 'running') {
      throw new Error(`Session ${sessionId} is not running (status: ${session.status})`);
    }
    const now = new Date().toISOString();
    const record: ApprovalRecord = {
      approvalId: randomUUID(),
      sessionId,
      stepIndex,
      toolName,
      requestedAt: now,
      status: 'pending',
    };
    this.repo.save({ ...rowToInput(session), status: 'waiting-approval', updatedAt: now });
    this.appendApprovalRecord(sessionId, record, dataRoot);
    return record;
  }

  /**
   * grantApproval — records approval grant and resumes session to running.
   */
  grantApproval(sessionId: string, approvalRecord: ApprovalRecord, dataRoot: string): ApprovalRecord {
    const session = this.require(sessionId);
    if (session.status !== 'waiting-approval') {
      throw new Error(`Session ${sessionId} is not waiting-approval (status: ${session.status})`);
    }
    const now = new Date().toISOString();
    const granted: ApprovalRecord = { ...approvalRecord, grantedAt: now, status: 'granted' };
    this.repo.save({ ...rowToInput(session), status: 'running', updatedAt: now });
    this.appendApprovalRecord(sessionId, granted, dataRoot);
    return granted;
  }

  /**
   * checkSessionBudget — returns true if the session has exceeded its sessionBudgetMs.
   * Caller should stop the session when this returns true.
   */
  checkSessionBudget(sessionId: string): boolean {
    const session = this.require(sessionId);
    if (!session.policy_json) return false;
    const policy = JSON.parse(session.policy_json) as HarnessPolicy;
    const elapsed = Date.now() - new Date(session.started_at).getTime();
    return elapsed >= policy.sessionBudgetMs;
  }

  /**
   * evaluateStopConditions — checks soft stop conditions for exploration sessions.
   * Returns { shouldStop, reason } based on current finding count and step history.
   */
  evaluateStopConditions(
    sessionId: string,
    opts: { findingCount: number; stepsSinceLastFinding: number; focusAreasCovered: boolean },
  ): StopConditionResult {
    const session = this.require(sessionId);
    if (!session.policy_json) return { shouldStop: false };
    const policy = JSON.parse(session.policy_json) as HarnessPolicy;
    const sc: StopConditions = policy.stopConditions ?? {};

    if (sc.maxFindings !== undefined && opts.findingCount >= sc.maxFindings) {
      return { shouldStop: true, reason: `maxFindings (${String(sc.maxFindings)}) reached` };
    }
    if (sc.stopWhenFocusAreasCovered && opts.focusAreasCovered) {
      return { shouldStop: true, reason: 'all focus areas covered' };
    }
    if (
      sc.stopWhenNoNewFindingsForSteps !== undefined &&
      opts.stepsSinceLastFinding >= sc.stopWhenNoNewFindingsForSteps
    ) {
      return { shouldStop: true, reason: `no new findings for ${String(sc.stopWhenNoNewFindingsForSteps)} steps` };
    }
    return { shouldStop: false };
  }

  /** Append a step record to the session's steps.jsonl trace file. */
  appendStep(sessionId: string, step: StepRecord, dataRoot: string): void {
    const absPath = join(dataRoot, agentStepsPath(sessionId));
    mkdirSync(dirname(absPath), { recursive: true });
    appendFileSync(absPath, `${JSON.stringify(step)}\n`, 'utf8');
  }

  /** Append a tool call record to the session's tool-calls.jsonl trace file. */
  appendToolCall(sessionId: string, record: ToolCallRecord, dataRoot: string): void {
    const absPath = join(dataRoot, agentToolCallsPath(sessionId));
    mkdirSync(dirname(absPath), { recursive: true });
    appendFileSync(absPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  appendPromptSample(sessionId: string, record: PromptSampleRecord, dataRoot: string): void {
    const absPath = join(dataRoot, agentPromptSamplesPath(sessionId));
    mkdirSync(dirname(absPath), { recursive: true });
    appendFileSync(absPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  findById(sessionId: string): AgentSessionRow | undefined {
    return this.repo.findById(sessionId);
  }

  findByRun(runId: string): AgentSessionRow[] {
    return this.repo.findByRun(runId);
  }

  private require(sessionId: string): AgentSessionRow {
    const row = this.repo.findById(sessionId);
    if (!row) throw new Error(`AgentSession not found: ${sessionId}`);
    return row;
  }

  private persistCheckpoint(sessionId: string, checkpoint: CheckpointData, dataRoot: string): void {
    const stepsPath = join(dataRoot, agentStepsPath(sessionId));
    mkdirSync(dirname(stepsPath), { recursive: true });
    appendFileSync(stepsPath, `${JSON.stringify({ type: 'checkpoint', ...checkpoint })}\n`, 'utf8');
  }

  private appendApprovalRecord(sessionId: string, record: ApprovalRecord, dataRoot: string): void {
    const absPath = join(dataRoot, agentToolCallsPath(sessionId));
    mkdirSync(dirname(absPath), { recursive: true });
    appendFileSync(absPath, `${JSON.stringify({ type: 'approval', ...record })}\n`, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Helper: convert AgentSessionRow back to SaveAgentSessionInput for upsert
// ---------------------------------------------------------------------------
function rowToInput(row: AgentSessionRow): Parameters<AgentSessionRepository['save']>[0] {
  const input: Parameters<AgentSessionRepository['save']>[0] = {
    sessionId: row.session_id,
    runId: row.run_id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
  if (row.task_id) input.taskId = row.task_id;
  if (row.agent_name) input.agentName = row.agent_name;
  if (row.policy_json) input.policyJson = row.policy_json;
  if (row.context_refs_json) input.contextRefsJson = row.context_refs_json;
  if (row.checkpoint_id) input.checkpointId = row.checkpoint_id;
  if (row.trace_path) input.tracePath = row.trace_path;
  if (row.ended_at) input.endedAt = row.ended_at;
  if (row.summary) input.summary = row.summary;
  return input;
}
