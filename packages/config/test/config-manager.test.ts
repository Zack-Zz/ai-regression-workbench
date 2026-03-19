import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../src/config-manager.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-cm-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function configPath(name = 'config.yaml'): string {
  return join(dir, name);
}

describe('ConfigManager.getSettings', () => {
  it('returns snapshot version 1 on init', async () => {
    const cm = new ConfigManager(configPath());
    const snap = await cm.getSettings();
    expect(snap.version).toBe(1);
  });

  it('default values are isolated from DEFAULT_SETTINGS', async () => {
    const cm = new ConfigManager(configPath());
    const snap = await cm.getSettings();
    const active = snap.values.ai.activeProvider;
    snap.values.ai.providers[active]!.model = 'mutated';
    expect(DEFAULT_SETTINGS.ai.providers[DEFAULT_SETTINGS.ai.activeProvider]!.model).not.toBe('mutated');
  });
});

describe('ConfigManager.validateSettings', () => {
  it('accepts valid patch', async () => {
    const cm = new ConfigManager(configPath());
    const result = await cm.validateSettings({ patch: { report: { port: 4000 } } });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid port', async () => {
    const cm = new ConfigManager(configPath());
    const result = await cm.validateSettings({ patch: { report: { port: 99999 } } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/port/);
  });

  it('rejects maxSteps < 1', async () => {
    const cm = new ConfigManager(configPath());
    const result = await cm.validateSettings({ patch: { exploration: { maxSteps: 0 } } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/maxSteps/);
  });
});

describe('ConfigManager.updateSettings', () => {
  it('increments version on success', async () => {
    const cm = new ConfigManager(configPath());
    const result = await cm.updateSettings({ patch: { report: { port: 4001 } } });
    expect(result.success).toBe(true);
    expect(result.version).toBe(2);
    const snap = await cm.getSettings();
    expect(snap.version).toBe(2);
    expect(snap.values.report.port).toBe(4001);
  });

  it('rejects on version conflict', async () => {
    const cm = new ConfigManager(configPath());
    const result = await cm.updateSettings({ patch: { report: { port: 4002 } }, expectedVersion: 99 });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/conflict/i);
  });

  it('rejects invalid patch without writing', async () => {
    const cm = new ConfigManager(configPath());
    const result = await cm.updateSettings({ patch: { report: { port: -1 } } });
    expect(result.success).toBe(false);
    const snap = await cm.getSettings();
    expect(snap.version).toBe(1); // unchanged
  });

  it('persists to file', async () => {
    const file = configPath();
    const cm = new ConfigManager(file);
    await cm.updateSettings({ patch: { report: { port: 5555 } } });
    const cm2 = new ConfigManager(file);
    const snap = await cm2.getSettings();
    expect(snap.values.report.port).toBe(5555);
  });

  it('version survives instance recreation', async () => {
    const file = configPath();
    const cm = new ConfigManager(file);
    await cm.updateSettings({ patch: { report: { port: 4010 } } });
    expect((await cm.getSettings()).version).toBe(2);
    const cm2 = new ConfigManager(file);
    expect((await cm2.getSettings()).version).toBe(2);
  });

  it('expectedVersion conflict works across instances', async () => {
    const file = configPath();
    const cm = new ConfigManager(file);
    await cm.updateSettings({ patch: { report: { port: 4011 } } });
    const cm2 = new ConfigManager(file);
    const result = await cm2.updateSettings({ patch: { report: { port: 4012 } }, expectedVersion: 1 });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/conflict/i);
  });
});

describe('ConfigManager observer broadcast', () => {
  it('notifies registered observers on update', async () => {
    const cm = new ConfigManager(configPath());
    const received: number[] = [];
    cm.registerObserver({
      onConfigUpdated: (snap) => { received.push(snap.version); return Promise.resolve(); },
    });
    await cm.updateSettings({ patch: { report: { port: 4003 } } });
    expect(received).toEqual([2]);
  });

  it('notifies multiple observers in order', async () => {
    const cm = new ConfigManager(configPath());
    const log: string[] = [];
    cm.registerObserver({ onConfigUpdated: () => { log.push('a'); return Promise.resolve(); } });
    cm.registerObserver({ onConfigUpdated: () => { log.push('b'); return Promise.resolve(); } });
    await cm.updateSettings({ patch: { report: { port: 4004 } } });
    expect(log).toEqual(['a', 'b']);
  });
});

describe('loadSettingsFromFile isolation', () => {
  it('mutating returned value does not pollute DEFAULT_SETTINGS', async () => {
    const { loadSettingsFromFile } = await import('../src/loader.js');
    const result = loadSettingsFromFile(join(dir, 'nonexistent.yaml'));
    const active = result.ai.activeProvider;
    result.ai.providers[active]!.model = 'polluted';
    expect(DEFAULT_SETTINGS.ai.providers[DEFAULT_SETTINGS.ai.activeProvider]!.model).not.toBe('polluted');
  });
});

describe('CODE_TASK_TERMINAL_STATUSES includes FAILED', () => {
  it('FAILED is a terminal status', async () => {
    const { CODE_TASK_TERMINAL_STATUSES } = await import('@zarb/shared-types');
    expect(CODE_TASK_TERMINAL_STATUSES.has('FAILED')).toBe(true);
  });
});
