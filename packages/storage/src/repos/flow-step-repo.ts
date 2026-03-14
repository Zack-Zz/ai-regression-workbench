import type { Db } from '../db.js';

export interface FlowStepRow {
  id: string;
  run_id: string;
  testcase_id: string;
  flow_id: string;
  step_name: string;
  success: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  ui_action_count: number | null;
  api_call_count: number | null;
  failed_api_count: number | null;
}

export interface SaveFlowStepInput {
  id: string;
  runId: string;
  testcaseId: string;
  flowId: string;
  stepName: string;
  success: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  uiActionCount?: number;
  apiCallCount?: number;
  failedApiCount?: number;
}

export class FlowStepRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveFlowStepInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO flow_step_records
          (id, run_id, testcase_id, flow_id, step_name, success,
           started_at, ended_at, duration_ms, ui_action_count, api_call_count, failed_api_count)
        VALUES
          (@id, @runId, @testcaseId, @flowId, @stepName, @success,
           @startedAt, @endedAt, @durationMs, @uiActionCount, @apiCallCount, @failedApiCount)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId,
        flowId: input.flowId,
        stepName: input.stepName,
        success: input.success ? 1 : 0,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        durationMs: input.durationMs ?? null,
        uiActionCount: input.uiActionCount ?? null,
        apiCallCount: input.apiCallCount ?? null,
        failedApiCount: input.failedApiCount ?? null,
      });
  }

  findByTestcase(runId: string, testcaseId: string): FlowStepRow[] {
    return this.db
      .prepare('SELECT * FROM flow_step_records WHERE run_id = ? AND testcase_id = ? ORDER BY started_at')
      .all(runId, testcaseId) as FlowStepRow[];
  }
}
