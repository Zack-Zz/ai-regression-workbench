import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InitService } from '../src/services/init-service.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-init-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('InitService', () => {
  it('creates workbench directory structure on first init', () => {
    const svc = new InitService(MIGRATIONS_DIR);
    const result = svc.init(dir);

    expect(result.alreadyInitialized).toBe(false);
    expect(existsSync(join(dir, '.zarb', 'config.local.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.zarb', 'data', 'sqlite'))).toBe(true);
    expect(existsSync(join(dir, '.zarb', 'data', 'runs'))).toBe(true);
    expect(existsSync(join(dir, '.zarb', 'data', 'artifacts'))).toBe(true);
    expect(existsSync(join(dir, '.zarb', 'data', 'code-tasks'))).toBe(true);
  });

  it('writes default config with expected keys', () => {
    const svc = new InitService(MIGRATIONS_DIR);
    svc.init(dir);
    const config = readFileSync(join(dir, '.zarb', 'config.local.yaml'), 'utf8');
    expect(config).toContain('storage:');
    expect(config).toContain('report:');
    expect(config).toContain('workspace:');
    expect(config).toContain('ai:');
  });

  it('does not overwrite existing config on second init', () => {
    const svc = new InitService(MIGRATIONS_DIR);
    svc.init(dir);
    const configPath = join(dir, '.zarb', 'config.local.yaml');
    // Modify config
    const original = readFileSync(configPath, 'utf8');
    const modified = original + '\n# custom\n';
    writeFileSync(configPath, modified, 'utf8');

    const result = svc.init(dir);
    expect(result.alreadyInitialized).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(modified);
  });

  it('isInitialized returns false before init and true after', () => {
    const svc = new InitService(MIGRATIONS_DIR);
    expect(svc.isInitialized(dir)).toBe(false);
    svc.init(dir);
    expect(svc.isInitialized(dir)).toBe(true);
  });

  it('runs migrations and creates sqlite db', () => {
    const svc = new InitService(MIGRATIONS_DIR);
    svc.init(dir);
    expect(existsSync(join(dir, '.zarb', 'data', 'sqlite', 'zarb.db'))).toBe(true);
  });
});
