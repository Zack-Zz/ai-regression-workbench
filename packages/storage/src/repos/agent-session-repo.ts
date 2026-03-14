import type { Db } from '../db.js';
import type { AgentSessionKind, AgentSessionStatus } from '@zarb/shared-types';

export interface AgentSessionRow {
  session_id: string;
  run_id: string;
  task_id: string | null;
  kind: AgentSessionKind;
  agent_name: string | null;
  status: AgentSessionStatus;
  policy_json: string | null;
  context_refs_json: string;
  checkpoint_id: string | null;
  trace_path: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  summary: string | null;
}

export interface SaveAgentSessionInput {
  sessionId: string;
  runId: string;
  taskId?: string;
  kind: AgentSessionKind;
  agentName?: string;
  status: AgentSessionStatus;
  policyJson?: string;
  contextRefsJson?: string;
  checkpointId?: string;
  tracePath?: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  summary?: string;
}

export class AgentSessionRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveAgentSessionInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO agent_sessions
          (session_id, run_id, task_id, kind, agent_name, status, policy_json,
           context_refs_json, checkpoint_id, trace_path, started_at, updated_at, ended_at, summary)
        VALUES
          (@sessionId, @runId, @taskId, @kind, @agentName, @status, @policyJson,
           @contextRefsJson, @checkpointId, @tracePath, @startedAt, @updatedAt, @endedAt, @summary)
      `)
      .run({
        sessionId: input.sessionId,
        runId: input.runId,
        taskId: input.taskId ?? null,
        kind: input.kind,
        agentName: input.agentName ?? null,
        status: input.status,
        policyJson: input.policyJson ?? null,
        contextRefsJson: input.contextRefsJson ?? '{}',
        checkpointId: input.checkpointId ?? null,
        tracePath: input.tracePath ?? null,
        startedAt: input.startedAt,
        updatedAt: input.updatedAt,
        endedAt: input.endedAt ?? null,
        summary: input.summary ?? null,
      });
  }

  findById(sessionId: string): AgentSessionRow | undefined {
    return this.db
      .prepare('SELECT * FROM agent_sessions WHERE session_id = ?')
      .get(sessionId) as AgentSessionRow | undefined;
  }

  findByRun(runId: string): AgentSessionRow[] {
    return this.db
      .prepare('SELECT * FROM agent_sessions WHERE run_id = ? ORDER BY started_at')
      .all(runId) as AgentSessionRow[];
  }
}
