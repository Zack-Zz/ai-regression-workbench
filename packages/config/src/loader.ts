import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import type { PersonalSettings, SettingsSnapshot } from '@zarb/shared-types';
import { DEFAULT_SETTINGS } from './defaults.js';
import { WORKBENCH_DIR } from './constants.js';

/**
 * Deep-merge `overrides` onto `base`. Arrays are replaced, not concatenated.
 * Only plain objects are recursed into; all other values are replaced.
 */
function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const bv = base[key];
    result[key] =
      bv !== null && typeof bv === 'object' && !Array.isArray(bv)
        ? deepMerge(bv as Record<string, unknown>, {})
        : Array.isArray(bv) ? (bv as unknown[]).slice()
        : bv;
  }
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    const bv = result[key];
    if (
      ov !== null && typeof ov === 'object' && !Array.isArray(ov) &&
      bv !== null && typeof bv === 'object' && !Array.isArray(bv)
    ) {
      result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else if (ov !== undefined) {
      result[key] = Array.isArray(ov) ? (ov as unknown[]).slice() : ov;
    }
  }
  return result;
}

/**
 * Load and merge settings from a YAML file on top of defaults.
 * Returns the merged result; does not validate.
 */
export function loadSettingsFromFile(filePath: string): PersonalSettings {
  const base = deepMerge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, {});
  if (!existsSync(filePath)) {
    return base as unknown as PersonalSettings;
  }
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(raw) as Partial<PersonalSettings> | null;
  if (!parsed || typeof parsed !== 'object') {
    return base as unknown as PersonalSettings;
  }
  return deepMerge(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    parsed as Record<string, unknown>,
  ) as unknown as PersonalSettings;
}

/**
 * Build a SettingsSnapshot from a file path.
 * Version starts at 1 and is managed externally by SettingsService.
 */
export function buildSnapshot(
  filePath: string,
  version: number,
  updatedAt: string,
): SettingsSnapshot {
  const values = loadSettingsFromFile(filePath);
  return {
    version,
    sourcePath: filePath,
    updatedAt,
    values,
    resolvedPaths: resolveSettingsPaths(filePath, values),
  };
}

function resolveSettingsPath(configPath: string, configuredPath: string | undefined, fallbackSegments: string[]): string {
  const workspaceRoot = resolve(dirname(configPath), '..');
  if (!configuredPath || configuredPath.trim() === '') {
    return resolve(workspaceRoot, WORKBENCH_DIR, ...fallbackSegments);
  }
  return resolve(workspaceRoot, configuredPath);
}

function resolveSettingsPaths(configPath: string, values: PersonalSettings): NonNullable<SettingsSnapshot['resolvedPaths']> {
  return {
    sqlitePath: resolveSettingsPath(configPath, values.storage.sqlitePath, ['data', 'sqlite', 'app.db']),
    artifactRoot: resolveSettingsPath(configPath, values.storage.artifactRoot, ['data', 'artifacts']),
    diagnosticRoot: resolveSettingsPath(configPath, values.storage.diagnosticRoot, ['data', 'diagnostics']),
    codeTaskRoot: resolveSettingsPath(configPath, values.storage.codeTaskRoot, ['data', 'code-tasks']),
  };
}

/**
 * Merge exploration config following the documented precedence:
 *   StartRunInput.exploration > PersonalSettings.exploration > defaults
 *
 * Returns a fully-resolved ExplorationConfig with no optional fields
 * (maxSteps and maxPages are guaranteed to be numbers).
 */
export function resolveExplorationConfig(
  runInput: Partial<PersonalSettings['exploration']> | undefined,
  userSettings: PersonalSettings['exploration'] | undefined,
): Required<NonNullable<PersonalSettings['exploration']>> {
  const defaults = DEFAULT_SETTINGS.exploration ?? {};
  const merged = deepMerge(
    deepMerge(
      defaults as unknown as Record<string, unknown>,
      (userSettings ?? {}) as Record<string, unknown>,
    ),
    (runInput ?? {}) as Record<string, unknown>,
  ) as NonNullable<PersonalSettings['exploration']>;

  return {
    defaultMode: merged.defaultMode ?? 'hybrid',
    maxSteps: merged.maxSteps ?? 80,
    maxPages: merged.maxPages ?? 20,
    allowedHosts: merged.allowedHosts ?? ['localhost'],
    defaultFocusAreas: merged.defaultFocusAreas ?? ['smoke', 'navigation', 'console-errors'],
    persistAsCandidateTests: merged.persistAsCandidateTests ?? true,
  };
}
