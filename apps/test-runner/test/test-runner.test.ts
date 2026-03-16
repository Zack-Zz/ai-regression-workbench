/**
 * apps/test-runner/test/test-runner.test.ts
 *
 * Unit tests for TestRunner.execute() covering:
 * - annotation-derived vs title-hash testcaseId
 * - degraded event when zarb-testcase-id annotation is absent
 * - skipped tests do NOT emit TESTCASE_FAILED
 * - networkLogPath persisted as first-class artifact
 * - startup failure when workspacePath does not exist
 * - run counter updates
 *
 * Strategy: pre-write the Playwright JSON report file so the runner reads it
 * from disk. Mock child_process.spawn to exit immediately so the runner skips
 * the real Playwright invocation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  openDb,
  runMigrations,
  RunRepository,
  TestResultRepository,
  RunEventRepository,
} from '@zarb/storage';
import { TestRunner } from '../src/index.js';

// Mock child_process.spawn before the runner module is loaded so it picks up
// the mock. The runner reads the JSON report from file; spawn just needs to
// exit cleanly.
// For --list calls, the mock emits a JSON report on stdout so resolveIdToTitle
// can parse it.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawn: vi.fn((_cmd: string, args: string[]) => {
      const proc = new EventEmitter();
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: vi.fn() });
      // For --list invocations, emit the current test list JSON on stdout
      if (args.includes('--list')) {
        setImmediate(() => {
          // Emit the shared list report if set, otherwise empty
          const report = (globalThis as Record<string, unknown>).__listReport as string | undefined;
          if (report) stdout.emit('data', Buffer.from(report));
          proc.emit('close', 0);
        });
      } else {
        setImmediate(() => proc.emit('close', 0));
      }
      return proc;
    }),
  };
});

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleHash(title: string): string {
  return createHash('sha256').update(title).digest('hex').slice(0, 16);
}

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-runner-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  return () => { rmSync(dir, { recursive: true, force: true }); };
});

function makeDb() {
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function makeRun(db: ReturnType<typeof makeDb>, runId: string) {
  new RunRepository(db).create({
    runId,
    scopeType: 'suite',
    workspacePath: dir,
    startedAt: new Date().toISOString(),
  });
}

interface TestSpec {
  title: string;
  suiteTitle?: string;
  status: 'passed' | 'failed' | 'skipped';
  annotations?: Array<{ type: string; description?: string }>;
  attachments?: Array<{ name: string; path?: string; contentType: string }>;
  error?: { message: string };
}

/** Write a minimal Playwright JSON report to the expected path. */
function writeReport(dataRoot: string, runId: string, tests: TestSpec[]) {
  const suiteTitle = tests[0]?.suiteTitle ?? 'MySuite';
  const suiteTests = tests.map(t => ({
    title: t.title,
    ok: t.status === 'passed',
    status: t.status,
    duration: 100,
    annotations: t.annotations ?? [],
    results: [
      {
        status: t.status,
        duration: 100,
        startTime: new Date().toISOString(),
        attachments: t.attachments ?? [],
        ...(t.error ? { error: t.error } : {}),
      },
    ],
  }));
  const report = { suites: [{ title: suiteTitle, tests: suiteTests, suites: [] }] };
  mkdirSync(join(dataRoot, 'runs'), { recursive: true });
  writeFileSync(join(dataRoot, 'runs', `${runId}-pw-report.json`), JSON.stringify(report));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TestRunner', () => {
  it('uses title hash as testcaseId when zarb-testcase-id annotation is absent', async () => {
    const db = makeDb();
    makeRun(db, 'run-1');
    writeReport(dir, 'run-1', [{ title: 'my test', status: 'passed' }]);

    const runner = new TestRunner(db);
    const result = await runner.execute({ runId: 'run-1', workspacePath: dir, dataRoot: dir });

    expect(result.startupFailure).toBe(false);
    expect(result.passed).toBe(1);

    const rows = new TestResultRepository(db).findByRun('run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.testcase_id).toBe(titleHash('MySuite > my test'));
  });

  it('uses zarb-testcase-id annotation as testcaseId when present', async () => {
    const db = makeDb();
    makeRun(db, 'run-2');
    writeReport(dir, 'run-2', [
      {
        title: 'annotated test',
        status: 'passed',
        annotations: [{ type: 'zarb-testcase-id', description: 'tc-abc-123' }],
      },
    ]);

    const runner = new TestRunner(db);
    await runner.execute({ runId: 'run-2', workspacePath: dir, dataRoot: dir });

    const rows = new TestResultRepository(db).findByRun('run-2');
    expect(rows[0]?.testcase_id).toBe('tc-abc-123');
  });

  it('persists scenarioId from zarb-scenario-id annotation', async () => {
    const db = makeDb();
    makeRun(db, 'run-3');
    writeReport(dir, 'run-3', [
      {
        title: 'scenario test',
        status: 'passed',
        annotations: [
          { type: 'zarb-testcase-id', description: 'tc-1' },
          { type: 'zarb-scenario-id', description: 'sc-login' },
        ],
      },
    ]);

    const runner = new TestRunner(db);
    await runner.execute({ runId: 'run-3', workspacePath: dir, dataRoot: dir });

    const rows = new TestResultRepository(db).findByRun('run-3');
    expect(rows[0]?.scenario_id).toBe('sc-login');
  });

  it('emits RUN_STEP_DEGRADED when zarb-testcase-id annotation is absent', async () => {
    const db = makeDb();
    makeRun(db, 'run-4');
    writeReport(dir, 'run-4', [{ title: 'unannotated', status: 'passed' }]);

    const runner = new TestRunner(db);
    await runner.execute({ runId: 'run-4', workspacePath: dir, dataRoot: dir });

    const events = new RunEventRepository(db).list('run-4').items;
    const degraded = events.filter(e => e.event_type === 'RUN_STEP_DEGRADED');
    expect(degraded.length).toBeGreaterThan(0);
    expect(degraded[0]?.payload_json).toContain('zarb-testcase-id annotation missing');
  });

  it('does NOT emit TESTCASE_FAILED for skipped tests', async () => {
    const db = makeDb();
    makeRun(db, 'run-5');
    writeReport(dir, 'run-5', [{ title: 'skipped test', status: 'skipped' }]);

    const runner = new TestRunner(db);
    const result = await runner.execute({ runId: 'run-5', workspacePath: dir, dataRoot: dir });

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);

    const events = new RunEventRepository(db).list('run-5').items;
    const failEvents = events.filter(e => e.event_type === 'TESTCASE_FAILED');
    expect(failEvents).toHaveLength(0);
  });

  it('persists networkLogPath when HAR attachment is present', async () => {
    const db = makeDb();
    makeRun(db, 'run-6');

    const harPath = join(dir, 'network.har');
    writeFileSync(harPath, JSON.stringify({ log: { entries: [] } }));

    writeReport(dir, 'run-6', [
      {
        title: 'network test',
        status: 'passed',
        annotations: [{ type: 'zarb-testcase-id', description: 'tc-net' }],
        attachments: [{ name: 'network', path: harPath, contentType: 'application/json' }],
      },
    ]);

    const runner = new TestRunner(db);
    await runner.execute({ runId: 'run-6', workspacePath: dir, dataRoot: dir });

    const rows = new TestResultRepository(db).findByRun('run-6');
    expect(rows[0]?.network_log_path).toBeTruthy();
  });

  it('returns startupFailure when workspacePath does not exist', async () => {
    const db = makeDb();
    makeRun(db, 'run-7');

    const runner = new TestRunner(db);
    const result = await runner.execute({
      runId: 'run-7',
      workspacePath: '/nonexistent/path/xyz',
      dataRoot: dir,
    });

    expect(result.startupFailure).toBe(true);
    expect(result.total).toBe(0);
  });

  it('updates run counters after execution', async () => {
    const db = makeDb();
    makeRun(db, 'run-8');
    writeReport(dir, 'run-8', [
      { title: 'pass 1', status: 'passed', annotations: [{ type: 'zarb-testcase-id', description: 'tc-p1' }] },
      { title: 'fail 1', status: 'failed', annotations: [{ type: 'zarb-testcase-id', description: 'tc-f1' }] },
      { title: 'skip 1', status: 'skipped', annotations: [{ type: 'zarb-testcase-id', description: 'tc-s1' }] },
    ]);

    const runner = new TestRunner(db);
    const result = await runner.execute({ runId: 'run-8', workspacePath: dir, dataRoot: dir });

    expect(result).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });

    const row = new RunRepository(db).findById('run-8');
    expect(row?.total).toBe(3);
    expect(row?.passed).toBe(1);
    expect(row?.failed).toBe(1);
    expect(row?.skipped).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Selector translation
  // ---------------------------------------------------------------------------

  it('testcaseId selector resolves title via --list and passes --grep to Playwright', async () => {
    const db = makeDb();
    makeRun(db, 'run-9');

    // The list report contains two tests with annotation IDs
    const listReport = {
      suites: [{
        title: 'MySuite',
        tests: [
          { title: 'test A', ok: true, status: 'passed', duration: 0, annotations: [{ type: 'zarb-testcase-id', description: 'tc-A' }], results: [] },
          { title: 'test B', ok: true, status: 'passed', duration: 0, annotations: [{ type: 'zarb-testcase-id', description: 'tc-B' }], results: [] },
        ],
        suites: [],
      }],
    };
    (globalThis as Record<string, unknown>).__listReport = JSON.stringify(listReport);

    // The execution report only contains test A (Playwright filtered by --grep)
    writeReport(dir, 'run-9', [
      { title: 'test A', status: 'passed', annotations: [{ type: 'zarb-testcase-id', description: 'tc-A' }] },
    ]);

    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockClear();

    const runner = new TestRunner(db);
    const result = await runner.execute({
      runId: 'run-9',
      workspacePath: dir,
      dataRoot: dir,
      selector: { testcaseId: 'tc-A' },
    });

    (globalThis as Record<string, unknown>).__listReport = undefined;

    // Verify --grep was passed with an anchored exact-match pattern
    const execCall = spawnMock.mock.calls.find(c => !c[1].includes('--list'));
    const grepArg = execCall?.[1]?.[execCall[1].indexOf('--grep') + 1] ?? '';
    expect(grepArg).toMatch(/^\^.*\$$/); // anchored: starts with ^ ends with $
    expect(grepArg).toContain('test A'); // contains the resolved title
    expect(grepArg).not.toContain('|'); // single title, no alternation

    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    const rows = new TestResultRepository(db).findByRun('run-9');
    expect(rows[0]?.testcase_id).toBe('tc-A');
  });

  it('scenarioId selector resolves all matching titles via --list and passes combined --grep to Playwright', async () => {
    const db = makeDb();
    makeRun(db, 'run-10');

    // Two testcases share the same scenarioId
    const listReport = {
      suites: [{
        title: 'MySuite',
        tests: [
          {
            title: 'login test',
            ok: true, status: 'passed', duration: 0,
            annotations: [
              { type: 'zarb-testcase-id', description: 'tc-login' },
              { type: 'zarb-scenario-id', description: 'sc-auth' },
            ],
            results: [],
          },
          {
            title: 'logout test',
            ok: true, status: 'passed', duration: 0,
            annotations: [
              { type: 'zarb-testcase-id', description: 'tc-logout' },
              { type: 'zarb-scenario-id', description: 'sc-auth' },
            ],
            results: [],
          },
        ],
        suites: [],
      }],
    };
    (globalThis as Record<string, unknown>).__listReport = JSON.stringify(listReport);

    writeReport(dir, 'run-10', [
      {
        title: 'login test',
        status: 'passed',
        annotations: [
          { type: 'zarb-testcase-id', description: 'tc-login' },
          { type: 'zarb-scenario-id', description: 'sc-auth' },
        ],
      },
      {
        title: 'logout test',
        status: 'passed',
        annotations: [
          { type: 'zarb-testcase-id', description: 'tc-logout' },
          { type: 'zarb-scenario-id', description: 'sc-auth' },
        ],
      },
    ]);

    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockClear();

    const runner = new TestRunner(db);
    const result = await runner.execute({
      runId: 'run-10',
      workspacePath: dir,
      dataRoot: dir,
      selector: { scenarioId: 'sc-auth' },
    });

    (globalThis as Record<string, unknown>).__listReport = undefined;

    // Verify --grep was passed with an anchored combined pattern (no substring collision)
    const execCall = spawnMock.mock.calls.find(c => !c[1].includes('--list'));
    const grepArg = execCall?.[1]?.[execCall[1].indexOf('--grep') + 1] ?? '';
    expect(grepArg).toMatch(/^\(.*\)$/); // wrapped in group
    expect(grepArg).toContain('login test');
    expect(grepArg).toContain('logout test');
    // Each title is anchored (no substring collision)
    expect(grepArg).toMatch(/\^.*login test.*\$/);
    expect(grepArg).toMatch(/\^.*logout test.*\$/);

    expect(result.total).toBe(2);
    const rows = new TestResultRepository(db).findByRun('run-10');
    expect(rows.map(r => r.testcase_id).sort()).toEqual(['tc-login', 'tc-logout']);
  });

  it('testcaseId selector returns startupFailure when no matching test found', async () => {
    const db = makeDb();
    makeRun(db, 'run-11');

    // Empty list report — no tests
    (globalThis as Record<string, unknown>).__listReport = JSON.stringify({ suites: [] });

    const runner = new TestRunner(db);
    const result = await runner.execute({
      runId: 'run-11',
      workspacePath: dir,
      dataRoot: dir,
      selector: { testcaseId: 'tc-nonexistent' },
    });

    (globalThis as Record<string, unknown>).__listReport = undefined;

    expect(result.startupFailure).toBe(true);
    expect(result.total).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // cancel() terminates the child process
  // ---------------------------------------------------------------------------

  it('cancel() kills the active process and prevents further status updates', () => {
    const db = makeDb();
    makeRun(db, 'run-12');

    const runner = new TestRunner(db);
    // cancel on a run that has no active process is a no-op
    expect(() => { runner.cancel('run-12'); }).not.toThrow();
  });
});
