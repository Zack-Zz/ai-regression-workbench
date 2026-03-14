import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { openDb, runMigrations, RunRepository, CodeTaskRepository } from '@zarb/storage';
import { RunService } from '../src/services/run-service.js';
import { DiagnosticsService } from '../src/services/diagnostics-service.js';
import { CodeTaskService } from '../src/services/code-task-service.js';
import { SettingsService } from '../src/services/settings-service.js';
import { buildRouter } from '../src/handlers/index.js';
import { Router } from '../src/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;
let db: ReturnType<typeof openDb>;
let router: Router;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-api-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  router = buildRouter(
    new RunService(db),
    new DiagnosticsService(db),
    new CodeTaskService(db),
    new SettingsService(join(dir, 'config.json')),
  );
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const bodyStr = body ? JSON.stringify(body) : '';
  const stream = Readable.from([bodyStr]) as unknown as IncomingMessage;
  stream.method = method;
  stream.url = url;
  return stream;
}

function mockRes(): { res: ServerResponse; body: () => unknown; status: () => number } {
  let statusCode = 200;
  let rawBody = '';
  const res = {
    writeHead: (code: number) => { statusCode = code; },
    end: (data: string) => { rawBody = data; },
  } as unknown as ServerResponse;
  return { res, body: () => JSON.parse(rawBody) as unknown, status: () => statusCode };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

describe('Router', () => {
  it('returns 404 for unknown route', async () => {
    const { res, status } = mockRes();
    await router.handle(mockReq('GET', '/unknown'), res);
    expect(status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// RunService
// ---------------------------------------------------------------------------

describe('RunService', () => {
  it('startRun creates a run and returns summary', () => {
    const svc = new RunService(db);
    const result = svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    expect(result.success).toBe(true);
    expect(result.run?.runMode).toBe('regression');
  });

  it('startRun fails without selector for regression', () => {
    const svc = new RunService(db);
    const result = svc.startRun({ runMode: 'regression' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RUN_SELECTOR_INVALID');
  });

  it('listRuns returns created runs', () => {
    const svc = new RunService(db);
    svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const page = svc.listRuns();
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('getRun returns null for unknown runId', () => {
    expect(new RunService(db).getRun('nope')).toBeNull();
  });

  it('cancelRun returns error for unknown run', () => {
    const result = new RunService(db).cancelRun('nope');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RUN_NOT_FOUND');
  });

  it('cancelRun succeeds for existing run', () => {
    const svc = new RunService(db);
    const created = svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId;
    expect(runId).toBeDefined();
    const result = svc.cancelRun(runId as string);
    expect(result.success).toBe(true);
  });

  it('cancelRun returns ALREADY_CANCELLED on second cancel', () => {
    const svc = new RunService(db);
    const created = svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    svc.cancelRun(runId);
    const result = svc.cancelRun(runId);
    expect(result.errorCode).toBe('RUN_ALREADY_CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// CodeTaskService
// ---------------------------------------------------------------------------

describe('CodeTaskService', () => {
  function seedRun(): void {
    new RunRepository(db).create({ runId: 'r1', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
  }

  it('approveCodeTask returns not found for unknown task', () => {
    const result = new CodeTaskService(db).approveCodeTask('nope');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CODE_TASK_NOT_FOUND');
  });

  it('submitReview creates review and transitions task', () => {
    seedRun();
    new CodeTaskRepository(db).create({ taskId: 't1', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    const svc = new CodeTaskService(db);
    const result = svc.submitReview({ taskId: 't1', decision: 'accept', codeTaskVersion: 1 });
    expect(result.success).toBe(true);
    const detail = svc.getCodeTask('t1');
    expect(detail?.reviews).toHaveLength(1);
    expect(detail?.summary.status).toBe('COMMIT_PENDING');
  });
});

// ---------------------------------------------------------------------------
// SettingsService
// ---------------------------------------------------------------------------

describe('SettingsService', () => {
  it('getSettings returns default values', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const snap = await svc.getSettings();
    expect(snap.version).toBe(1);
    const port = (snap.values.report as { port: number }).port;
    expect(typeof port).toBe('number');
  });

  it('updateSettings persists and increments version', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const result = await svc.updateSettings({ patch: { report: { port: 8080 } } });
    expect(result.success).toBe(true);
    expect(result.version).toBe(2);
    const snap = await svc.getSettings();
    const port = (snap.values.report as { port: number }).port;
    expect(port).toBe(8080);
  });

  it('updateSettings rejects invalid port', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const result = await svc.updateSettings({ patch: { report: { port: 0 } } });
    expect(result.success).toBe(false);
  });

  it('updateSettings rejects version conflict', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const result = await svc.updateSettings({ patch: {}, expectedVersion: 99 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler integration
// ---------------------------------------------------------------------------

describe('GET /runs', () => {
  it('returns success with items array', async () => {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('GET', '/runs'), res);
    expect(status()).toBe(200);
    const b = body() as { success: boolean; data: { items: unknown[] } };
    expect(b.success).toBe(true);
    expect(Array.isArray(b.data.items)).toBe(true);
  });
});

describe('GET /settings', () => {
  it('returns settings snapshot', async () => {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('GET', '/settings'), res);
    expect(status()).toBe(200);
    const b = body() as { success: boolean; data: { version: number } };
    expect(b.data.version).toBe(1);
  });
});

describe('GET /runs/:runId (not found)', () => {
  it('returns 404', async () => {
    const { res, status } = mockRes();
    await router.handle(mockReq('GET', '/runs/nope'), res);
    expect(status()).toBe(404);
  });
});
