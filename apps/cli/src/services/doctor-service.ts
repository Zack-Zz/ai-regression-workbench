import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '@zarb/storage';
import type { ConfigManager } from '@zarb/config';

export interface DoctorCheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

export interface DoctorResult {
  healthy: boolean;
  checks: DoctorCheckResult[];
}

/** Expected migration versions — must match scripts/sql/ filenames (without .sql). */
const EXPECTED_MIGRATIONS = [
  '001_initial_schema',
  '002_code_task_timeout',
  '003_generated_tests',
  '004_ai_engine_persistence',
  '010_storage_indexes',
  '020_cleanup_run_by_id',
];

function check(name: string, fn: () => 'ok' | 'warn' | 'fail' | { status: 'ok' | 'warn' | 'fail'; message: string }): DoctorCheckResult {
  try {
    const result = fn();
    if (typeof result === 'string') return { name, status: result, message: result === 'ok' ? 'OK' : name };
    return { name, ...result };
  } catch (e: unknown) {
    return { name, status: 'fail', message: e instanceof Error ? e.message : String(e) };
  }
}

function commandVersion(cmd: string): string | null {
  try {
    return execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 }).toString().trim().split('\n')[0] ?? null;
  } catch { return null; }
}

/**
 * DoctorService — runs environment and schema health checks.
 * Derived from packaging-design.md §6 and observability-design.md §7.
 */
export class DoctorService {
  constructor(
    private readonly db: Db,
    private readonly config: ConfigManager,
  ) {}

  async runChecks(): Promise<DoctorResult> {
    const settings = await this.config.getSettings();
    const v = settings.values;

    const checks: DoctorCheckResult[] = [
      // Node.js version
      check('node.version', () => {
        const ver = process.version;
        const major = parseInt(ver.slice(1), 10);
        return major >= 22
          ? { status: 'ok', message: ver }
          : { status: 'warn', message: `${ver} — requires >=22` };
      }),

      // SQLite writable
      check('sqlite.writable', () => {
        const path = resolve(v.storage.sqlitePath);
        if (!existsSync(path)) return { status: 'warn', message: `DB not yet created at ${path}` };
        try { accessSync(path, constants.W_OK); return { status: 'ok', message: path }; }
        catch { return { status: 'fail', message: `Not writable: ${path}` }; }
      }),

      // SQLite WAL mode
      check('sqlite.wal', () => {
        const mode = (this.db.pragma('journal_mode') as { journal_mode: string }[])[0]?.journal_mode ?? 'unknown';
        return mode === 'wal'
          ? { status: 'ok', message: 'WAL enabled' }
          : { status: 'warn', message: `journal_mode=${mode} (expected wal)` };
      }),

      // Schema version consistency
      check('sqlite.schema', () => {
        const applied = (this.db.prepare('SELECT version FROM _migrations').all() as { version: string }[]).map(r => r.version);
        const appliedSet = new Set(applied);
        const expectedSet = new Set(EXPECTED_MIGRATIONS);
        const missing = EXPECTED_MIGRATIONS.filter(m => !appliedSet.has(m));
        const unexpected = applied.filter(m => !expectedSet.has(m));
        if (missing.length === 0 && unexpected.length === 0) {
          return { status: 'ok', message: `All ${String(EXPECTED_MIGRATIONS.length)} migrations applied, no unexpected versions` };
        }
        const parts: string[] = [];
        if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
        if (unexpected.length > 0) parts.push(`unexpected: ${unexpected.join(', ')}`);
        return { status: 'fail', message: parts.join('; ') };
      }),

      // git
      check('git.available', () => {
        const ver = commandVersion('git');
        return ver ? { status: 'ok', message: ver } : { status: 'warn', message: 'git not found' };
      }),

      // Playwright
      check('playwright.available', () => {
        const ver = commandVersion('npx playwright');
        return ver ? { status: 'ok', message: ver } : { status: 'warn', message: 'playwright not found — run: npx playwright install' };
      }),

      // Codex CLI
      check('codex.available', () => {
        const ver = commandVersion('codex');
        return ver ? { status: 'ok', message: ver } : { status: 'warn', message: 'codex CLI not found' };
      }),

      // Kiro CLI
      check('kiro.available', () => {
        const ver = commandVersion('kiro-cli');
        return ver ? { status: 'ok', message: ver } : { status: 'warn', message: 'kiro-cli not found' };
      }),

      // Target project path
      check('workspace.targetProjectPath', () => {
        const p = v.workspace.targetProjectPath;
        if (!p) return { status: 'warn', message: 'Not configured — set via Settings page' };
        if (!existsSync(p)) return { status: 'fail', message: `Path not found: ${p}` };
        const isGit = existsSync(resolve(p, '.git'));
        return isGit
          ? { status: 'ok', message: p }
          : { status: 'warn', message: `${p} — no .git directory found` };
      }),

      // AI API key env var
      check('ai.apiKeyEnvVar', () => {
        const envVar = v.ai.apiKeyEnvVar;
        if (!envVar) return { status: 'warn', message: 'ai.apiKeyEnvVar not configured' };
        const val = process.env[envVar];
        if (!val) return { status: 'warn', message: `$${envVar} is not set` };
        // Warn if key looks like it might be stored in plain text in config
        return { status: 'ok', message: `$${envVar} is set` };
      }),

      // Trace provider reachability (config only — no network call)
      check('trace.config', () => {
        const ep = v.trace.endpoint;
        return ep
          ? { status: 'ok', message: `provider=${v.trace.provider} endpoint=${ep}` }
          : { status: 'warn', message: 'trace.endpoint not configured' };
      }),

      // Logs provider config
      check('logs.config', () => {
        const ep = v.logs.endpoint;
        return ep
          ? { status: 'ok', message: `provider=${v.logs.provider} endpoint=${ep}` }
          : { status: 'warn', message: 'logs.endpoint not configured' };
      }),
    ];

    const healthy = checks.every(c => c.status !== 'fail');
    return { healthy, checks };
  }
}
