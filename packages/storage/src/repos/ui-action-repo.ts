import type { Db } from '../db.js';
import type { UiActionType } from '@zarb/shared-types';

export interface UiActionRow {
  id: string;
  run_id: string;
  testcase_id: string;
  flow_step_id: string | null;
  action_type: UiActionType;
  locator: string | null;
  page_url: string | null;
  success: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  api_call_count: number | null;
  failed_api_count: number | null;
}

export interface SaveUiActionInput {
  id: string;
  runId: string;
  testcaseId: string;
  flowStepId?: string;
  actionType: UiActionType;
  locator?: string;
  pageUrl?: string;
  success: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  apiCallCount?: number;
  failedApiCount?: number;
}

export class UiActionRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveUiActionInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO ui_action_records
          (id, run_id, testcase_id, flow_step_id, action_type, locator, page_url,
           success, started_at, ended_at, duration_ms, api_call_count, failed_api_count)
        VALUES
          (@id, @runId, @testcaseId, @flowStepId, @actionType, @locator, @pageUrl,
           @success, @startedAt, @endedAt, @durationMs, @apiCallCount, @failedApiCount)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId,
        flowStepId: input.flowStepId ?? null,
        actionType: input.actionType,
        locator: input.locator ?? null,
        pageUrl: input.pageUrl ?? null,
        success: input.success ? 1 : 0,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        durationMs: input.durationMs ?? null,
        apiCallCount: input.apiCallCount ?? null,
        failedApiCount: input.failedApiCount ?? null,
      });
  }

  findByTestcase(runId: string, testcaseId: string): UiActionRow[] {
    return this.db
      .prepare('SELECT * FROM ui_action_records WHERE run_id = ? AND testcase_id = ? ORDER BY started_at')
      .all(runId, testcaseId) as UiActionRow[];
  }
}
