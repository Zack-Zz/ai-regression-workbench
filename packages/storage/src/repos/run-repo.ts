import type { Db } from '../db.js';
import type { RunStatus, RunMode } from '@zarb/shared-types';

export interface RunRow {
  run_id: string;
  scope_type: string;
  scope_value: string | null;
  selector_json: string;
  run_mode: RunMode;
  trigger_type: string | null;
  environment: string | null;
  exploration_config_json: string | null;
  status: RunStatus;
  pause_requested: number;
  current_stage: string | null;
  paused_at: string | null;
  workspace_path: string;
  timeout_at: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  total: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  summary: string | null;
  report_path: string | null;
}

export interface CreateRunInput {
  runId: string;
  scopeType: string;
  scopeValue?: string;
  selectorJson?: string;
  runMode?: RunMode;
  triggerType?: string;
  environment?: string;
  explorationConfigJson?: string;
  workspacePath: string;
  timeoutAt?: string;
  startedAt: string;
}

export interface UpdateRunInput {
  status?: RunStatus;
  pauseRequested?: boolean;
  currentStage?: string;
  pausedAt?: string | null;
  endedAt?: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  summary?: string;
  reportPath?: string;
  updatedAt: string;
}

export interface ListRunsFilter {
  status?: RunStatus;
  runMode?: RunMode;
  cursor?: string;
  limit?: number;
}

export interface RunPage {
  items: RunRow[];
  nextCursor: string | undefined;
}

export class RunRepository {
  private readonly insertStmt: ReturnType<Db['prepare']>;

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(`
      INSERT INTO test_runs
        (run_id, scope_type, scope_value, selector_json, run_mode, trigger_type,
         environment, exploration_config_json, status, workspace_path,
         timeout_at, started_at, updated_at)
      VALUES
        (@runId, @scopeType, @scopeValue, @selectorJson, @runMode, @triggerType,
         @environment, @explorationConfigJson, 'CREATED', @workspacePath,
         @timeoutAt, @startedAt, @startedAt)
    `);
  }

  create(input: CreateRunInput): void {
    this.insertStmt.run({
      runId: input.runId,
      scopeType: input.scopeType,
      scopeValue: input.scopeValue ?? null,
      selectorJson: input.selectorJson ?? '{}',
      runMode: input.runMode ?? 'regression',
      triggerType: input.triggerType ?? null,
      environment: input.environment ?? null,
      explorationConfigJson: input.explorationConfigJson ?? null,
      workspacePath: input.workspacePath,
      timeoutAt: input.timeoutAt ?? null,
      startedAt: input.startedAt,
    });
  }

  update(runId: string, input: UpdateRunInput): void {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { runId, updatedAt: input.updatedAt };

    if (input.status !== undefined) { sets.push('status = @status'); params['status'] = input.status; }
    if (input.pauseRequested !== undefined) { sets.push('pause_requested = @pauseRequested'); params['pauseRequested'] = input.pauseRequested ? 1 : 0; }
    if (input.currentStage !== undefined) { sets.push('current_stage = @currentStage'); params['currentStage'] = input.currentStage; }
    if (input.pausedAt !== undefined) { sets.push('paused_at = @pausedAt'); params['pausedAt'] = input.pausedAt; }
    if (input.endedAt !== undefined) { sets.push('ended_at = @endedAt'); params['endedAt'] = input.endedAt; }
    if (input.total !== undefined) { sets.push('total = @total'); params['total'] = input.total; }
    if (input.passed !== undefined) { sets.push('passed = @passed'); params['passed'] = input.passed; }
    if (input.failed !== undefined) { sets.push('failed = @failed'); params['failed'] = input.failed; }
    if (input.skipped !== undefined) { sets.push('skipped = @skipped'); params['skipped'] = input.skipped; }
    if (input.summary !== undefined) { sets.push('summary = @summary'); params['summary'] = input.summary; }
    if (input.reportPath !== undefined) { sets.push('report_path = @reportPath'); params['reportPath'] = input.reportPath; }

    this.db.prepare(`UPDATE test_runs SET ${sets.join(', ')} WHERE run_id = @runId`).run(params);
  }

  findById(runId: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM test_runs WHERE run_id = ?').get(runId) as RunRow | undefined;
  }

  list(filter: ListRunsFilter = {}): RunPage {
    const limit = filter.limit ?? 20;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.runMode) { conditions.push('run_mode = ?'); params.push(filter.runMode); }
    if (filter.cursor) { conditions.push('started_at < ?'); params.push(filter.cursor); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM test_runs ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...params, limit + 1) as RunRow[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = items[items.length - 1];
    return { items, nextCursor: hasMore && lastItem ? lastItem.started_at : undefined };
  }
}
