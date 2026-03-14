import type { Db } from '../db.js';
import type { FindingSeverity } from '@zarb/shared-types';

export interface FindingRow {
  id: string;
  run_id: string;
  session_id: string | null;
  scenario_id: string | null;
  category: string;
  severity: FindingSeverity;
  page_url: string | null;
  title: string;
  summary: string | null;
  evidence_json: string | null;
  promoted_task_id: string | null;
  created_at: string;
}

export interface SaveFindingInput {
  id: string;
  runId: string;
  sessionId?: string;
  scenarioId?: string;
  category: string;
  severity: FindingSeverity;
  pageUrl?: string;
  title: string;
  summary?: string;
  evidenceJson?: string;
  promotedTaskId?: string;
  createdAt: string;
}

export class FindingRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveFindingInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO findings
          (id, run_id, session_id, scenario_id, category, severity, page_url,
           title, summary, evidence_json, promoted_task_id, created_at)
        VALUES
          (@id, @runId, @sessionId, @scenarioId, @category, @severity, @pageUrl,
           @title, @summary, @evidenceJson, @promotedTaskId, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        sessionId: input.sessionId ?? null,
        scenarioId: input.scenarioId ?? null,
        category: input.category,
        severity: input.severity,
        pageUrl: input.pageUrl ?? null,
        title: input.title,
        summary: input.summary ?? null,
        evidenceJson: input.evidenceJson ?? null,
        promotedTaskId: input.promotedTaskId ?? null,
        createdAt: input.createdAt,
      });
  }

  findByRun(runId: string): FindingRow[] {
    return this.db
      .prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY created_at')
      .all(runId) as FindingRow[];
  }
}
