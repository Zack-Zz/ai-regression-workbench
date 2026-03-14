import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { RunRepository } from '../src/repos/run-repo.js';
import { CodeTaskRepository } from '../src/repos/code-task-repo.js';
import { ReviewRepository } from '../src/repos/review-repo.js';
import { CommitRepository } from '../src/repos/commit-repo.js';
import { TestResultRepository } from '../src/repos/test-result-repo.js';
import { CorrelationContextRepository } from '../src/repos/correlation-context-repo.js';
import { AgentSessionRepository } from '../src/repos/agent-session-repo.js';
import { FindingRepository } from '../src/repos/finding-repo.js';
import { ApiCallRepository } from '../src/repos/api-call-repo.js';
import { UiActionRepository } from '../src/repos/ui-action-repo.js';
import { FlowStepRepository } from '../src/repos/flow-step-repo.js';
import { ExecutionReportRepository } from '../src/repos/execution-report-repo.js';
import { DiagnosticFetchRepository } from '../src/repos/diagnostic-fetch-repo.js';
import { AnalysisRepository } from '../src/repos/analysis-repo.js';
import { SystemEventRepository } from '../src/repos/system-event-repo.js';
import {
  runSnapshotPath,
  executionReportPath,
  artifactsDir,
  correlationContextPath,
  codeTaskDiffPath,
  agentContextSummaryPath,
} from '../src/paths.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-storage-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  return () => { rmSync(dir, { recursive: true, force: true }); };
});

function makeDb() {
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function cols(db: ReturnType<typeof makeDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

function makeRun(db: ReturnType<typeof makeDb>, runId = 'r1') {
  new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/ws', startedAt: '2026-01-01T00:00:00Z' });
}

// ---------------------------------------------------------------------------
// Migration + schema contract
// ---------------------------------------------------------------------------

describe('runMigrations', () => {
  it('creates all expected tables', () => {
    const db = makeDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ['test_runs', 'test_results', 'scenarios', 'correlation_contexts',
      'diagnostic_fetches', 'failure_analysis', 'agent_sessions', 'findings',
      'code_tasks', 'reviews', 'commit_records', 'run_events', 'system_events',
      'api_call_records', 'ui_action_records', 'flow_step_records', 'execution_reports', '_migrations']) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = makeDb();
    expect(() => { runMigrations(db, MIGRATIONS_DIR); }).not.toThrow();
  });

  it('test_runs has all required columns', () => {
    const db = makeDb();
    const c = cols(db, 'test_runs');
    for (const col of ['exploration_config_json', 'pause_requested', 'current_stage', 'paused_at',
      'ended_at', 'total', 'passed', 'failed', 'skipped', 'summary']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('correlation_contexts has session_ids_json and service_hints_json', () => {
    const db = makeDb();
    const c = cols(db, 'correlation_contexts');
    expect(c).toContain('session_ids_json');
    expect(c).toContain('service_hints_json');
  });

  it('diagnostic_fetches has request_json', () => {
    const db = makeDb();
    expect(cols(db, 'diagnostic_fetches')).toContain('request_json');
  });

  it('failure_analysis has suspected_layer, confidence, probable_cause, version', () => {
    const db = makeDb();
    const c = cols(db, 'failure_analysis');
    for (const col of ['suspected_layer', 'confidence', 'probable_cause', 'trace_summary_json', 'log_summary_json', 'version']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('findings has scenario_id, summary, evidence_json, promoted_task_id', () => {
    const db = makeDb();
    const c = cols(db, 'findings');
    for (const col of ['scenario_id', 'summary', 'evidence_json', 'promoted_task_id']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('api_call_records has success, response_summary, ended_at', () => {
    const db = makeDb();
    const c = cols(db, 'api_call_records');
    for (const col of ['success', 'response_summary', 'ended_at', 'error_type', 'trace_id', 'request_id']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('ui_action_records has success, locator, page_url, api_call_count, failed_api_count', () => {
    const db = makeDb();
    const c = cols(db, 'ui_action_records');
    for (const col of ['success', 'locator', 'page_url', 'api_call_count', 'failed_api_count']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('flow_step_records has success, ended_at, ui_action_count, failed_api_count', () => {
    const db = makeDb();
    const c = cols(db, 'flow_step_records');
    for (const col of ['success', 'ended_at', 'ui_action_count', 'failed_api_count']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('agent_sessions has agent_name, policy_json, checkpoint_id, summary', () => {
    const db = makeDb();
    const c = cols(db, 'agent_sessions');
    for (const col of ['agent_name', 'policy_json', 'checkpoint_id', 'summary']) {
      expect(c, `missing: ${col}`).toContain(col);
    }
  });

  it('run_events entity_id is present (non-nullable by design)', () => {
    const db = makeDb();
    expect(cols(db, 'run_events')).toContain('entity_id');
  });

  it('commit_records has error_message', () => {
    const db = makeDb();
    expect(cols(db, 'commit_records')).toContain('error_message');
  });

  it('reviews has patch_hash and created_at (not reviewed_at)', () => {
    const db = makeDb();
    const c = cols(db, 'reviews');
    expect(c).toContain('patch_hash');
    expect(c).toContain('created_at');
    expect(c).not.toContain('reviewed_at');
  });
});

// ---------------------------------------------------------------------------
// RunRepository
// ---------------------------------------------------------------------------

describe('RunRepository', () => {
  it('creates and retrieves a run', () => {
    const db = makeDb();
    const repo = new RunRepository(db);
    repo.create({ runId: 'r1', scopeType: 'suite', workspacePath: '/ws', startedAt: '2026-01-01T00:00:00Z' });
    const row = repo.findById('r1');
    expect(row?.run_id).toBe('r1');
    expect(row?.status).toBe('CREATED');
    expect(row?.pause_requested).toBe(0);
  });

  it('updates pause/stage/summary fields', () => {
    const db = makeDb();
    const repo = new RunRepository(db);
    repo.create({ runId: 'r2', scopeType: 'suite', workspacePath: '/ws', startedAt: '2026-01-01T00:00:00Z' });
    repo.update('r2', { status: 'PAUSED', pauseRequested: true, currentStage: 'RUNNING_TESTS',
      total: 10, passed: 7, failed: 2, skipped: 1, summary: 'partial', updatedAt: '2026-01-01T00:01:00Z' });
    const row = repo.findById('r2');
    expect(row?.status).toBe('PAUSED');
    expect(row?.pause_requested).toBe(1);
    expect(row?.current_stage).toBe('RUNNING_TESTS');
    expect(row?.total).toBe(10);
  });

  it('stores exploration_config_json', () => {
    const db = makeDb();
    const repo = new RunRepository(db);
    const cfg = JSON.stringify({ maxSteps: 50 });
    repo.create({ runId: 'r3', scopeType: 'suite', workspacePath: '/ws', startedAt: '2026-01-01T00:00:00Z', explorationConfigJson: cfg });
    expect(repo.findById('r3')?.exploration_config_json).toBe(cfg);
  });

  it('lists with cursor pagination', () => {
    const db = makeDb();
    const repo = new RunRepository(db);
    for (let i = 0; i < 5; i++) {
      repo.create({ runId: `r${String(i)}`, scopeType: 'suite', workspacePath: '/ws', startedAt: `2026-01-0${String(i + 1)}T00:00:00Z` });
    }
    const page1 = repo.list({ limit: 3 });
    expect(page1.items).toHaveLength(3);
    const page2 = repo.list({ limit: 3, cursor: page1.nextCursor as string });
    expect(page2.items.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CodeTaskRepository
// ---------------------------------------------------------------------------

describe('CodeTaskRepository', () => {
  it('creates with valid enum defaults', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new CodeTaskRepository(db);
    repo.create({ taskId: 't1', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: '2026-01-01T00:00:00Z' });
    const row = repo.findById('t1');
    expect(row?.automation_level).toBe('headless');
    expect(row?.mode).toBe('apply');
    expect(row?.verify_override_used).toBe(0);
  });

  it('updates harness_session_id and changed_files_json', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new CodeTaskRepository(db);
    repo.create({ taskId: 't2', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: '2026-01-01T00:00:00Z' });
    repo.update('t2', { status: 'RUNNING', harnessSessionId: 'sess-1', changedFilesJson: '["a.ts"]', verifyPassed: true, updatedAt: '2026-01-01T00:01:00Z' });
    const row = repo.findById('t2');
    expect(row?.harness_session_id).toBe('sess-1');
    expect(row?.verify_passed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ReviewRepository
// ---------------------------------------------------------------------------

describe('ReviewRepository', () => {
  it('creates with patch_hash and created_at', () => {
    const db = makeDb();
    makeRun(db);
    new CodeTaskRepository(db).create({ taskId: 't1', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: '2026-01-01T00:00:00Z' });
    new ReviewRepository(db).create({ id: 'rv1', taskId: 't1', decision: 'accept', patchHash: 'abc', codeTaskVersion: 1, createdAt: '2026-01-01T01:00:00Z' });
    const row = new ReviewRepository(db).findByTaskId('t1');
    expect(row?.patch_hash).toBe('abc');
    expect(row?.created_at).toBe('2026-01-01T01:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// CommitRepository
// ---------------------------------------------------------------------------

describe('CommitRepository', () => {
  it('stores and updates error_message', () => {
    const db = makeDb();
    makeRun(db);
    new CodeTaskRepository(db).create({ taskId: 't1', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: '2026-01-01T00:00:00Z' });
    const repo = new CommitRepository(db);
    repo.create({ id: 'c1', taskId: 't1', createdAt: '2026-01-01T02:00:00Z' });
    repo.update('c1', { status: 'failed', errorMessage: 'conflict', updatedAt: '2026-01-01T02:01:00Z' });
    const row = repo.findByTaskId('t1');
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe('conflict');
  });
});

// ---------------------------------------------------------------------------
// TestResultRepository
// ---------------------------------------------------------------------------

describe('TestResultRepository', () => {
  it('upserts with artifact paths', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new TestResultRepository(db);
    repo.upsert({ id: 'tr1', runId: 'r1', testcaseId: 'tc1', status: 'FAILED',
      screenshotPath: 'artifacts/r1/tc1/screenshot.png', tracePath: 'artifacts/r1/tc1/trace.zip',
      startedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' });
    const row = repo.findByTestcase('r1', 'tc1');
    expect(row?.screenshot_path).toBe('artifacts/r1/tc1/screenshot.png');
  });

  it('upsert updates on conflict', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new TestResultRepository(db);
    const base = { id: 'tr1', runId: 'r1', testcaseId: 'tc1', startedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' };
    repo.upsert({ ...base, status: 'FAILED' });
    repo.upsert({ ...base, status: 'PASSED' });
    expect(repo.findByTestcase('r1', 'tc1')?.status).toBe('PASSED');
  });
});

// ---------------------------------------------------------------------------
// New repositories
// ---------------------------------------------------------------------------

describe('CorrelationContextRepository', () => {
  it('saves and retrieves with session_ids_json and service_hints_json', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new CorrelationContextRepository(db);
    repo.save({ id: 'cc1', runId: 'r1', testcaseId: 'tc1',
      sessionIdsJson: '["s1"]', serviceHintsJson: '["api"]', createdAt: '2026-01-01T00:00:00Z' });
    const row = repo.findByTestcase('r1', 'tc1');
    expect(row?.session_ids_json).toBe('["s1"]');
    expect(row?.service_hints_json).toBe('["api"]');
  });
});

describe('AgentSessionRepository', () => {
  it('saves with agent_name, policy_json, checkpoint_id, summary', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new AgentSessionRepository(db);
    repo.save({ sessionId: 'sess1', runId: 'r1', kind: 'exploration', agentName: 'explorer',
      status: 'running', policyJson: '{}', checkpointId: 'ckpt1', summary: 'done',
      startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const row = repo.findById('sess1');
    expect(row?.agent_name).toBe('explorer');
    expect(row?.checkpoint_id).toBe('ckpt1');
    expect(row?.summary).toBe('done');
  });
});

describe('FindingRepository', () => {
  it('saves with scenario_id, summary, evidence_json, promoted_task_id', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new FindingRepository(db);
    repo.save({ id: 'f1', runId: 'r1', category: 'ui', severity: 'high',
      title: 'broken button', scenarioId: 'sc1', summary: 'btn missing',
      evidenceJson: '{}', promotedTaskId: 't1', createdAt: '2026-01-01T00:00:00Z' });
    const rows = repo.findByRun('r1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scenario_id).toBe('sc1');
    expect(rows[0]?.promoted_task_id).toBe('t1');
  });
});

describe('ApiCallRepository', () => {
  it('saves with success, response_summary, trace_id', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new ApiCallRepository(db);
    repo.save({ id: 'ac1', runId: 'r1', testcaseId: 'tc1', url: '/api/v1', method: 'GET',
      statusCode: 200, success: true, responseSummary: 'ok', traceId: 'tr-1',
      startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z', durationMs: 100 });
    const rows = repo.findByTestcase('r1', 'tc1');
    expect(rows[0]?.success).toBe(1);
    expect(rows[0]?.trace_id).toBe('tr-1');
  });
});

describe('UiActionRepository', () => {
  it('saves with success, locator, api_call_count', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new UiActionRepository(db);
    repo.save({ id: 'ua1', runId: 'r1', testcaseId: 'tc1', actionType: 'click',
      locator: '#btn', pageUrl: '/home', success: true, apiCallCount: 2, failedApiCount: 0,
      startedAt: '2026-01-01T00:00:00Z' });
    const rows = repo.findByTestcase('r1', 'tc1');
    expect(rows[0]?.locator).toBe('#btn');
    expect(rows[0]?.api_call_count).toBe(2);
  });
});

describe('FlowStepRepository', () => {
  it('saves with success, ui_action_count, failed_api_count', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new FlowStepRepository(db);
    repo.save({ id: 'fs1', runId: 'r1', testcaseId: 'tc1', flowId: 'flow1',
      stepName: 'login', success: true, uiActionCount: 3, apiCallCount: 2, failedApiCount: 0,
      startedAt: '2026-01-01T00:00:00Z' });
    const rows = repo.findByTestcase('r1', 'tc1');
    expect(rows[0]?.ui_action_count).toBe(3);
    expect(rows[0]?.success).toBe(1);
  });
});

describe('ExecutionReportRepository', () => {
  it('saves and upserts by run_id', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new ExecutionReportRepository(db);
    repo.save({ id: 'er1', runId: 'r1', status: 'COMPLETED', reportPath: 'runs/r1-execution-report.json', generatedAt: '2026-01-01T01:00:00Z' });
    repo.save({ id: 'er2', runId: 'r1', status: 'COMPLETED', reportPath: 'runs/r1-execution-report.json', totalsJson: '{"total":5}', generatedAt: '2026-01-01T02:00:00Z' });
    const row = repo.findByRunId('r1');
    expect(row?.totals_json).toBe('{"total":5}');
  });
});

describe('DiagnosticFetchRepository', () => {
  it('saves with request_json', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new DiagnosticFetchRepository(db);
    repo.save({ id: 'df1', runId: 'r1', testcaseId: 'tc1', type: 'trace', status: 'succeeded',
      requestJson: '{"traceId":"t1"}', createdAt: '2026-01-01T00:00:00Z' });
    const rows = repo.findByTestcase('r1', 'tc1');
    expect(rows[0]?.request_json).toBe('{"traceId":"t1"}');
  });
});

describe('AnalysisRepository', () => {
  it('saves with suspected_layer, confidence, probable_cause', () => {
    const db = makeDb();
    makeRun(db);
    const repo = new AnalysisRepository(db);
    repo.save({ id: 'an1', runId: 'r1', testcaseId: 'tc1', category: 'api',
      suspectedLayer: 'backend', confidence: 0.9, probableCause: 'timeout',
      createdAt: '2026-01-01T00:00:00Z' });
    const row = repo.findByTestcase('r1', 'tc1');
    expect(row?.suspected_layer).toBe('backend');
    expect(row?.confidence).toBe(0.9);
  });
});

describe('SystemEventRepository', () => {
  it('saves and lists system events', () => {
    const db = makeDb();
    const repo = new SystemEventRepository(db);
    repo.save({ id: 'se1', eventType: 'SETTINGS_UPDATED', payloadJson: '{}', createdAt: '2026-01-01T00:00:00Z' });
    repo.save({ id: 'se2', eventType: 'MIGRATION_APPLIED', payloadJson: '{}', createdAt: '2026-01-01T00:01:00Z' });
    expect(repo.list()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Path helpers — safety enforcement
// ---------------------------------------------------------------------------

describe('path helpers', () => {
  it('all paths are relative (no leading slash)', () => {
    expect(runSnapshotPath('r1')).not.toMatch(/^\//);
    expect(executionReportPath('r1')).not.toMatch(/^\//);
    expect(artifactsDir('r1', 'tc1')).not.toMatch(/^\//);
    expect(correlationContextPath('r1', 'tc1')).not.toMatch(/^\//);
    expect(codeTaskDiffPath('t1')).not.toMatch(/^\//);
    expect(agentContextSummaryPath('s1')).not.toMatch(/^\//);
  });

  it('produces expected path shapes', () => {
    expect(runSnapshotPath('r1')).toBe('runs/r1.json');
    expect(executionReportPath('r1')).toBe('runs/r1-execution-report.json');
    expect(codeTaskDiffPath('t1')).toBe('code-tasks/t1/changes.diff');
  });

  it('rejects ".." traversal', () => {
    expect(() => runSnapshotPath('../evil')).toThrow(/\.\./);
    expect(() => artifactsDir('r1', '../etc')).toThrow(/\.\./);
  });

  it('rejects absolute path segments', () => {
    expect(() => runSnapshotPath('/abs')).toThrow(/absolute/);
  });

  it('rejects empty segments', () => {
    expect(() => runSnapshotPath('')).toThrow(/empty/);
  });
});
