import type { Db, RunRow } from '@zarb/storage';
import { RunRepository, RunEventRepository, TestResultRepository, FindingRepository, ExecutionReportRepository, CodeTaskDraftRepository, CodeTaskRepository, SelectorCacheRepository, ProjectRepository, SiteRepository, LocalRepoRepository, SiteCredentialRepository } from '@zarb/storage';
import { join } from 'node:path';
import type {
  RunSummary, RunDetail, RunSummaryPage, RunEventPage, ActionResult,
  StartRunInput, StartRunResult, ListRunsQuery, RunEventsQuery, RunStatus,
  ExecutionReport, ExplorationConfig,
} from '@zarb/shared-types';
import type { RunScopeType } from '@zarb/shared-types';
import { DEFAULT_SETTINGS } from '@zarb/config';
import type { TestRunner } from '@zarb/test-runner';
import type { AIEngine, AIProvider } from '@zarb/ai-engine';
import { emitEvent } from '../event-bus.js';

export interface RunServiceOptions {
  /** Absolute path to the workbench data root (for artifact storage) */
  dataRoot: string;
  /** Optional runner — if provided, startRun will trigger real Playwright execution */
  runner?: TestRunner;
  /** Optional AI engine — if provided, triggers failure analysis after regression runs */
  aiEngine?: AIEngine;
  /** Optional AI provider — used by ExplorationAgent for LLM decisions */
  aiProvider?: AIProvider;
  /** If true, CodeTask drafts are automatically promoted and approved without human gate */
  autoApprove?: boolean;
  /** When autoApprove is true, only auto-approve tasks at or below this risk level */
  autoApproveMaxRiskLevel?: 'low' | 'medium' | 'high';
  /** Root directory containing test suites, organised as <testSuitesRoot>/<projectId>/ */
  testSuitesRoot?: string;
}

function toSummary(row: RunRow, projectName?: string, siteName?: string, siteBaseUrl?: string, credLabel?: string): RunSummary {
  const base: RunSummary = {
    runId: row.run_id,
    runMode: row.run_mode,
    status: row.status,
    startedAt: row.started_at,
    total: row.total ?? 0,
    passed: row.passed ?? 0,
    failed: row.failed ?? 0,
    skipped: row.skipped ?? 0,
  };
  if (row.scope_type) base.scopeType = row.scope_type as RunScopeType;
  if (row.scope_value) base.scopeValue = row.scope_value;
  if (row.project_id) base.projectId = row.project_id;
  if (row.site_id) base.siteId = row.site_id;
  if (projectName) base.projectName = projectName;
  if (siteName) base.siteName = siteName;
  if (siteBaseUrl) base.siteBaseUrl = siteBaseUrl;
  if (credLabel) base.credLabel = credLabel;
  if (row.ended_at) base.endedAt = row.ended_at;
  if (row.current_stage) base.currentStage = row.current_stage;
  if (row.summary) base.summary = row.summary;
  return base;
}

/** Validate selector: exactly one of suite/scenarioId/tag/testcaseId must be set. */
function validateSelector(sel: StartRunInput['selector']): boolean {
  if (!sel) return false;
  const count = [sel.suite, sel.scenarioId, sel.tag, sel.testcaseId].filter(Boolean).length;
  return count === 1;
}

export class RunService {
  private readonly runs: RunRepository;
  private readonly events: RunEventRepository;
  private readonly results: TestResultRepository;
  private readonly findings: FindingRepository;
  private readonly executionReports: ExecutionReportRepository;
  private readonly drafts: CodeTaskDraftRepository;
  private readonly tasks: CodeTaskRepository;
  private readonly selectorCache: SelectorCacheRepository;
  private readonly projects: ProjectRepository;
  private readonly sites: SiteRepository;
  private readonly credentials: SiteCredentialRepository;
  private readonly localRepos: LocalRepoRepository;
  private readonly opts: RunServiceOptions;
  /** Active runner references per runId — used by cancel/pause to control execution */
  private readonly activeRunners = new Map<string, import('@zarb/test-runner').TestRunner>();

  constructor(private readonly db: Db, opts: RunServiceOptions = { dataRoot: './.ai-regression-workbench/data' }) {
    this.runs = new RunRepository(db);
    this.events = new RunEventRepository(db);
    this.results = new TestResultRepository(db);
    this.findings = new FindingRepository(db);
    this.executionReports = new ExecutionReportRepository(db);
    this.drafts = new CodeTaskDraftRepository(db);
    this.tasks = new CodeTaskRepository(db);
    this.selectorCache = new SelectorCacheRepository(db);
    this.projects = new ProjectRepository(db);
    this.sites = new SiteRepository(db);
    this.credentials = new SiteCredentialRepository(db);
    this.localRepos = new LocalRepoRepository(db);
    this.opts = opts;
  }

  private emitRun(runId: string, type: 'run.created' | 'run.updated' | 'run.step.updated' = 'run.updated'): void {
    const row = this.runs.findById(runId);
    emitEvent({ type, id: runId, ...(row?.project_id ? { projectId: row.project_id } : {}) });
  }

  startRun(input: StartRunInput): StartRunResult {
    if (input.runMode === 'regression') {
      if (!validateSelector(input.selector)) {
        return { success: false, message: 'regression mode requires exactly one selector field (suite, scenarioId, tag, or testcaseId)', errorCode: 'RUN_SELECTOR_INVALID' };
      }
    } else if (input.runMode === 'exploration') {
      if (!input.exploration) {
        return { success: false, message: 'exploration mode requires exploration config', errorCode: 'RUN_SELECTOR_INVALID' };
      }
    } else {
      // hybrid
      if (!validateSelector(input.selector) || !input.exploration) {
        return { success: false, message: 'hybrid mode requires both selector and exploration config', errorCode: 'RUN_SELECTOR_INVALID' };
      }
    }

    const sel = input.selector;
    const scopeType: RunScopeType = input.runMode === 'exploration'
      ? 'exploration'
      : sel?.suite ? 'suite' : sel?.scenarioId ? 'scenario' : sel?.tag ? 'tag' : 'testcase';
    const scopeValue = sel?.suite ?? sel?.scenarioId ?? sel?.tag ?? sel?.testcaseId;

    // Merge exploration config with defaults
    let explorationConfigJson: string | undefined;
    if (input.exploration) {
      const defExp = DEFAULT_SETTINGS.exploration;
      const merged: ExplorationConfig = {
        startUrls: input.exploration.startUrls,
        maxSteps: input.exploration.maxSteps,
        maxPages: input.exploration.maxPages,
        persistAsCandidateTests: input.exploration.persistAsCandidateTests ?? defExp?.persistAsCandidateTests ?? false,
      };
      const allowedHosts = input.exploration.allowedHosts ?? defExp?.allowedHosts;
      if (allowedHosts !== undefined) merged.allowedHosts = allowedHosts;
      const focusAreas = input.exploration.focusAreas as ExplorationConfig['focusAreas'] | undefined;
      if (focusAreas !== undefined) merged.focusAreas = focusAreas;
      explorationConfigJson = JSON.stringify(merged);
    }

    const runId = `run-${String(Date.now())}`;
    const now = new Date().toISOString();

    // Per-project data root: data/projects/<projectId>/  (fallback: project-default)
    const projectId = input.projectId ?? 'project-default';
    const runDataRoot = join(this.opts.dataRoot, '..', 'projects', projectId);

    // Derive test suite path: testSuitesRoot/<projectId> (or legacy input.projectPath)
    const testSuitePath = (this.opts.testSuitesRoot && input.projectId)
      ? join(this.opts.testSuitesRoot, input.projectId)
      : (input.projectPath ?? '');

    // Derive workspace path for CodeTask: first LocalRepo of this project
    const repoRows = input.projectId ? this.localRepos.findByProjectId(input.projectId) : [];
    const workspacePath = repoRows[0]?.path ?? input.projectPath ?? '';

    this.runs.create({
      runId,
      runMode: input.runMode,
      scopeType,
      ...(scopeValue ? { scopeValue } : {}),
      selectorJson: sel ? JSON.stringify(sel) : '{}',
      ...(explorationConfigJson ? { explorationConfigJson } : {}),
      workspacePath,
      startedAt: now,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.siteId ? { siteId: input.siteId } : {}),
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
    });
    emitEvent({ type: 'run.created', id: runId, ...(input.projectId ? { projectId: input.projectId } : {}) });
    const row = this.runs.findById(runId);
    const result: StartRunResult = { success: true, message: 'Run started' };
    if (row) result.run = toSummary(row);

    // Trigger real Playwright execution asynchronously if runner is available
    if (this.opts.runner && (input.runMode === 'regression' || input.runMode === 'hybrid') && testSuitePath) {
      const runner = this.opts.runner;
      const dataRoot = runDataRoot;
      void (async () => {
        this.activeRunners.set(runId, runner);
        this.runs.update(runId, { status: 'RUNNING_TESTS', currentStage: 'RUNNING_TESTS', updatedAt: new Date().toISOString() });
        this.emitRun(runId);
        const runResult = await runner.execute({
          runId,
          workspacePath: testSuitePath,
          dataRoot,
          ...(sel ? { selector: sel } : {}),
          onProgress: (counts) => {
            this.runs.update(runId, { ...counts, updatedAt: new Date().toISOString() });
            this.emitRun(runId, 'run.step.updated');
          },
        });
        this.activeRunners.delete(runId);
        // If the run was cancelled or paused while executing, do not overwrite status
        const current = this.runs.findById(runId);
        if (current?.status === 'CANCELLED' || current?.status === 'PAUSED') return;
        const endedAt = new Date().toISOString();
        if (runResult.startupFailure) {
          this.runs.update(runId, { status: 'FAILED', currentStage: 'FAILED', endedAt, updatedAt: endedAt });
          this.emitRun(runId);
        } else {
          const finalStatus: RunStatus = (runResult.failed > 0 && input.runMode === 'regression') ? 'ANALYZING_FAILURES' : 'COMPLETED';
          this.runs.update(runId, {
            status: finalStatus, currentStage: finalStatus, endedAt, updatedAt: endedAt,
            total: runResult.total, passed: runResult.passed, failed: runResult.failed, skipped: runResult.skipped,
          });
          this.emitRun(runId);
          // Trigger AI failure analysis for failed tests (regression-only mode)
          if (runResult.failed > 0 && input.runMode === 'regression') {
            if (this.opts.aiEngine) {
              const aiEngine = this.opts.aiEngine;
              void (async () => {
                const failedResults = this.results.findByRun(runId).filter(r => r.status === 'failed');
                for (const r of failedResults) {
                  try {
                    const analysis = await aiEngine.analyzeFailure({
                      runId,
                      testcaseId: r.testcase_id,
                      testcaseName: r.testcase_id,
                      ...(r.error_message ? { errorMessage: r.error_message } : {}),
                      ...(r.error_type ? { errorType: r.error_type } : {}),
                    });
                    const drafts = await aiEngine.createCodeTaskDraft(analysis);
                    if (this.opts.autoApprove) {
                      for (const d of drafts) this.promoteAndApprove(d.id);
                    }
                  } catch { /* degrade gracefully — analysis failure must not affect run state */ }
                }
                const now2 = new Date().toISOString();
                this.runs.update(runId, { status: 'COMPLETED', currentStage: 'COMPLETED', updatedAt: now2 });
                this.emitRun(runId);
                this.updateSelectorCacheFromResults(runId);
              })();
            } else {
              // No AI engine — skip analysis, mark completed immediately
              const now2 = new Date().toISOString();
              this.runs.update(runId, { status: 'COMPLETED', currentStage: 'COMPLETED', updatedAt: now2 });
              this.emitRun(runId);
              this.updateSelectorCacheFromResults(runId);
            }
          }
          // hybrid: chain exploration after regression (exploration will set final COMPLETED)
          if (input.runMode === 'hybrid' && input.exploration) {
            void this.runExploration(runId, input.exploration, runDataRoot);
          }
        }
      })();
    }

    // Pure exploration mode: run ExplorationAgent directly
    // hybrid exploration is chained after regression completes (see regression block above)
    if (input.runMode === 'exploration') {
      void this.runExploration(runId, input.exploration, runDataRoot);
    }
    // hybrid without runner: skip regression, go straight to exploration
    if (input.runMode === 'hybrid' && (!this.opts.runner || !input.projectPath) && input.exploration) {
      void this.runExploration(runId, input.exploration, runDataRoot);
    }

    return result;
  }

  private async runExploration(
    runId: string,
    explorationConfig: StartRunInput['exploration'],
    dataRoot: string,
  ): Promise<void> {
    const now0 = new Date().toISOString();
    this.runs.update(runId, { status: 'PLANNING_EXPLORATION', currentStage: 'PLANNING_EXPLORATION', updatedAt: now0 });
    this.emitRun(runId);

    if (this.opts.aiEngine && explorationConfig) {
      const { ExplorationAgent, PlaywrightToolProvider } = await import('@zarb/agent-harness');
      const providerAdapter = this.opts.aiProvider ?? { complete: async (_p: string) => '', isConfigured: () => false };

      // Detect null/unconfigured provider early and fail fast with a clear run summary
      if (!providerAdapter.isConfigured()) {
        const nowErr = new Date().toISOString();
        this.runs.update(runId, {
          status: 'FAILED', currentStage: 'FAILED', endedAt: nowErr, updatedAt: nowErr,
          summary: 'EXPLORATION_PROVIDER_NOT_CONFIGURED',
        });
        this.emitRun(runId);
        return;
      }

      const agent = new ExplorationAgent(this.db, providerAdapter, new PlaywrightToolProvider());
      const now1 = new Date().toISOString();
      this.runs.update(runId, { status: 'RUNNING_EXPLORATION', currentStage: 'RUNNING_EXPLORATION', updatedAt: now1 });
      this.emitRun(runId);
      const probe = async (url: string) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          const text = await res.text();
          const networkErrors = res.ok ? [] : [{ url, status: res.status }];
          const formCount = (text.match(/<form/gi) ?? []).length;
          const linkCount = (text.match(/<a\s/gi) ?? []).length;
          const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(text);
          return { url, title: titleMatch?.[1] ?? '', consoleErrors: [], networkErrors, formCount, linkCount };
        } catch (e) {
          return { url, title: '', consoleErrors: [String(e)], networkErrors: [], formCount: 0, linkCount: 0 };
        }
      };
      try {
        await agent.explore(runId, explorationConfig as import('@zarb/shared-types').ExplorationConfig, probe, dataRoot, () => { this.emitRun(runId, 'run.step.updated'); });
        this.emitRun(runId, 'run.step.updated');
      } catch { /* degrade gracefully */ }
    } else {
      await new Promise<void>(r => setTimeout(r, 800));
      const cur0 = this.runs.findById(runId);
      if (cur0?.status === 'CANCELLED' || cur0?.status === 'PAUSED') return;
      const now1 = new Date().toISOString();
      this.runs.update(runId, { status: 'RUNNING_EXPLORATION', currentStage: 'RUNNING_EXPLORATION', updatedAt: now1 });
      this.emitRun(runId);
      await new Promise<void>(r => setTimeout(r, 800));
    }

    const cur = this.runs.findById(runId);
    if (cur?.status === 'CANCELLED' || cur?.status === 'PAUSED') return;
    const now2 = new Date().toISOString();
    this.runs.update(runId, { status: 'COLLECTING_ARTIFACTS', currentStage: 'COLLECTING_ARTIFACTS', updatedAt: now2 });
    this.emitRun(runId);
    await new Promise<void>(r => setTimeout(r, 300));

    // Aggregate findings by (pageUrl, category) and create CodeTask drafts
    if (this.opts.aiEngine) {
      await this.triggerFindingCodeTasks(runId).catch(() => undefined);
    }

    const now3 = new Date().toISOString();
    this.runs.update(runId, { status: 'COMPLETED', currentStage: 'COMPLETED', endedAt: now3, updatedAt: now3 });
    this.emitRun(runId);
  }

  private async triggerFindingCodeTasks(runId: string): Promise<void> {
    const allFindings = this.findings.findByRun(runId);
    if (allFindings.length === 0) return;

    // Group by (pageUrl ?? 'unknown', category)
    const groups = new Map<string, typeof allFindings>();
    for (const f of allFindings) {
      if (f.promoted_task_id) continue; // already promoted
      const key = `${f.page_url ?? 'unknown'}::${f.category}`;
      const g = groups.get(key) ?? [];
      g.push(f);
      groups.set(key, g);
    }

    for (const [, group] of groups) {
      const first = group[0]!;
      const pageUrl = first.page_url ?? 'unknown';
      const category = first.category;
      const summaries = group.map(f => f.summary ?? f.title).join('\n');
      const goal = `修复 ${pageUrl} 页面 ${category} 问题（${String(group.length)} 条 finding）：\n${summaries}`;

      try {
        const drafts = await this.opts.aiEngine!.createCodeTaskDraft({
          id: `synthetic-${runId}-${category}`,
          runId,
          testcaseId: '',
          category,
          suspectedLayer: 'frontend',
          confidence: 0.7,
          summary: goal,
          probableCause: summaries,
          suggestions: [],
          promptTemplateVersion: 'synthetic-v1',
          createdAt: new Date().toISOString(),
        });
        for (const d of drafts) {
          if (this.opts.autoApprove) this.promoteAndApprove(d.id);
        }
      } catch { /* degrade gracefully */ }
    }
  }

  private resolveProjectName(projectId: string | null | undefined): string | undefined {
    if (!projectId) return undefined;
    return this.projects.findById(projectId)?.name;
  }

  private resolveSiteName(siteId: string | null | undefined): string | undefined {
    if (!siteId) return undefined;
    return this.sites.findById(siteId)?.name;
  }

  private resolveSiteBaseUrl(siteId: string | null | undefined): string | undefined {
    if (!siteId) return undefined;
    return this.sites.findById(siteId)?.base_url;
  }

  private resolveCredLabel(credentialId: string | null | undefined): string | undefined {
    if (!credentialId) return undefined;
    const row = this.credentials.findById(credentialId);
    if (!row) return undefined;
    return row.auth_type ? `${row.label} (${row.auth_type})` : row.label;
  }

  /** Update selector cache from completed run's test results (source: history). */
  private updateSelectorCacheFromResults(runId: string): void {
    const row = this.runs.findById(runId);
    if (!row?.site_id) return;
    const results = this.results.findByRun(runId);
    const repoRows = row.project_id ? this.localRepos.findByProjectId(row.project_id) : [];
    const repoId = repoRows[0]?.id ?? '';
    const siteId = row.site_id;
    for (const r of results) {
      if (r.testcase_id) this.selectorCache.upsert(siteId, repoId, 'testcase', r.testcase_id, 'history');
      if (r.scenario_id) this.selectorCache.upsert(siteId, repoId, 'scenario', r.scenario_id, 'history');
    }
  }

  /** Promote a draft to a CodeTask and optionally auto-approve it. */
  private promoteAndApprove(draftId: string): void {    const draft = this.drafts.findById(draftId);
    if (!draft) return;
    const taskId = `task-${String(Date.now())}-${draftId.slice(-4)}`;
    const now = new Date().toISOString();
    this.tasks.create({
      taskId,
      runId: draft.run_id,
      workspacePath: draft.workspace_path,
      goal: draft.goal,
      ...(draft.scope_paths_json ? { scopePathsJson: draft.scope_paths_json } : {}),
      ...(draft.constraints_json ? { constraintsJson: draft.constraints_json } : {}),
      ...(draft.verification_commands_json ? { verificationCommandsJson: draft.verification_commands_json } : {}),
      createdAt: now,
    });
    const status = this.opts.autoApprove ? 'APPROVED' : 'PENDING_APPROVAL';
    this.tasks.update(taskId, { status, updatedAt: now });
  }

  getRunFilePath(runId: string, filename: 'steps.ndjson' | 'network.jsonl'): string {
    // We don't know projectId here without a DB lookup, so use the run row
    const row = this.runs.findById(runId);
    const projectId = row?.project_id ?? 'project-default';
    return join(this.opts.dataRoot, '..', 'projects', projectId, 'runs', runId, filename);
  }

  listRuns(query: ListRunsQuery = {}): RunSummaryPage {
    const filter: import('@zarb/storage').ListRunsFilter = { limit: query.limit ?? 20 };
    if (query.status !== undefined) filter.status = query.status as RunStatus;
    if (query.runMode !== undefined) filter.runMode = query.runMode;
    if (query.cursor !== undefined) filter.cursor = query.cursor;
    const page = this.runs.list(filter);
    return { items: page.items.map(r => toSummary(r, this.resolveProjectName(r.project_id), this.resolveSiteName(r.site_id), this.resolveSiteBaseUrl(r.site_id), this.resolveCredLabel(r.credential_id))), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  getRun(runId: string): RunDetail | null {
    const row = this.runs.findById(runId);
    if (!row) return null;
    const testResults = this.results.findByRun(runId).map(r => ({
      id: r.id,
      runId,
      testcaseId: r.testcase_id,
      ...(r.scenario_id ? { scenarioId: r.scenario_id } : {}),
      status: r.status as 'passed' | 'failed' | 'skipped',
      ...(r.duration_ms !== null ? { durationMs: r.duration_ms } : {}),
      ...(r.error_type ? { errorType: r.error_type } : {}),
      ...(r.error_message ? { errorMessage: r.error_message } : {}),
    }));
    const findingRows = this.findings.findByRun(runId);
    const findings = findingRows.map(f => ({
      id: f.id,
      severity: f.severity,
      category: f.category,
      ...(f.page_url ? { pageUrl: f.page_url } : {}),
      summary: f.summary ?? '',
    }));
    const eventPage = this.events.list(runId, { limit: 50 });
    const events = eventPage.items.map(e => ({
      eventId: e.id,
      runId: e.run_id,
      eventType: e.event_type,
      entityType: e.entity_type,
      entityId: e.entity_id,
      createdAt: e.created_at,
    }));
    return { summary: toSummary(row, this.resolveProjectName(row.project_id), this.resolveSiteName(row.site_id), this.resolveSiteBaseUrl(row.site_id), this.resolveCredLabel(row.credential_id)), testResults, findings, events,
      ...(row.exploration_config_json ? { explorationConfig: JSON.parse(row.exploration_config_json) as import('@zarb/shared-types').ExplorationConfig } : {}),
    };
  }

  getExecutionReport(runId: string): ExecutionReport | null {
    const row = this.runs.findById(runId);
    if (!row) return null;
    const reportRow = this.executionReports.findByRunId(runId);
    const totals = reportRow?.totals_json ? JSON.parse(reportRow.totals_json) as { flowStepCount: number; uiActionCount: number; apiCallCount: number; failedApiCount: number } : { flowStepCount: 0, uiActionCount: 0, apiCallCount: 0, failedApiCount: 0 };
    return {
      runId,
      status: row.status,
      runMode: row.run_mode,
      startedAt: row.started_at,
      ...(row.ended_at ? { endedAt: row.ended_at } : {}),
      summary: { total: row.total ?? 0, passed: row.passed ?? 0, failed: row.failed ?? 0, skipped: row.skipped ?? 0 },
      totals,
      stageResults: [],
      degradedSteps: [],
      failureReports: [],
      codeTaskSummaries: [],
      flowSummaries: [],
      testcaseProfiles: [],
      artifactLinks: [],
    };
  }

  getRunEvents(runId: string, query: RunEventsQuery = {}): RunEventPage {
    const filter: import('@zarb/storage').ListRunEventsFilter = { limit: query.limit ?? 50 };
    if (query.cursor !== undefined) filter.cursor = query.cursor;
    const page = this.events.list(runId, filter);
    return {
      items: page.items.map(e => ({
        eventId: e.id,
        runId: e.run_id,
        eventType: e.event_type,
        entityType: e.entity_type,
        entityId: e.entity_id,
        createdAt: e.created_at,
      })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  pauseRun(runId: string): ActionResult {
    const row = this.runs.findById(runId);
    if (!row) return { success: false, message: 'Run not found', errorCode: 'RUN_NOT_FOUND' };
    if (row.status === 'COMPLETED' || row.status === 'FAILED' || row.status === 'CANCELLED') {
      return { success: false, message: 'Run is already in a terminal state', errorCode: 'RUN_ALREADY_TERMINAL' };
    }
    // Pause/resume for regression runs is not yet supported: Playwright has no
    // built-in checkpoint/resume mechanism. Explicitly reject rather than
    // presenting a non-functional API.
    if (row.run_mode === 'regression' && this.activeRunners.has(runId)) {
      return {
        success: false,
        message: 'Pause is not supported for in-progress regression runs. Use cancel instead.',
        errorCode: 'RUN_PAUSE_NOT_SUPPORTED',
      };
    }
    this.runs.update(runId, { status: 'PAUSED', updatedAt: new Date().toISOString() });
    this.emitRun(runId);
    return { success: true, message: 'Run paused' };
  }

  resumeRun(runId: string): ActionResult {
    const row = this.runs.findById(runId);
    if (!row) return { success: false, message: 'Run not found', errorCode: 'RUN_NOT_FOUND' };
    if (row.status !== 'PAUSED') {
      return { success: false, message: 'Run is not paused', errorCode: 'RUN_NOT_PAUSED' };
    }
    // Resume for regression runs is not yet supported: there is no checkpoint
    // to restart from. Explicitly reject rather than leaving the run in a false
    // "running" state with no actual work dispatched.
    if (row.run_mode === 'regression') {
      return {
        success: false,
        message: 'Resume is not supported for regression runs. Start a new run instead.',
        errorCode: 'RUN_RESUME_NOT_SUPPORTED',
      };
    }
    this.runs.update(runId, { status: 'RUNNING_TESTS', updatedAt: new Date().toISOString() });
    this.emitRun(runId);
    return { success: true, message: 'Run resumed' };
  }

  cancelRun(runId: string): ActionResult {
    const row = this.runs.findById(runId);
    if (!row) return { success: false, message: 'Run not found', errorCode: 'RUN_NOT_FOUND' };
    if (row.status === 'CANCELLED') return { success: false, message: 'Run already cancelled', errorCode: 'RUN_ALREADY_CANCELLED' };
    if (row.status === 'COMPLETED' || row.status === 'FAILED') {
      return { success: false, message: 'Run is already in a terminal state', errorCode: 'RUN_ALREADY_TERMINAL' };
    }
    // Terminate the in-flight Playwright process if running
    this.activeRunners.get(runId)?.cancel(runId);
    this.activeRunners.delete(runId);
    this.runs.update(runId, { status: 'CANCELLED', endedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    this.emitRun(runId);
    return { success: true, message: 'Run cancelled' };
  }
}
