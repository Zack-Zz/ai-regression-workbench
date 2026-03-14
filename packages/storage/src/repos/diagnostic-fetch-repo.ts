import type { Db } from '../db.js';
import type { DiagnosticFetchType, DiagnosticFetchStatus } from '@zarb/shared-types';

export interface DiagnosticFetchRow {
  id: string;
  run_id: string;
  testcase_id: string | null;
  type: DiagnosticFetchType;
  status: DiagnosticFetchStatus;
  provider: string | null;
  request_json: string | null;
  summary_json: string | null;
  raw_link: string | null;
  created_at: string;
}

export interface SaveDiagnosticFetchInput {
  id: string;
  runId: string;
  testcaseId?: string;
  type: DiagnosticFetchType;
  status: DiagnosticFetchStatus;
  provider?: string;
  requestJson?: string;
  summaryJson?: string;
  rawLink?: string;
  createdAt: string;
}

export class DiagnosticFetchRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveDiagnosticFetchInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO diagnostic_fetches
          (id, run_id, testcase_id, type, status, provider, request_json, summary_json, raw_link, created_at)
        VALUES
          (@id, @runId, @testcaseId, @type, @status, @provider, @requestJson, @summaryJson, @rawLink, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId ?? null,
        type: input.type,
        status: input.status,
        provider: input.provider ?? null,
        requestJson: input.requestJson ?? null,
        summaryJson: input.summaryJson ?? null,
        rawLink: input.rawLink ?? null,
        createdAt: input.createdAt,
      });
  }

  findByTestcase(runId: string, testcaseId: string): DiagnosticFetchRow[] {
    return this.db
      .prepare('SELECT * FROM diagnostic_fetches WHERE run_id = ? AND testcase_id = ? ORDER BY created_at')
      .all(runId, testcaseId) as DiagnosticFetchRow[];
  }
}
