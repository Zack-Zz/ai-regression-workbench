/**
 * Phase 10 — Integration tests for critical flows.
 * Covers: run lifecycle, code task lifecycle, settings flow,
 * and API contract consistency (all documented endpoints respond correctly).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { openDb, runMigrations, RunRepository, CodeTaskRepository, CorrelationContextRepository } from '@zarb/storage';
import { RunService } from '../src/services/run-service.js';
import { DiagnosticsService } from '../src/services/diagnostics-service.js';
import { CodeTaskService } from '../src/services/code-task-service.js';
import { SettingsService } from '../src/services/settings-service.js';
import { DoctorService } from '../src/services/doctor-service.js';
import { buildRouter } from '../src/handlers/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;
let db: ReturnType<typeof openDb>;
let runSvc: RunService;
let taskSvc: CodeTaskService;
let router: ReturnType<typeof buildRouter>;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-integration-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  runSvc = new RunService(db);
  taskSvc = new CodeTaskService(db);
  router = buildRouter(runSvc, new DiagnosticsService(db, dir), taskSvc, new SettingsService(join(dir, 'config.json')));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function req(method: string, url: string, body?: unknown): IncomingMessage {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0);
  const s = Readable.from([bodyBuf]) as unknown as IncomingMessage;
  s.method = method;
  s.url = url;
  return s;
}

function res(): { res: ServerResponse; body: () => Record<string, unknown>; status: () => number } {
  let code = 200;
  let raw = '';
  const r = { writeHead: (c: number) => { code = c; }, end: (d: string) => { raw = d; } } as unknown as ServerResponse;
  return { res: r, body: () => JSON.parse(raw) as Record<string, unknown>, status: () => code };
}

// ---------------------------------------------------------------------------
// Critical flow: Run lifecycle (start → pause → resume → cancel)
// ---------------------------------------------------------------------------

describe('Run lifecycle flow', () => {
  it('start → list → detail → cancel', async () => {
    // Start
    const start = res();
    await router.handle(req('POST', '/runs', { runMode: 'regression', selector: { suite: 'smoke' } }), start.res);
    expect(start.status()).toBe(200);
    const startData = start.body().data as { run: { runId: string } };
    const runId = startData.run.runId;
    expect(typeof runId).toBe('string');

    // List — run appears
    const list = res();
    await router.handle(req('GET', '/runs'), list.res);
    const listData = list.body().data as { items: Array<{ runId: string }> };
    expect(listData.items.some(r => r.runId === runId)).toBe(true);

    // Detail
    const detail = res();
    await router.handle(req('GET', `/runs/${runId}`), detail.res);
    expect(detail.status()).toBe(200);
    const detailData = detail.body().data as { summary: { runId: string; status: string } };
    expect(detailData.summary.runId).toBe(runId);

    // Cancel
    const cancel = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), cancel.res);
    expect(cancel.status()).toBe(200);
    expect(cancel.body().success).toBe(true);

    // Detail after cancel — status is CANCELLED
    const afterCancel = res();
    await router.handle(req('GET', `/runs/${runId}`), afterCancel.res);
    const afterData = afterCancel.body().data as { summary: { status: string } };
    expect(afterData.summary.status).toBe('CANCELLED');
  });

  it('pause and resume — regression run returns not-supported for resume', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;

    // Pause a non-active regression run (no runner in flight) succeeds
    const pause = res();
    await router.handle(req('POST', `/runs/${runId}/pause`), pause.res);
    expect(pause.status()).toBe(200);

    // Resume a paused regression run is explicitly not supported
    const resume = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), resume.res);
    expect(resume.status()).toBe(400);
    const resumeBody = resume.body() as { success: boolean; errorCode: string };
    expect(resumeBody.errorCode).toBe('RUN_RESUME_NOT_SUPPORTED');
  });

  it('resume on non-paused run returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    // Run is CREATED (not PAUSED) — resume should be rejected
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_NOT_PAUSED');
  });

  it('double-cancel returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    runSvc.cancelRun(runId);

    const r = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), r.res);
    expect(r.status()).toBe(409);
  });

  it('pause on COMPLETED run returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    // Force terminal state
    new RunRepository(db).update(runId, { status: 'COMPLETED', updatedAt: new Date().toISOString() });

    const r = res();
    await router.handle(req('POST', `/runs/${runId}/pause`), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_ALREADY_TERMINAL');
  });

  it('cancel on COMPLETED run returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    new RunRepository(db).update(runId, { status: 'COMPLETED', updatedAt: new Date().toISOString() });

    const r = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_ALREADY_TERMINAL');
  });

  it('exploration run requires exploration params', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', { runMode: 'exploration' }), r.res);
    expect(r.status()).toBe(400);
  });

  it('exploration run succeeds with startUrls', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', {
      runMode: 'exploration',
      exploration: { startUrls: ['http://localhost:3000'], maxSteps: 10, maxPages: 5 },
    }), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Critical flow: CodeTask lifecycle (approve → execute → review → commit)
// ---------------------------------------------------------------------------

describe('CodeTask lifecycle flow', () => {
  function seedTask(taskId = 't1', runId = 'r1'): void {
    new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    new CodeTaskRepository(db).create({ taskId, runId, workspacePath: '/ws', goal: 'fix test', createdAt: new Date().toISOString() });
  }

  it('approve → execute → review accept → commit', async () => {
    seedTask();

    // Approve
    const approve = res();
    await router.handle(req('POST', '/code-tasks/t1/approve'), approve.res);
    expect(approve.status()).toBe(200);

    // Execute
    const execute = res();
    await router.handle(req('POST', '/code-tasks/t1/execute'), execute.res);
    expect(execute.status()).toBe(200);

    // Manually advance to SUCCEEDED so review is allowed
    db.prepare("UPDATE code_tasks SET status='SUCCEEDED' WHERE task_id='t1'").run();

    // Submit review (accept)
    const review = res();
    await router.handle(req('POST', '/reviews', { taskId: 't1', decision: 'accept', codeTaskVersion: 1 }), review.res);
    expect(review.status()).toBe(200);

    // Detail — status should be COMMIT_PENDING
    const detail = res();
    await router.handle(req('GET', '/code-tasks/t1'), detail.res);
    const d = detail.body().data as { summary: { status: string }; reviews: unknown[] };
    expect(d.summary.status).toBe('COMMIT_PENDING');
    expect(d.reviews).toHaveLength(1);

    // Create commit
    const commit = res();
    await router.handle(req('POST', '/commits', { taskId: 't1', commitMessage: 'fix: stabilize test', expectedTaskVersion: 1 }), commit.res);
    expect(commit.status()).toBe(200);
  });

  it('cancel task', async () => {
    seedTask('t2');
    const r = res();
    await router.handle(req('POST', '/code-tasks/t2/cancel'), r.res);
    expect(r.status()).toBe(200);
  });

  it('retry task after failure', async () => {
    seedTask('t3');
    db.prepare("UPDATE code_tasks SET status='FAILED' WHERE task_id='t3'").run();
    const r = res();
    await router.handle(req('POST', '/code-tasks/t3/retry'), r.res);
    expect(r.status()).toBe(200);
  });

  it('approve unknown task returns 404', async () => {
    const r = res();
    await router.handle(req('POST', '/code-tasks/nope/approve'), r.res);
    expect(r.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Critical flow: Settings (validate → save → version conflict)
// ---------------------------------------------------------------------------

describe('Settings flow', () => {
  it('validate → save → re-read', async () => {
    // Validate
    const validate = res();
    await router.handle(req('POST', '/settings/validate', { patch: { report: { port: 4000 } } }), validate.res);
    expect(validate.status()).toBe(200);
    const vd = validate.body().data as { valid: boolean };
    expect(vd.valid).toBe(true);

    // Save
    const save = res();
    await router.handle(req('PUT', '/settings', { patch: { report: { port: 4000 } }, expectedVersion: 1 }), save.res);
    expect(save.status()).toBe(200);
    expect(save.body().success).toBe(true);

    // Re-read — port updated
    const get = res();
    await router.handle(req('GET', '/settings'), get.res);
    const snap = get.body().data as { version: number; values: { report: { port: number } } };
    expect(snap.version).toBe(2);
    expect(snap.values.report.port).toBe(4000);
  });

  it('version conflict returns 409', async () => {
    const r = res();
    await router.handle(req('PUT', '/settings', { patch: { report: { port: 3910 } }, expectedVersion: 99 }), r.res);
    expect(r.status()).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// API contract consistency — all documented endpoints, response structure,
// and key error codes / HTTP status semantics
// ---------------------------------------------------------------------------

describe('API contract: all documented endpoints exist', () => {
  function seedRun(): string {
    const r = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    return r.run?.runId as string;
  }

  // --- Existence checks (not 404) ---

  it('GET /runs', async () => {
    const r = res();
    await router.handle(req('GET', '/runs'), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /runs', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', { runMode: 'regression', selector: { suite: 'all' } }), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId/execution-report', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/execution-report`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId/events', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/events`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId/failure-reports', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/failure-reports`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /runs/:runId/pause', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/pause`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /runs/:runId/resume returns 400 for regression run', async () => {
    const runId = seedRun();
    // First pause the run so resume can be attempted
    runSvc.pauseRun(runId);
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), r.res);
    // regression runs return NOT_SUPPORTED
    expect(r.status()).toBe(400);
  });

  it('POST /runs/:runId/cancel', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /code-tasks', async () => {
    const r = res();
    await router.handle(req('GET', '/code-tasks'), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /settings', async () => {
    const r = res();
    await router.handle(req('GET', '/settings'), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /settings/validate', async () => {
    const r = res();
    await router.handle(req('POST', '/settings/validate', { patch: {} }), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('PUT /settings', async () => {
    const r = res();
    await router.handle(req('PUT', '/settings', { patch: {} }), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /doctor', async () => {
    const r = res();
    await router.handle(req('GET', '/doctor'), r.res);
    expect(r.status()).not.toBe(404);
  });

  // --- Response structure checks ---

  it('GET /runs returns { success, data: { items, nextCursor? } }', async () => {
    const r = res();
    await router.handle(req('GET', '/runs'), r.res);
    expect(r.status()).toBe(200);
    const b = r.body();
    expect(b.success).toBe(true);
    const d = b.data as { items: unknown[] };
    expect(Array.isArray(d.items)).toBe(true);
  });

  it('GET /runs/:runId returns { success, data: { summary } }', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}`), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { summary: { runId: string; status: string } };
    expect(d.summary.runId).toBe(runId);
    expect(typeof d.summary.status).toBe('string');
  });

  it('GET /runs/:runId unknown returns 404 with errorCode RUN_NOT_FOUND', async () => {
    const r = res();
    await router.handle(req('GET', '/runs/no-such-run'), r.res);
    expect(r.status()).toBe(404);
    expect(r.body().errorCode).toBe('RUN_NOT_FOUND');
  });

  it('POST /runs missing runMode returns 400', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', {}), r.res);
    expect(r.status()).toBe(400);
    expect(r.body().success).toBe(false);
    expect(typeof r.body().errorCode).toBe('string');
  });

  it('GET /settings returns { success, data: { version, values } }', async () => {
    const r = res();
    await router.handle(req('GET', '/settings'), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { version: number; values: Record<string, unknown> };
    expect(typeof d.version).toBe('number');
    expect(typeof d.values).toBe('object');
  });

  it('POST /settings/validate returns { success, data: { valid, errors } }', async () => {
    const r = res();
    await router.handle(req('POST', '/settings/validate', { patch: { report: { port: -1 } } }), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { valid: boolean; errors: string[] };
    expect(d.valid).toBe(false);
    expect(Array.isArray(d.errors)).toBe(true);
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it('PUT /settings version conflict returns 409 with errorCode SETTINGS_VERSION_CONFLICT', async () => {
    const r = res();
    await router.handle(req('PUT', '/settings', { patch: { report: { port: 3910 } }, expectedVersion: 99 }), r.res);
    expect(r.status()).toBe(409);
    expect(r.body().errorCode).toBe('SETTINGS_VERSION_CONFLICT');
  });

  it('GET /code-tasks returns { success, data: { items, nextCursor? } }', async () => {
    const r = res();
    await router.handle(req('GET', '/code-tasks'), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { items: unknown[] };
    expect(Array.isArray(d.items)).toBe(true);
  });

  it('GET /doctor returns { success, data: { healthy, checks } }', async () => {
    const r = res();
    await router.handle(req('GET', '/doctor'), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { healthy: boolean; checks: unknown[] };
    expect(typeof d.healthy).toBe('boolean');
    expect(Array.isArray(d.checks)).toBe(true);
  });

  // --- Testcase-level endpoints (all documented in api-contract-design.md §6) ---

  it('GET /runs/:runId/testcases/:testcaseId/failure-report returns 404 for unknown', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/failure-report`), r.res);
    expect(r.status()).toBe(404);
  });

  it('GET /runs/:runId/testcases/:testcaseId/execution-profile returns 404 for unknown', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/execution-profile`), r.res);
    expect(r.status()).toBe(404);
  });

  it('GET /runs/:runId/testcases/:testcaseId/diagnostics returns { correlationContext, diagnosticFetches }', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/tc1/diagnostics`), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { correlationContext: unknown; diagnosticFetches: unknown[] };
    expect(typeof d.correlationContext).toBe('object');
    expect(Array.isArray(d.diagnosticFetches)).toBe(true);
  });

  it('GET /runs/:runId/testcases/:testcaseId/trace returns null data for unknown testcase', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/trace`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().data).toBeNull();
  });

  it('GET /runs/:runId/testcases/:testcaseId/logs returns null data for unknown testcase', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/logs`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().data).toBeNull();
  });

  it('GET /trace triggers fetchDiagnostics and writes trace-summary.json when provider returns data', async () => {
    const runId = seedRun();
    // Seed a correlation context with a traceId
    new CorrelationContextRepository(db).save({
      id: `ctx-${runId}`,
      runId,
      testcaseId: 'tc-diag',
      traceIdsJson: JSON.stringify(['trace-xyz']),
      requestIdsJson: '[]',
      sessionIdsJson: '[]',
      createdAt: new Date().toISOString(),
    });

    // Inject a mock trace provider that returns a real TraceSummary
    const mockSummary = { traceId: 'trace-xyz', hasError: false, errorSpans: [], topSlowSpans: [] };
    const mockDiagSvc = new DiagnosticsService(db, dir, {
      getTrace: () => Promise.resolve(mockSummary),
    }, undefined);
    const mockRouter = buildRouter(runSvc, mockDiagSvc, taskSvc, new SettingsService(join(dir, 'config.json')));

    const r = res();
    await mockRouter.handle(req('GET', `/runs/${runId}/testcases/tc-diag/trace`), r.res);
    expect(r.status()).toBe(200);
    expect((r.body().data as { summary: { traceId: string } } | null)?.summary.traceId).toBe('trace-xyz');

    // Summary file should be written
    const summaryFile = join(dir, 'diagnostics', runId, 'tc-diag', 'trace-summary.json');
    const written = JSON.parse(readFileSync(summaryFile, 'utf8')) as { traceId: string };
    expect(written.traceId).toBe('trace-xyz');
  });

  it('onConfigUpdated refreshes trace/log providers', async () => {
    const diagSvc = new DiagnosticsService(db, dir);
    // Calling onConfigUpdated should not throw and should swap providers
    const snapshot = await new SettingsService(join(dir, 'config.json')).getSettings();
    await expect(diagSvc.onConfigUpdated(snapshot)).resolves.toBeUndefined();
  });

  it('GET /runs/:runId/testcases/:testcaseId/analysis returns null data for unknown testcase', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/analysis`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().data).toBeNull();
  });

  it('POST /runs/:runId/testcases/:testcaseId/analysis/retry returns action result', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/testcases/tc1/analysis/retry`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().success).toBe(true);
  });

  // --- Preview / API field alignment ---
  // Verifies that the API response shapes match what the UI types.ts declares,
  // preventing silent drift between design, API, and preview layers.

  it('RunSummary fields align: runId, status, runMode, startedAt present', async () => {
    runSvc.startRun({ runMode: 'regression', selector: { suite: 'smoke' } });
    const r = res();
    await router.handle(req('GET', '/runs'), r.res);
    const items = (r.body().data as { items: Record<string, unknown>[] }).items;
    expect(items.length).toBeGreaterThan(0);
    const run = items[0] as Record<string, unknown>;
    expect(typeof run['runId']).toBe('string');
    expect(typeof run['status']).toBe('string');
    expect(typeof run['runMode']).toBe('string');
    expect(typeof run['startedAt']).toBe('string');
  });

  it('RunDetail fields align: summary.runId, summary.status, events, findings present', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}`), r.res);
    const d = r.body().data as Record<string, unknown>;
    const summary = d['summary'] as Record<string, unknown>;
    expect(typeof summary['runId']).toBe('string');
    expect(typeof summary['status']).toBe('string');
    expect(Array.isArray(d['events'])).toBe(true);
    expect(Array.isArray(d['findings'])).toBe(true);
  });

  it('SettingsSnapshot fields align: version (number), values (object), sourcePath (string)', async () => {
    const r = res();
    await router.handle(req('GET', '/settings'), r.res);
    const d = r.body().data as Record<string, unknown>;
    expect(typeof d['version']).toBe('number');
    expect(typeof d['values']).toBe('object');
    expect(typeof d['sourcePath']).toBe('string');
  });

  it('DoctorCheckResult fields align: name, status, message all strings', async () => {
    const settingsSvc = new SettingsService(join(dir, 'config.json'));
    const doctorRouter = buildRouter(runSvc, new DiagnosticsService(db, dir), taskSvc, settingsSvc, new DoctorService(db, settingsSvc));
    const r = res();
    await doctorRouter.handle(req('GET', '/doctor'), r.res);
    const checks = (r.body().data as { checks: Record<string, unknown>[] }).checks;
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(typeof c['name']).toBe('string');
      expect(typeof c['status']).toBe('string');
      expect(typeof c['message']).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Migration regression — schema must be stable and match scripts/sql
// ---------------------------------------------------------------------------

describe('Migration regression', () => {
  it('runMigrations is idempotent across all SQL files', () => {
    // Already applied in beforeEach — running again must not throw
    expect(() => { runMigrations(db, MIGRATIONS_DIR); }).not.toThrow();
  });

  it('all expected tables exist after migration', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
    for (const t of ['test_runs', 'code_tasks', 'reviews', 'commit_records', 'run_events', 'agent_sessions', '_migrations']) {
      expect(tables).toContain(t);
    }
  });

  it('_migrations versions match scripts/sql *.sql filenames exactly', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => f.replace(/\.sql$/, ''))
      .sort();

    const applied = (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: string }[]).map(r => r.version).sort();

    expect(applied).toEqual(sqlFiles);
  });

  it('test_runs has required columns', () => {
    const cols = (db.prepare("PRAGMA table_info(test_runs)").all() as { name: string }[]).map(c => c.name);
    for (const col of ['run_id', 'run_mode', 'status', 'workspace_path', 'started_at', 'updated_at']) {
      expect(cols).toContain(col);
    }
  });

  it('code_tasks has required columns', () => {
    const cols = (db.prepare("PRAGMA table_info(code_tasks)").all() as { name: string }[]).map(c => c.name);
    for (const col of ['task_id', 'run_id', 'status', 'goal', 'workspace_path', 'created_at', 'updated_at']) {
      expect(cols).toContain(col);
    }
  });

  it('key indexes exist', () => {
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map(r => r.name);
    for (const idx of [
      'idx_code_tasks_run_case_status_updated',
      'idx_reviews_task_id',
      'idx_run_events_run_created',
    ]) {
      expect(indexes).toContain(idx);
    }
  });
});

// ---------------------------------------------------------------------------
// Preview smoke checks — docs/ui-preview must contain key API/UI field names
// ---------------------------------------------------------------------------

describe('Preview smoke checks', () => {
  const PREVIEW_DIR = join(new URL('.', import.meta.url).pathname, '../../../docs/ui-preview');

  const check = (file: string, terms: string[]) => {
    const html = readFileSync(join(PREVIEW_DIR, file), 'utf8');
    for (const term of terms) {
      expect(html, `${file} must contain "${term}"`).toContain(term);
    }
  };

  it('run-list.html contains runId, runMode, status', () => {
    check('run-list.html', ['runId', 'runMode', 'status']);
  });

  it('run-detail.html contains runMode, findings, RUNNING', () => {
    check('run-detail.html', ['runMode', 'findings', 'RUNNING']);
  });

  it('settings.html contains version', () => {
    check('settings.html', ['version']);
  });

  it('code-task-detail.html contains status', () => {
    check('code-task-detail.html', ['status']);
  });
});
