import type { Db } from '../db.js';

export interface CorrelationContextRow {
  id: string;
  run_id: string;
  testcase_id: string | null;
  trace_ids_json: string | null;
  request_ids_json: string | null;
  session_ids_json: string | null;
  service_hints_json: string | null;
  from_time: string | null;
  to_time: string | null;
  created_at: string;
}

export interface SaveCorrelationContextInput {
  id: string;
  runId: string;
  testcaseId?: string;
  traceIdsJson?: string;
  requestIdsJson?: string;
  sessionIdsJson?: string;
  serviceHintsJson?: string;
  fromTime?: string;
  toTime?: string;
  createdAt: string;
}

export class CorrelationContextRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveCorrelationContextInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO correlation_contexts
          (id, run_id, testcase_id, trace_ids_json, request_ids_json,
           session_ids_json, service_hints_json, from_time, to_time, created_at)
        VALUES
          (@id, @runId, @testcaseId, @traceIdsJson, @requestIdsJson,
           @sessionIdsJson, @serviceHintsJson, @fromTime, @toTime, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId ?? null,
        traceIdsJson: input.traceIdsJson ?? null,
        requestIdsJson: input.requestIdsJson ?? null,
        sessionIdsJson: input.sessionIdsJson ?? null,
        serviceHintsJson: input.serviceHintsJson ?? null,
        fromTime: input.fromTime ?? null,
        toTime: input.toTime ?? null,
        createdAt: input.createdAt,
      });
  }

  findByTestcase(runId: string, testcaseId: string): CorrelationContextRow | undefined {
    return this.db
      .prepare('SELECT * FROM correlation_contexts WHERE run_id = ? AND testcase_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(runId, testcaseId) as CorrelationContextRow | undefined;
  }
}
