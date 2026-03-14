import type { Db } from '../db.js';

export interface TestResultRow {
  id: string;
  run_id: string;
  testcase_id: string;
  scenario_id: string | null;
  status: string;
  error_type: string | null;
  error_message: string | null;
  duration_ms: number | null;
  screenshot_path: string | null;
  video_path: string | null;
  trace_path: string | null;
  html_report_path: string | null;
  network_log_path: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface UpsertTestResultInput {
  id: string;
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  status: string;
  errorType?: string;
  errorMessage?: string;
  durationMs?: number;
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  htmlReportPath?: string;
  networkLogPath?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
}

export class TestResultRepository {
  constructor(private readonly db: Db) {}

  upsert(input: UpsertTestResultInput): void {
    this.db
      .prepare(`
        INSERT INTO test_results
          (id, run_id, testcase_id, scenario_id, status, error_type, error_message,
           duration_ms, screenshot_path, video_path, trace_path, html_report_path,
           network_log_path, started_at, completed_at, created_at)
        VALUES
          (@id, @runId, @testcaseId, @scenarioId, @status, @errorType, @errorMessage,
           @durationMs, @screenshotPath, @videoPath, @tracePath, @htmlReportPath,
           @networkLogPath, @startedAt, @completedAt, @createdAt)
        ON CONFLICT(run_id, testcase_id) DO UPDATE SET
          status = excluded.status,
          error_type = excluded.error_type,
          error_message = excluded.error_message,
          duration_ms = excluded.duration_ms,
          screenshot_path = excluded.screenshot_path,
          video_path = excluded.video_path,
          trace_path = excluded.trace_path,
          html_report_path = excluded.html_report_path,
          network_log_path = excluded.network_log_path,
          completed_at = excluded.completed_at
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId,
        scenarioId: input.scenarioId ?? null,
        status: input.status,
        errorType: input.errorType ?? null,
        errorMessage: input.errorMessage ?? null,
        durationMs: input.durationMs ?? null,
        screenshotPath: input.screenshotPath ?? null,
        videoPath: input.videoPath ?? null,
        tracePath: input.tracePath ?? null,
        htmlReportPath: input.htmlReportPath ?? null,
        networkLogPath: input.networkLogPath ?? null,
        startedAt: input.startedAt,
        completedAt: input.completedAt ?? null,
        createdAt: input.createdAt,
      });
  }

  findByRun(runId: string): TestResultRow[] {
    return this.db
      .prepare('SELECT * FROM test_results WHERE run_id = ? ORDER BY started_at')
      .all(runId) as TestResultRow[];
  }

  findByTestcase(runId: string, testcaseId: string): TestResultRow | undefined {
    return this.db
      .prepare('SELECT * FROM test_results WHERE run_id = ? AND testcase_id = ?')
      .get(runId, testcaseId) as TestResultRow | undefined;
  }
}
