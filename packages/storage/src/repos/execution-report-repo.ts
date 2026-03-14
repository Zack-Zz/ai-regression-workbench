import type { Db } from '../db.js';

export interface ExecutionReportRow {
  id: string;
  run_id: string;
  status: string;
  report_path: string;
  totals_json: string | null;
  generated_at: string;
}

export interface SaveExecutionReportInput {
  id: string;
  runId: string;
  status: string;
  reportPath: string;
  totalsJson?: string;
  generatedAt: string;
}

export class ExecutionReportRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveExecutionReportInput): void {
    this.db
      .prepare(`
        INSERT INTO execution_reports (id, run_id, status, report_path, totals_json, generated_at)
        VALUES (@id, @runId, @status, @reportPath, @totalsJson, @generatedAt)
        ON CONFLICT(run_id) DO UPDATE SET
          id = excluded.id,
          status = excluded.status,
          report_path = excluded.report_path,
          totals_json = excluded.totals_json,
          generated_at = excluded.generated_at
      `)
      .run({
        id: input.id,
        runId: input.runId,
        status: input.status,
        reportPath: input.reportPath,
        totalsJson: input.totalsJson ?? null,
        generatedAt: input.generatedAt,
      });
  }

  findByRunId(runId: string): ExecutionReportRow | undefined {
    return this.db
      .prepare('SELECT * FROM execution_reports WHERE run_id = ?')
      .get(runId) as ExecutionReportRow | undefined;
  }
}
