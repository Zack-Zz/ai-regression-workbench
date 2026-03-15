import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { openDb, runMigrations, RunRepository } from '@zarb/storage';
import { HarnessSessionManager } from '../src/session-manager.js';
import { ObservedHarness } from '../src/observed-harness.js';
import type { ObservabilityAdapter } from '../src/observability.js';
import { DEFAULT_EXPLORATION_POLICY } from '../src/harness-policy.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-observed-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  new RunRepository(db).create({ runId: 'r1', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeAdapter() {
  const events: ObservabilityEvent[] = [];
  const onSessionStart = vi.fn((e: ObservabilityEvent) => { events.push(e); });
  const onSessionEnd = vi.fn((e: ObservabilityEvent) => { events.push(e); });
  const onEvent = vi.fn((e: ObservabilityEvent) => { events.push(e); });
  const adapter: ObservabilityAdapter = { onSessionStart, onSessionEnd, onEvent };
  return { adapter, events, onSessionStart, onSessionEnd, onEvent };
}

describe('ObservedHarness', () => {
  it('emits session_start on startSession', () => {
    const { adapter, onSessionStart } = makeAdapter();
    const harness = new ObservedHarness(new HarnessSessionManager(db), adapter);
    harness.startSession({ runId: 'r1', kind: 'exploration', agentName: 'test-agent', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    expect(onSessionStart).toHaveBeenCalledOnce();
    expect(onSessionStart.mock.calls[0][0]).toMatchObject({ eventType: 'session_start', runId: 'r1' });
  });

  it('emits session_end on completeSession', () => {
    const { adapter, onSessionEnd } = makeAdapter();
    const harness = new ObservedHarness(new HarnessSessionManager(db), adapter);
    const row = harness.startSession({ runId: 'r1', kind: 'exploration', agentName: 'test-agent', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    harness.completeSession(row.session_id);
    expect(onSessionEnd).toHaveBeenCalledOnce();
    expect(onSessionEnd.mock.calls[0][0]).toMatchObject({ eventType: 'session_end' });
  });

  it('emits session_end on cancelSession', () => {
    const { adapter, onSessionEnd } = makeAdapter();
    const harness = new ObservedHarness(new HarnessSessionManager(db), adapter);
    const row = harness.startSession({ runId: 'r1', kind: 'exploration', agentName: 'test-agent', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    harness.cancelSession(row.session_id);
    expect(onSessionEnd).toHaveBeenCalledOnce();
  });

  it('emits step event on appendStep', () => {
    const { adapter, onEvent } = makeAdapter();
    const harness = new ObservedHarness(new HarnessSessionManager(db), adapter);
    const row = harness.startSession({ runId: 'r1', kind: 'exploration', agentName: 'test-agent', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    harness.appendStep(row.session_id, { stepIndex: 0, description: 'click', outcome: 'ok', timestamp: new Date().toISOString() }, dir);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0]).toMatchObject({ eventType: 'step' });
  });

  it('swallows adapter errors without throwing', () => {
    const throwingFn = vi.fn(() => { throw new Error('adapter boom'); });
    const adapter: ObservabilityAdapter = {
      onSessionStart: throwingFn,
      onSessionEnd: vi.fn(),
      onEvent: vi.fn(),
    };
    const harness = new ObservedHarness(new HarnessSessionManager(db), adapter);
    expect(() => {
      harness.startSession({ runId: 'r1', kind: 'exploration', agentName: 'test-agent', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    }).not.toThrow();
  });

  it('delegates resumeSession to inner', () => {
    const { adapter } = makeAdapter();
    const inner = new HarnessSessionManager(db);
    const harness = new ObservedHarness(inner, adapter);
    const row = harness.startSession({ runId: 'r1', kind: 'exploration', agentName: 'test-agent', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    inner.commitPause(row.session_id, { checkpointId: 'cp1', stepIndex: 0, timestamp: new Date().toISOString() }, dir);
    const resumed = harness.resumeSession(row.session_id);
    expect(resumed.status).toBe('running');
  });
});
