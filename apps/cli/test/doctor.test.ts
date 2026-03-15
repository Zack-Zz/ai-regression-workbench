import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { openDb, runMigrations } from '@zarb/storage';
import { SettingsService } from '../src/services/settings-service.js';
import { DoctorService } from '../src/services/doctor-service.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;
let db: ReturnType<typeof openDb>;
let svc: DoctorService;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-doctor-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  svc = new DoctorService(db, new SettingsService(join(dir, 'config.json')));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('DoctorService', () => {
  it('returns a result with checks array', async () => {
    const result = await svc.runChecks();
    expect(result).toHaveProperty('healthy');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('each check has name, status, message', async () => {
    const { checks } = await svc.runChecks();
    for (const c of checks) {
      expect(c).toHaveProperty('name');
      expect(['ok', 'warn', 'fail']).toContain(c.status);
      expect(typeof c.message).toBe('string');
    }
  });

  it('sqlite.wal check passes (WAL enabled by openDb)', async () => {
    const { checks } = await svc.runChecks();
    const wal = checks.find(c => c.name === 'sqlite.wal');
    expect(wal?.status).toBe('ok');
  });

  it('sqlite.schema check passes after migrations', async () => {
    const { checks } = await svc.runChecks();
    const schema = checks.find(c => c.name === 'sqlite.schema');
    expect(schema?.status).toBe('ok');
  });

  it('sqlite.schema fails when migration is missing', async () => {
    // Remove a migration record to simulate missing migration
    db.prepare("DELETE FROM _migrations WHERE version = '001_initial_schema'").run();
    const { checks } = await svc.runChecks();
    const schema = checks.find(c => c.name === 'sqlite.schema');
    expect(schema?.status).toBe('fail');
    expect(schema?.message).toContain('001_initial_schema');
  });

  it('sqlite.schema fails when unexpected migration exists', async () => {
    db.prepare("INSERT INTO _migrations (version, applied_at) VALUES ('999_unknown', ?)").run(new Date().toISOString());
    const { checks } = await svc.runChecks();
    const schema = checks.find(c => c.name === 'sqlite.schema');
    expect(schema?.status).toBe('fail');
    expect(schema?.message).toContain('999_unknown');
  });

  it('node.version check is ok on current node', async () => {
    const { checks } = await svc.runChecks();
    const node = checks.find(c => c.name === 'node.version');
    expect(node?.status).toBe('ok');
  });

  it('healthy is false when any check fails', async () => {
    db.prepare("DELETE FROM _migrations WHERE version = '001_initial_schema'").run();
    const result = await svc.runChecks();
    expect(result.healthy).toBe(false);
  });
});
