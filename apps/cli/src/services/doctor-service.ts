import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '@zarb/storage';
import { ProjectRepository, SiteRepository } from '@zarb/storage';
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
  '021_code_task_verify_output_path',
  '030_projects_sites',
  '031_runs_project_site',
  '032_default_project',
  '033_selector_cache',
  '034_repo_base_branch',
  '035_runs_credential',
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
  private readonly projects: ProjectRepository;
  private readonly sites: SiteRepository;

  constructor(
    private readonly db: Db,
    private readonly config: ConfigManager,
  ) {
    this.projects = new ProjectRepository(db);
    this.sites = new SiteRepository(db);
  }

  async runChecks(): Promise<DoctorResult> {
    const settings = await this.config.getSettings();
    const v = settings.values;
    const resolvedPaths = settings.resolvedPaths;

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
        const path = resolvedPaths?.sqlitePath ?? v.storage.sqlitePath;
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

      check('playwright.browsers', () => {
        try {
          const out = execSync('npx playwright install --dry-run 2>&1', { stdio: 'pipe', timeout: 10_000 }).toString();
          // If dry-run output mentions "no browsers to install", browsers are present
          const allInstalled = out.includes('no browsers') || out.trim() === '';
          return allInstalled
            ? { status: 'ok', message: 'browsers installed' }
            : { status: 'warn', message: 'some browsers may be missing — run: npx playwright install' };
        } catch {
          return { status: 'warn', message: 'could not verify browser installation — run: npx playwright install' };
        }
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

      // Project management readiness
      check('projects.available', () => {
        const count = this.projects.list().length;
        return count > 0
          ? { status: 'ok', message: `${String(count)} project(s) configured` }
          : { status: 'warn', message: 'No projects configured — create a project before starting managed runs' };
      }),

      check('sites.available', () => {
        const projectIds = this.projects.list().map((project) => project.id);
        const siteCount = projectIds.reduce((count, projectId) => count + this.sites.findByProjectId(projectId).length, 0);
        return siteCount > 0
          ? { status: 'ok', message: `${String(siteCount)} site(s) configured` }
          : { status: 'warn', message: 'No sites configured — add at least one site to a project' };
      }),

      // Legacy workspace compatibility
      check('workspace.targetProjectPath', () => {
        const p = v.workspace.targetProjectPath;
        if (!p) return { status: 'warn', message: 'Legacy workspace path not configured — managed projects now drive target workspaces' };
        if (!existsSync(p)) return { status: 'warn', message: `Legacy workspace path not found: ${p}` };
        const isGit = existsSync(resolve(p, '.git'));
        return isGit
          ? { status: 'ok', message: `${p} (legacy fallback)` }
          : { status: 'warn', message: `${p} — no .git directory found (legacy fallback)` };
      }),

      // AI API key check (direct key or env var, per active provider)
      check('ai.apiKey', () => {
        const providerCfg = v.ai.providers[v.ai.activeProvider];
        if (!providerCfg) return { status: 'warn', message: `ai.activeProvider '${v.ai.activeProvider}' not found in providers` };
        if (providerCfg.apiKey) return { status: 'ok', message: 'API key configured directly' };
        const envVar = providerCfg.apiKeyEnvVar;
        if (!envVar) return { status: 'warn', message: 'No apiKey or apiKeyEnvVar configured for active provider' };
        const val = process.env[envVar];
        if (!val) return { status: 'warn', message: `$${envVar} is not set` };
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
