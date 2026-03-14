import type { Db } from '../db.js';

export interface AnalysisRow {
  id: string;
  run_id: string;
  testcase_id: string | null;
  category: string | null;
  suspected_layer: string | null;
  confidence: number | null;
  summary: string | null;
  probable_cause: string | null;
  trace_summary_json: string | null;
  log_summary_json: string | null;
  suggestions_json: string | null;
  version: number;
  created_at: string;
}

export interface SaveAnalysisInput {
  id: string;
  runId: string;
  testcaseId?: string;
  category?: string;
  suspectedLayer?: string;
  confidence?: number;
  summary?: string;
  probableCause?: string;
  traceSummaryJson?: string;
  logSummaryJson?: string;
  suggestionsJson?: string;
  version?: number;
  createdAt: string;
}

export class AnalysisRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveAnalysisInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO failure_analysis
          (id, run_id, testcase_id, category, suspected_layer, confidence, summary,
           probable_cause, trace_summary_json, log_summary_json, suggestions_json, version, created_at)
        VALUES
          (@id, @runId, @testcaseId, @category, @suspectedLayer, @confidence, @summary,
           @probableCause, @traceSummaryJson, @logSummaryJson, @suggestionsJson, @version, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId ?? null,
        category: input.category ?? null,
        suspectedLayer: input.suspectedLayer ?? null,
        confidence: input.confidence ?? null,
        summary: input.summary ?? null,
        probableCause: input.probableCause ?? null,
        traceSummaryJson: input.traceSummaryJson ?? null,
        logSummaryJson: input.logSummaryJson ?? null,
        suggestionsJson: input.suggestionsJson ?? null,
        version: input.version ?? 1,
        createdAt: input.createdAt,
      });
  }

  findByTestcase(runId: string, testcaseId: string): AnalysisRow | undefined {
    return this.db
      .prepare('SELECT * FROM failure_analysis WHERE run_id = ? AND testcase_id = ? ORDER BY version DESC LIMIT 1')
      .get(runId, testcaseId) as AnalysisRow | undefined;
  }
}
