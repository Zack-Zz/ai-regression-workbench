import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { openDb, runMigrations, RunRepository, ApiCallRepository, UiActionRepository, FlowStepRepository } from '@zarb/storage';
import { RunEventWriter, RunEventReader, SystemEventWriter, ExecutionProfileBuilder } from '../src/index.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-event-store-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  return () => { rmSync(dir, { recursive: true, force: true }); };
});

function makeDb() {
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function makeRun(db: ReturnType<typeof makeDb>, runId = 'r1') {
  new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/ws', startedAt: '2026-01-01T00:00:00Z' });
}

// ---------------------------------------------------------------------------
// RunEventWriter / RunEventReader
// ---------------------------------------------------------------------------

describe('RunEventWriter + RunEventReader', () => {
  it('appends and reads back events', () => {
    const db = makeDb();
    makeRun(db);
    const writer = new RunEventWriter(db);
    const reader = new RunEventReader(db);

    writer.append({ id: 'e1', runId: 'r1', entityType: 'run', entityId: 'r1', eventType: 'RUN_CREATED', createdAt: '2026-01-01T00:00:00Z' });
    writer.append({ id: 'e2', runId: 'r1', entityType: 'run', entityId: 'r1', eventType: 'RUN_STARTED', createdAt: '2026-01-01T00:00:01Z' });

    const page = reader.list('r1');
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.eventType).toBe('RUN_CREATED');
    expect(page.nextCursor).toBeUndefined();
  });

  it('cursor pagination returns correct pages', () => {
    const db = makeDb();
    makeRun(db);
    const writer = new RunEventWriter(db);
    const reader = new RunEventReader(db);

    for (let i = 0; i < 5; i++) {
      writer.append({ id: `e${String(i)}`, runId: 'r1', entityType: 'run', entityId: 'r1',
        eventType: 'RUN_STARTED', createdAt: `2026-01-01T00:00:0${String(i)}Z` });
    }

    const page1 = reader.list('r1', { limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBeDefined();

    const page2 = reader.list('r1', { limit: 3, ...(page1.nextCursor ? { cursor: page1.nextCursor } : {}) });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeUndefined();
  });

  it('stores and retrieves payload json', () => {
    const db = makeDb();
    makeRun(db);
    const writer = new RunEventWriter(db);
    const reader = new RunEventReader(db);

    writer.append({
      id: 'e1', runId: 'r1', entityType: 'testcase', entityId: 'tc1',
      eventType: 'TESTCASE_FAILED',
      payloadJson: JSON.stringify({ testcaseId: 'tc1', errorType: 'assertion' }),
      createdAt: '2026-01-01T00:00:00Z',
    });

    const item = reader.list('r1').items[0];
    expect(item?.payload).toEqual({ testcaseId: 'tc1', errorType: 'assertion' });
  });

  it('returns empty page for unknown runId', () => {
    const db = makeDb();
    const page = new RunEventReader(db).list('no-such-run');
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SystemEventWriter
// ---------------------------------------------------------------------------

describe('SystemEventWriter', () => {
  it('appends and lists system events', () => {
    const db = makeDb();
    const writer = new SystemEventWriter(db);

    writer.append({ id: 's1', eventType: 'SETTINGS_UPDATED', payloadJson: '{"key":"val"}', createdAt: '2026-01-01T00:00:00Z' });
    writer.append({ id: 's2', eventType: 'MIGRATION_APPLIED', createdAt: '2026-01-01T00:00:01Z' });

    const records = writer.list();
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.id === 's1')?.payloadJson).toBe('{"key":"val"}');
    expect(records.find((r) => r.id === 's2')?.payloadJson).toBeUndefined();
  });

  it('respects limit', () => {
    const db = makeDb();
    const writer = new SystemEventWriter(db);
    for (let i = 0; i < 5; i++) {
      writer.append({ id: `s${String(i)}`, eventType: 'SETTINGS_UPDATED', createdAt: `2026-01-01T00:00:0${String(i)}Z` });
    }
    expect(writer.list(2)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ExecutionProfileBuilder
// ---------------------------------------------------------------------------

describe('ExecutionProfileBuilder', () => {
  it('builds profile from DB and writes to disk', () => {
    const db = makeDb();
    makeRun(db);

    new ApiCallRepository(db).save({ id: 'ac1', runId: 'r1', testcaseId: 'tc1', url: '/api', method: 'GET', statusCode: 200, success: true, startedAt: '2026-01-01T00:00:00Z' });
    new UiActionRepository(db).save({ id: 'ua1', runId: 'r1', testcaseId: 'tc1', actionType: 'click', locator: '#btn', success: true, startedAt: '2026-01-01T00:00:00Z', apiCallCount: 1, failedApiCount: 0 });
    new FlowStepRepository(db).save({ id: 'fs1', runId: 'r1', testcaseId: 'tc1', flowId: 'flow1', stepName: 'login', success: true, startedAt: '2026-01-01T00:00:00Z', uiActionCount: 1, apiCallCount: 1, failedApiCount: 0 });

    const builder = new ExecutionProfileBuilder(db);
    const profile = builder.build('r1', 'tc1', dir);

    expect(profile.runId).toBe('r1');
    expect(profile.summary.apiCallCount).toBe(1);
    expect(profile.summary.uiActionCount).toBe(1);
    expect(profile.summary.flowStepCount).toBe(1);
    expect(profile.summary.failedApiCount).toBe(0);
    expect(profile.apiCalls[0]?.url).toBe('/api');
    expect(profile.uiActions[0]?.locator).toBe('#btn');
    expect(profile.flowSteps[0]?.stepName).toBe('login');

    const profilePath = join(dir, 'diagnostics', 'r1', 'tc1', 'execution-profile.json');
    expect(existsSync(profilePath)).toBe(true);
  });

  it('readFromDisk returns profile after build', () => {
    const db = makeDb();
    makeRun(db);
    const builder = new ExecutionProfileBuilder(db);
    builder.build('r1', 'tc1', dir);
    const fromDisk = builder.readFromDisk('r1', 'tc1', dir);
    expect(fromDisk?.runId).toBe('r1');
  });

  it('readFromDisk returns null when file missing', () => {
    const db = makeDb();
    const builder = new ExecutionProfileBuilder(db);
    expect(builder.readFromDisk('r1', 'tc1', dir)).toBeNull();
  });

  it('failed api calls counted in summary', () => {
    const db = makeDb();
    makeRun(db);
    new ApiCallRepository(db).save({ id: 'ac1', runId: 'r1', testcaseId: 'tc1', url: '/api', success: false, startedAt: '2026-01-01T00:00:00Z' });
    const profile = new ExecutionProfileBuilder(db).build('r1', 'tc1', dir);
    expect(profile.summary.failedApiCount).toBe(1);
    expect(profile.apiCalls[0]?.success).toBe(false);
  });

  it('sets scenarioId when provided', () => {
    const db = makeDb();
    makeRun(db);
    const profile = new ExecutionProfileBuilder(db).build('r1', 'tc1', dir, 'sc1');
    expect(profile.scenarioId).toBe('sc1');
  });
});
