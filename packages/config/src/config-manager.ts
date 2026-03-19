import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dump as dumpYaml } from 'js-yaml';
import type {
  ConfigObserver,
  PersonalSettings,
  SettingsApplyResult,
  SettingsService,
  SettingsSnapshot,
  SettingsValidationResult,
  UpdateSettingsInput,
} from '@zarb/shared-types';
import { buildSnapshot } from './loader.js';

interface ConfigMeta {
  version: number;
  updatedAt: string;
}

function metaPath(configPath: string): string {
  return `${configPath}.meta.json`;
}

function readMeta(configPath: string): ConfigMeta {
  const mp = metaPath(configPath);
  if (!existsSync(mp)) return { version: 1, updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(readFileSync(mp, 'utf8')) as ConfigMeta;
  } catch {
    return { version: 1, updatedAt: new Date().toISOString() };
  }
}

function writeMeta(configPath: string, meta: ConfigMeta): void {
  writeFileSync(metaPath(configPath), JSON.stringify(meta), 'utf8');
}

/**
 * Minimal ConfigManager implementing SettingsService.
 * Version is persisted to a sidecar `.meta.json` file so it survives restarts.
 */
export class ConfigManager implements SettingsService {
  private snapshot: SettingsSnapshot;
  private readonly observers: ConfigObserver[] = [];

  constructor(private readonly configPath: string) {
    const meta = readMeta(configPath);
    this.snapshot = buildSnapshot(configPath, meta.version, meta.updatedAt);
  }

  getSettings(): Promise<SettingsSnapshot> {
    return Promise.resolve(maskApiKeys(this.snapshot));
  }

  /** Synchronous access to current settings values — use only at startup. */
  getSync(): SettingsSnapshot['values'] {
    return this.snapshot.values;
  }

  validateSettings(input: UpdateSettingsInput): Promise<SettingsValidationResult> {
    const errors: string[] = [];
    const patch = input.patch;
    const merged = this.mergeIntoSettings(this.snapshot.values, patch);

    if (patch.report?.port !== undefined) {
      if (!Number.isInteger(patch.report.port) || patch.report.port < 1 || patch.report.port > 65535) {
        errors.push('report.port must be an integer between 1 and 65535');
      }
    }
    if (patch.exploration?.maxSteps !== undefined && patch.exploration.maxSteps < 1) {
      errors.push('exploration.maxSteps must be >= 1');
    }
    if (patch.exploration?.maxPages !== undefined && patch.exploration.maxPages < 1) {
      errors.push('exploration.maxPages must be >= 1');
    }
    if (merged.ai.activeProvider && !merged.ai.providers[merged.ai.activeProvider]) {
      errors.push(`ai.activeProvider '${merged.ai.activeProvider}' not found in ai.providers`);
    }
    const sceneProviders = merged.ai.sceneProviders ?? {};
    for (const [scene, providerKey] of Object.entries(sceneProviders)) {
      if (!providerKey) continue;
      if (!merged.ai.providers[providerKey]) {
        errors.push(`ai.sceneProviders.${scene} '${providerKey}' not found in ai.providers`);
      }
    }

    return Promise.resolve({ valid: errors.length === 0, errors });
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SettingsApplyResult> {
    if (input.expectedVersion !== undefined && input.expectedVersion !== this.snapshot.version) {
      return { success: false, message: `Version conflict: expected ${String(input.expectedVersion)}, current ${String(this.snapshot.version)}`, errorCode: 'SETTINGS_VERSION_CONFLICT' };
    }

    const validation = await this.validateSettings(input);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join('; ') };
    }

    // Strip masked placeholders from patch before merging so stored keys are preserved
    const cleanPatch = stripMaskedApiKeys(input.patch);
    const merged = this.mergeIntoSettings(this.snapshot.values, cleanPatch);
    const nextVersion = this.snapshot.version + 1;
    const updatedAt = new Date().toISOString();

    writeFileSync(this.configPath, dumpYaml(merged as unknown as object), 'utf8');
    writeMeta(this.configPath, { version: nextVersion, updatedAt });

    this.snapshot = buildSnapshot(this.configPath, nextVersion, updatedAt);

    await this.broadcast();

    return { success: true, message: 'Settings updated', version: nextVersion };
  }

  registerObserver(observer: ConfigObserver): void {
    this.observers.push(observer);
  }

  private mergeIntoSettings(
    current: PersonalSettings,
    patch: Partial<PersonalSettings>,
  ): PersonalSettings {
    return deepMergeSettings(
      current as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>,
    );
  }

  private async broadcast(): Promise<void> {
    for (const obs of this.observers) {
      await obs.onConfigUpdated(this.snapshot);
    }
  }
}

function deepMergeSettings(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): PersonalSettings {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const bv = base[key];
    result[key] =
      bv !== null && typeof bv === 'object' && !Array.isArray(bv)
        ? deepMergeSettings(bv as Record<string, unknown>, {})
        : Array.isArray(bv) ? (bv as unknown[]).slice() : bv;
  }
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    const bv = result[key];
    if (
      ov !== null && typeof ov === 'object' && !Array.isArray(ov) &&
      bv !== null && typeof bv === 'object' && !Array.isArray(bv)
    ) {
      result[key] = deepMergeSettings(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else if (ov !== undefined) {
      result[key] = Array.isArray(ov) ? (ov as unknown[]).slice() : ov;
    }
  }
  return result as unknown as PersonalSettings;
}

/** Convenience factory that creates a ConfigManager with default config path. */
export function createConfigManager(configPath: string): ConfigManager {
  return new ConfigManager(configPath);
}

const MASKED = '**masked**';

/** Replace all providers[*].apiKey values with MASKED before returning to clients. */
function maskApiKeys(snapshot: SettingsSnapshot): SettingsSnapshot {
  const ai = snapshot.values.ai;
  if (!ai?.providers) return snapshot;
  const maskedProviders: typeof ai.providers = {};
  for (const [k, p] of Object.entries(ai.providers)) {
    maskedProviders[k] = p.apiKey ? { ...p, apiKey: MASKED } : { ...p };
  }
  return { ...snapshot, values: { ...snapshot.values, ai: { ...ai, providers: maskedProviders } } };
}

/** Remove apiKey entries that equal MASKED so stored keys are not overwritten. */
function stripMaskedApiKeys(patch: Partial<PersonalSettings>): Partial<PersonalSettings> {
  if (!patch.ai?.providers) return patch;
  const cleanProviders: typeof patch.ai.providers = {};
  for (const [k, p] of Object.entries(patch.ai.providers)) {
    if (p.apiKey === MASKED) {
      const { apiKey: _drop, ...rest } = p;
      cleanProviders[k] = rest;
    } else {
      cleanProviders[k] = { ...p };
    }
  }
  return { ...patch, ai: { ...patch.ai, providers: cleanProviders } };
}
