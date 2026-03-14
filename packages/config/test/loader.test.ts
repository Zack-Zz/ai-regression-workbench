import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSettingsFromFile, resolveExplorationConfig, buildSnapshot } from '../src/loader.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';

describe('loadSettingsFromFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `zarb-config-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when file does not exist', () => {
    const result = loadSettingsFromFile(join(dir, 'nonexistent.yaml'));
    expect(result.report.port).toBe(DEFAULT_SETTINGS.report.port);
    expect(result.ai.model).toBe(DEFAULT_SETTINGS.ai.model);
  });
  it('merges user values over defaults', () => {
    const file = join(dir, 'config.yaml');
    writeFileSync(file, 'report:\n  port: 4000\n');
    const result = loadSettingsFromFile(file);
    expect(result.report.port).toBe(4000);
    // other defaults preserved
    expect(result.ai.model).toBe(DEFAULT_SETTINGS.ai.model);
  });

  it('deep-merges nested objects', () => {
    const file = join(dir, 'config.yaml');
    writeFileSync(file, 'diagnostics:\n  correlationKeys:\n    timeWindowSeconds: 60\n');
    const result = loadSettingsFromFile(file);
    expect(result.diagnostics.correlationKeys.timeWindowSeconds).toBe(60);
    // sibling keys preserved
    expect(result.diagnostics.correlationKeys.caseInsensitiveHeaderMatch).toBe(true);
  });

  it('returns defaults for empty yaml file', () => {
    const file = join(dir, 'empty.yaml');
    writeFileSync(file, '');
    const result = loadSettingsFromFile(file);
    expect(result.report.port).toBe(DEFAULT_SETTINGS.report.port);
  });
});

describe('resolveExplorationConfig', () => {
  it('returns defaults when no overrides', () => {
    const result = resolveExplorationConfig(undefined, undefined);
    expect(result.maxSteps).toBe(DEFAULT_SETTINGS.exploration?.maxSteps ?? 80);
    expect(result.maxPages).toBe(DEFAULT_SETTINGS.exploration?.maxPages ?? 20);
  });

  it('user settings override defaults', () => {
    const result = resolveExplorationConfig(undefined, { maxSteps: 50 });
    expect(result.maxSteps).toBe(50);
    expect(result.maxPages).toBe(DEFAULT_SETTINGS.exploration?.maxPages ?? 20);
  });

  it('run input overrides user settings', () => {
    const result = resolveExplorationConfig({ maxSteps: 10 }, { maxSteps: 50 });
    expect(result.maxSteps).toBe(10);
  });

  it('produces a fully resolved object with no undefined fields', () => {
    const result = resolveExplorationConfig(undefined, undefined);
    expect(result.defaultMode).toBeDefined();
    expect(result.maxSteps).toBeDefined();
    expect(result.maxPages).toBeDefined();
    expect(result.allowedHosts).toBeDefined();
    expect(result.defaultFocusAreas).toBeDefined();
    expect(typeof result.persistAsCandidateTests).toBe('boolean');
  });
});

describe('buildSnapshot', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `zarb-snapshot-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds a snapshot with the given version and timestamp', () => {
    const file = join(dir, 'config.yaml');
    writeFileSync(file, 'report:\n  port: 5000\n');
    const snap = buildSnapshot(file, 3, '2026-03-14T00:00:00.000Z');
    expect(snap.version).toBe(3);
    expect(snap.updatedAt).toBe('2026-03-14T00:00:00.000Z');
    expect(snap.sourcePath).toBe(file);
    expect(snap.values.report.port).toBe(5000);
  });
});
