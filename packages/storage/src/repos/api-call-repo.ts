import type { Db } from '../db.js';

export interface ApiCallRow {
  id: string;
  run_id: string;
  testcase_id: string;
  flow_step_id: string | null;
  ui_action_id: string | null;
  method: string | null;
  url: string;
  status_code: number | null;
  response_summary: string | null;
  success: number;
  error_type: string | null;
  error_message: string | null;
  trace_id: string | null;
  request_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface SaveApiCallInput {
  id: string;
  runId: string;
  testcaseId: string;
  flowStepId?: string;
  uiActionId?: string;
  method?: string;
  url: string;
  statusCode?: number;
  responseSummary?: string;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  traceId?: string;
  requestId?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export class ApiCallRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveApiCallInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO api_call_records
          (id, run_id, testcase_id, flow_step_id, ui_action_id, method, url,
           status_code, response_summary, success, error_type, error_message,
           trace_id, request_id, started_at, ended_at, duration_ms)
        VALUES
          (@id, @runId, @testcaseId, @flowStepId, @uiActionId, @method, @url,
           @statusCode, @responseSummary, @success, @errorType, @errorMessage,
           @traceId, @requestId, @startedAt, @endedAt, @durationMs)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId,
        flowStepId: input.flowStepId ?? null,
        uiActionId: input.uiActionId ?? null,
        method: input.method ?? null,
        url: input.url,
        statusCode: input.statusCode ?? null,
        responseSummary: input.responseSummary ?? null,
        success: input.success ? 1 : 0,
        errorType: input.errorType ?? null,
        errorMessage: input.errorMessage ?? null,
        traceId: input.traceId ?? null,
        requestId: input.requestId ?? null,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        durationMs: input.durationMs ?? null,
      });
  }

  findByTestcase(runId: string, testcaseId: string): ApiCallRow[] {
    return this.db
      .prepare('SELECT * FROM api_call_records WHERE run_id = ? AND testcase_id = ? ORDER BY started_at')
      .all(runId, testcaseId) as ApiCallRow[];
  }
}
