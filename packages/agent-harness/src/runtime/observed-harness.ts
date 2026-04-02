import type { AgentSessionRow } from '@zarb/storage';
import type { HarnessSessionManager, StartSessionInput, StepRecord, CheckpointData, ApprovalRecord } from './session-manager.js';
import type { ToolCallRecord } from './tool-registry.js';
import type { ObservabilityAdapter, ObservabilityEvent } from './observability.js';
import { appLogger } from '@zarb/logger';

const log = appLogger.child('ObservedHarness');

/**
 * ObservedHarness — optional decorator around HarnessSessionManager.
 * Forwards all lifecycle events to an ObservabilityAdapter.
 * If the adapter throws, the error is swallowed and a warning is logged.
 * Derived from observability-design.md §4, §8.
 */
export class ObservedHarness {
  constructor(
    private readonly inner: HarnessSessionManager,
    private readonly adapter: ObservabilityAdapter,
    private readonly provider: string = 'unknown',
  ) {}

  startSession(input: StartSessionInput): AgentSessionRow {
    const row = this.inner.startSession(input);
    log.info('session started', { sessionId: row.session_id, runId: input.runId, agentName: input.agentName, kind: input.kind });
    this.emit({
      sessionId: row.session_id,
      runId: input.runId,
      agentName: input.agentName,
      eventType: 'session_start',
      payload: { kind: input.kind, policy: input.policy },
      timestamp: row.started_at,
      ...(input.taskId ? { taskId: input.taskId } : {}),
    }, 'onSessionStart');
    return row;
  }

  completeSession(sessionId: string, summary?: string): AgentSessionRow {
    const startedAt = this.inner.findById(sessionId)?.started_at ?? new Date().toISOString();
    const row = this.inner.completeSession(sessionId, summary);
    const latencyMs = Date.now() - new Date(startedAt).getTime();
    log.info('session completed', { sessionId, runId: row.run_id, latencyMs });
    this.emit({
      sessionId,
      runId: row.run_id,
      agentName: row.agent_name ?? '',
      eventType: 'session_end',
      payload: { status: 'completed', latencyMs, summary: { enabled: true, provider: this.provider, latencyMs } },
      timestamp: row.ended_at ?? new Date().toISOString(),
      ...(row.task_id ? { taskId: row.task_id } : {}),
    }, 'onSessionEnd');
    return row;
  }

  cancelSession(sessionId: string): AgentSessionRow {
    const startedAt = this.inner.findById(sessionId)?.started_at ?? new Date().toISOString();
    const row = this.inner.cancelSession(sessionId);
    const latencyMs = Date.now() - new Date(startedAt).getTime();
    this.emit({
      sessionId,
      runId: row.run_id,
      agentName: row.agent_name ?? '',
      eventType: 'session_end',
      payload: { status: 'cancelled', latencyMs, summary: { enabled: true, provider: this.provider, latencyMs } },
      timestamp: row.ended_at ?? new Date().toISOString(),
      ...(row.task_id ? { taskId: row.task_id } : {}),
    }, 'onSessionEnd');
    return row;
  }

  appendStep(sessionId: string, step: StepRecord, dataRoot: string): void {
    this.inner.appendStep(sessionId, step, dataRoot);
    const row = this.inner.findById(sessionId);
    if (!row) return;
    this.emit({
      sessionId,
      runId: row.run_id,
      agentName: row.agent_name ?? '',
      eventType: 'step',
      payload: { stepIndex: step.stepIndex, description: step.description, outcome: step.outcome },
      timestamp: step.timestamp,
      ...(row.task_id ? { taskId: row.task_id } : {}),
    }, 'onEvent');
  }

  appendToolCall(sessionId: string, record: ToolCallRecord, dataRoot: string): void {
    this.inner.appendToolCall(sessionId, record, dataRoot);
    const row = this.inner.findById(sessionId);
    if (!row) return;
    log.debug('tool call', { sessionId, toolName: record.toolName, status: record.status, durationMs: record.durationMs });
    this.emit({
      sessionId,
      runId: row.run_id,
      agentName: row.agent_name ?? '',
      eventType: 'tool_call',
      payload: { toolName: record.toolName, status: record.status, durationMs: record.durationMs },
      timestamp: new Date().toISOString(),
      ...(row.task_id ? { taskId: row.task_id } : {}),
    }, 'onEvent');
  }

  requestApproval(sessionId: string, toolName: string, stepIndex: number, dataRoot: string): ApprovalRecord {
    const record = this.inner.requestApproval(sessionId, toolName, stepIndex, dataRoot);
    const row = this.inner.findById(sessionId);
    if (row) {
      this.emit({
        sessionId,
        runId: row.run_id,
        agentName: row.agent_name ?? '',
        eventType: 'approval',
        payload: { approvalId: record.approvalId, toolName, status: 'pending' },
        timestamp: record.requestedAt,
        ...(row.task_id ? { taskId: row.task_id } : {}),
      }, 'onEvent');
    }
    return record;
  }

  commitPause(sessionId: string, checkpoint: CheckpointData, dataRoot: string): AgentSessionRow {
    const row = this.inner.commitPause(sessionId, checkpoint, dataRoot);
    this.emit({
      sessionId,
      runId: row.run_id,
      agentName: row.agent_name ?? '',
      eventType: 'checkpoint',
      payload: { checkpointId: checkpoint.checkpointId, stepIndex: checkpoint.stepIndex },
      timestamp: checkpoint.timestamp,
      ...(row.task_id ? { taskId: row.task_id } : {}),
    }, 'onEvent');
    return row;
  }

  // Delegate remaining methods unchanged
  resumeSession(sessionId: string): AgentSessionRow { return this.inner.resumeSession(sessionId); }
  grantApproval(sessionId: string, record: ApprovalRecord, dataRoot: string): ApprovalRecord { return this.inner.grantApproval(sessionId, record, dataRoot); }
  checkSessionBudget(sessionId: string): boolean { return this.inner.checkSessionBudget(sessionId); }
  evaluateStopConditions(sessionId: string, opts: Parameters<HarnessSessionManager['evaluateStopConditions']>[1]): ReturnType<HarnessSessionManager['evaluateStopConditions']> { return this.inner.evaluateStopConditions(sessionId, opts); }
  findById(sessionId: string): AgentSessionRow | undefined { return this.inner.findById(sessionId); }
  findByRun(runId: string): AgentSessionRow[] { return this.inner.findByRun(runId); }

  private emit(event: ObservabilityEvent, method: 'onSessionStart' | 'onSessionEnd' | 'onEvent'): void {
    try {
      const result = method === 'onSessionStart'
        ? this.adapter.onSessionStart(event)
        : method === 'onSessionEnd'
          ? this.adapter.onSessionEnd(event)
          : this.adapter.onEvent(event);
      if (result instanceof Promise) {
        result.catch((e: unknown) => { log.warn('adapter error', { error: String(e) }); });
      }
    } catch (e: unknown) {
      log.warn('adapter error', { error: String(e) });
    }
  }
}
