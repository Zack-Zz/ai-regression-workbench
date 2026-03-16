import type { Db, RunRow } from '@zarb/storage';
import { RunRepository, RunEventRepository, TestResultRepository, FindingRepository, ExecutionReportRepository } from '@zarb/storage';
import type {
  RunSummary, RunDetail, RunSummaryPage, RunEventPage, ActionResult,
  StartRunInput, StartRunResult, ListRunsQuery, RunEventsQuery, RunStatus,
  ExecutionReport, ExplorationConfig,
} from '@zarb/shared-types';
import type { RunScopeType } from '@zarb/shared-types';
import { DEFAULT_SETTINGS } from '@zarb/config';
import type { TestRunner } from '@zarb/test-runner';

export interface RunServiceOptions {
  /** Absolute path to the workbench data root (for artifact storage) */
  dataRoot: string;
  /** Optional runner — if provided, startRun will trigger real Playwright execution */
  runner?: TestRunner;
}

function toSummary(row: RunRow): RunSummary {
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
  if (row.ended_at) base.endedAt = row.ended_at;
  if (row.current_stage) base.currentStage = row.current_stage;
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
  private readonly opts: RunServiceOptions;
  /** Active runner references per runId — used by cancel/pause to control execution */
  private readonly activeRunners = new Map<string, import('@zarb/test-runner').TestRunner>();

  constructor(private readonly db: Db, opts: RunServiceOptions = { dataRoot: './.ai-regression-workbench/data' }) {
    this.runs = new RunRepository(db);
    this.events = new RunEventRepository(db);
    this.results = new TestResultRepository(db);
    this.findings = new FindingRepository(db);
    this.executionReports = new ExecutionReportRepository(db);
    this.opts = opts;
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
    this.runs.create({
      runId,
      runMode: input.runMode,
      scopeType,
      ...(scopeValue ? { scopeValue } : {}),
      selectorJson: sel ? JSON.stringify(sel) : '{}',
      ...(explorationConfigJson ? { explorationConfigJson } : {}),
      workspacePath: input.projectPath ?? '',
      startedAt: now,
    });
    const row = this.runs.findById(runId);
    const result: StartRunResult = { success: true, message: 'Run started' };
    if (row) result.run = toSummary(row);

    // Trigger real Playwright execution asynchronously if runner is available
    if (this.opts.runner && input.runMode === 'regression' && input.projectPath) {
      const runner = this.opts.runner;
      const dataRoot = this.opts.dataRoot;
      const projectPath = input.projectPath;
      // Use void + async IIFE so the HTTP response returns immediately while
      // execution continues in the background (non-blocking)
      void (async () => {
        this.activeRunners.set(runId, runner);
        this.runs.update(runId, { status: 'RUNNING_TESTS', currentStage: 'RUNNING_TESTS', updatedAt: new Date().toISOString() });
        const runResult = await runner.execute({
          runId,
          workspacePath: projectPath,
          dataRoot,
          ...(sel ? { selector: sel } : {}),
        });
        this.activeRunners.delete(runId);
        // If the run was cancelled or paused while executing, do not overwrite status
        const current = this.runs.findById(runId);
        if (current?.status === 'CANCELLED' || current?.status === 'PAUSED') return;
        const endedAt = new Date().toISOString();
        if (runResult.startupFailure) {
          this.runs.update(runId, { status: 'FAILED', currentStage: 'FAILED', endedAt, updatedAt: endedAt });
        } else {
          const finalStatus: RunStatus = runResult.failed > 0 ? 'ANALYZING_FAILURES' : 'COMPLETED';
          this.runs.update(runId, { status: finalStatus, currentStage: finalStatus, endedAt, updatedAt: endedAt });
        }
      })();
    }

    return result;
  }

  listRuns(query: ListRunsQuery = {}): RunSummaryPage {
    const filter: import('@zarb/storage').ListRunsFilter = { limit: query.limit ?? 20 };
    if (query.status !== undefined) filter.status = query.status as RunStatus;
    if (query.runMode !== undefined) filter.runMode = query.runMode;
    if (query.cursor !== undefined) filter.cursor = query.cursor;
    const page = this.runs.list(filter);
    return { items: page.items.map(toSummary), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
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
    return { summary: toSummary(row), testResults, findings, events };
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
    return { success: true, message: 'Run cancelled' };
  }
}
