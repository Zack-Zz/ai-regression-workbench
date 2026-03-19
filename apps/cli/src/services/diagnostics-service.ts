import type { Db } from '@zarb/storage';
import {
  TestResultRepository, CorrelationContextRepository, DiagnosticFetchRepository, AnalysisRepository,
  ApiCallRepository, UiActionRepository, FlowStepRepository,
} from '@zarb/storage';
import { traceSummaryPath, logSummaryPath } from '@zarb/storage';
import type {
  FailureReportSummary, FailureReport, DiagnosticsDetail, AnalysisDetail, ActionResult,
  TestcaseExecutionProfile, TraceDetail, LogDetail, TraceProvider, LogProvider,
  ConfigObserver, SettingsSnapshot,
} from '@zarb/shared-types';
import type { AIEngine } from '@zarb/ai-engine';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createTraceProvider } from '@zarb/trace-bridge';
import { createLogProvider } from '@zarb/log-bridge';
import { resolveStoragePath, resolveConfiguredRelativePath, resolveRelativePathWithinRoot, mustResolveConfiguredRelativePath } from '../storage-paths.js';

export class DiagnosticsService implements ConfigObserver {
  private readonly dataRoot: string;
  private readonly results: TestResultRepository;
  private readonly correlations: CorrelationContextRepository;
  private readonly diagnosticFetches: DiagnosticFetchRepository;
  private readonly analyses: AnalysisRepository;
  private readonly apiCalls: ApiCallRepository;
  private readonly uiActions: UiActionRepository;
  private readonly flowSteps: FlowStepRepository;
  private artifactRoot: string;
  private diagnosticRoot: string;
  private traceProvider: TraceProvider;
  private logProvider: LogProvider;
  private readonly aiEngine: AIEngine | undefined;

  constructor(
    private readonly db: Db,
    dataRoot = '.',
    artifactRoot = join(dataRoot, 'artifacts'),
    diagnosticRoot = join(dataRoot, 'diagnostics'),
    traceProvider?: TraceProvider,
    logProvider?: LogProvider,
    aiEngine?: AIEngine,
  ) {
    this.results = new TestResultRepository(db);
    this.correlations = new CorrelationContextRepository(db);
    this.diagnosticFetches = new DiagnosticFetchRepository(db);
    this.analyses = new AnalysisRepository(db);
    this.apiCalls = new ApiCallRepository(db);
    this.uiActions = new UiActionRepository(db);
    this.flowSteps = new FlowStepRepository(db);
    this.dataRoot = dataRoot;
    this.artifactRoot = artifactRoot;
    this.diagnosticRoot = diagnosticRoot;
    this.traceProvider = traceProvider ?? createTraceProvider({ provider: 'none', endpoint: '' });
    this.logProvider = logProvider ?? createLogProvider({ provider: 'none', endpoint: '', defaultLimit: 100 });
    this.aiEngine = aiEngine;
  }

  onConfigUpdated(snapshot: SettingsSnapshot): Promise<void> {
    this.artifactRoot = resolveStoragePath(snapshot.sourcePath, snapshot.values.storage.artifactRoot, ['data', 'artifacts']);
    this.diagnosticRoot = resolveStoragePath(snapshot.sourcePath, snapshot.values.storage.diagnosticRoot, ['data', 'diagnostics']);
    this.traceProvider = createTraceProvider(snapshot.values.trace);
    this.logProvider = createLogProvider({ ...snapshot.values.logs, logFields: snapshot.values.diagnostics.correlationKeys.logFields });
    return Promise.resolve();
  }

  private resolveArtifactPath(relativePath: string): string | null {
    const configured = resolveConfiguredRelativePath(this.artifactRoot, 'artifacts', relativePath);
    if (configured && existsSync(configured)) return configured;
    const fallback = resolveRelativePathWithinRoot(this.dataRoot, relativePath);
    if (fallback && existsSync(fallback)) return fallback;
    return null;
  }

  private resolveDiagnosticPath(relativePath: string): string | null {
    const configured = resolveConfiguredRelativePath(this.diagnosticRoot, 'diagnostics', relativePath);
    if (configured && existsSync(configured)) return configured;
    const fallback = resolveRelativePathWithinRoot(this.dataRoot, relativePath);
    if (fallback && existsSync(fallback)) return fallback;
    return null;
  }

  private resolveDiagnosticWritePath(relativePath: string): string {
    return mustResolveConfiguredRelativePath(this.diagnosticRoot, 'diagnostics', relativePath);
  }

  private shouldFetchDiagnostic(fetches: import('@zarb/storage').DiagnosticFetchRow[], type: 'trace' | 'log'): boolean {
    return !fetches.some((fetch) => fetch.type === type);
  }

  listFailureReports(runId: string): FailureReportSummary[] {
    return this.results.findByRun(runId)
      .filter(r => r.status === 'failed')
      .map(r => ({
        runId,
        testcaseId: r.testcase_id,
        testcaseName: r.testcase_id,
        ...(r.error_type ? { errorType: r.error_type } : {}),
        ...(r.error_message ? { errorMessage: r.error_message } : {}),
      }));
  }

  getFailureReport(runId: string, testcaseId: string): FailureReport | null {
    const result = this.results.findByTestcase(runId, testcaseId);
    if (!result || result.status !== 'failed') return null;
    const ctx = this.correlations.findByTestcase(runId, testcaseId);
    return {
      runId,
      testcaseId,
      testcaseName: testcaseId,
      ...(result.error_type ? { errorType: result.error_type } : {}),
      ...(result.error_message ? { errorMessage: result.error_message } : {}),
      artifacts: {
        ...(result.screenshot_path ? { screenshotPath: result.screenshot_path } : {}),
        ...(result.video_path ? { videoPath: result.video_path } : {}),
        ...(result.trace_path ? { tracePath: result.trace_path } : {}),
        ...(result.html_report_path ? { htmlReportPath: result.html_report_path } : {}),
        ...(result.network_log_path ? { networkLogPath: result.network_log_path } : {}),
      },
      correlationContext: {
        traceIds: ctx ? JSON.parse(ctx.trace_ids_json ?? '[]') as string[] : [],
        requestIds: ctx ? JSON.parse(ctx.request_ids_json ?? '[]') as string[] : [],
        sessionIds: ctx ? JSON.parse(ctx.session_ids_json ?? '[]') as string[] : [],
      },
    };
  }

  getFailureArtifactPath(
    runId: string,
    testcaseId: string,
    kind: 'screenshot' | 'video' | 'trace' | 'html-report' | 'network',
  ): string | null {
    const result = this.results.findByTestcase(runId, testcaseId);
    if (!result) return null;
    const relativePath = kind === 'screenshot'
      ? result.screenshot_path
      : kind === 'video'
        ? result.video_path
        : kind === 'trace'
          ? result.trace_path
          : kind === 'html-report'
            ? result.html_report_path
            : result.network_log_path;
    if (!relativePath) return null;
    return this.resolveArtifactPath(relativePath);
  }

  getExecutionProfile(runId: string, testcaseId: string): TestcaseExecutionProfile | null {
    const result = this.results.findByTestcase(runId, testcaseId);
    if (!result) return null;
    const steps = this.flowSteps.findByTestcase(runId, testcaseId);
    const actions = this.uiActions.findByTestcase(runId, testcaseId);
    const calls = this.apiCalls.findByTestcase(runId, testcaseId);
    const failedApiCount = calls.filter(c => c.success === 0).length;
    return {
      runId,
      testcaseId,
      ...(result.scenario_id ? { scenarioId: result.scenario_id } : {}),
      summary: { flowStepCount: steps.length, uiActionCount: actions.length, apiCallCount: calls.length, failedApiCount },
      flowSteps: steps.map(s => ({
        id: s.id, flowId: s.flow_id, stepName: s.step_name, success: s.success === 1,
        startedAt: s.started_at,
        ...(s.ended_at ? { endedAt: s.ended_at } : {}),
        ...(s.duration_ms !== null ? { durationMs: s.duration_ms } : {}),
        ...(s.ui_action_count !== null ? { uiActionCount: s.ui_action_count } : {}),
        ...(s.api_call_count !== null ? { apiCallCount: s.api_call_count } : {}),
        ...(s.failed_api_count !== null ? { failedApiCount: s.failed_api_count } : {}),
      })),
      uiActions: actions.map(a => ({
        id: a.id, actionType: a.action_type, success: a.success === 1, startedAt: a.started_at,
        ...(a.flow_step_id ? { flowStepId: a.flow_step_id } : {}),
        ...(a.locator ? { locator: a.locator } : {}),
        ...(a.page_url ? { pageUrl: a.page_url } : {}),
        ...(a.ended_at ? { endedAt: a.ended_at } : {}),
        ...(a.duration_ms !== null ? { durationMs: a.duration_ms } : {}),
        ...(a.api_call_count !== null ? { apiCallCount: a.api_call_count } : {}),
        ...(a.failed_api_count !== null ? { failedApiCount: a.failed_api_count } : {}),
      })),
      apiCalls: calls.map(c => ({
        id: c.id, url: c.url, success: c.success === 1, startedAt: c.started_at,
        ...(c.flow_step_id ? { flowStepId: c.flow_step_id } : {}),
        ...(c.ui_action_id ? { uiActionId: c.ui_action_id } : {}),
        ...(c.method ? { method: c.method } : {}),
        ...(c.status_code !== null ? { statusCode: c.status_code } : {}),
        ...(c.response_summary ? { responseSummary: c.response_summary } : {}),
        ...(c.error_type ? { errorType: c.error_type } : {}),
        ...(c.error_message ? { errorMessage: c.error_message } : {}),
        ...(c.trace_id ? { traceId: c.trace_id } : {}),
        ...(c.request_id ? { requestId: c.request_id } : {}),
        ...(c.ended_at ? { endedAt: c.ended_at } : {}),
        ...(c.duration_ms !== null ? { durationMs: c.duration_ms } : {}),
      })),
    };
  }

  getDiagnostics(runId: string, testcaseId: string): DiagnosticsDetail {
    const ctx = this.correlations.findByTestcase(runId, testcaseId);
    const fetches = this.diagnosticFetches.findByTestcase(runId, testcaseId);
    return {
      correlationContext: {
        traceIds: ctx ? JSON.parse(ctx.trace_ids_json ?? '[]') as string[] : [],
        requestIds: ctx ? JSON.parse(ctx.request_ids_json ?? '[]') as string[] : [],
        sessionIds: ctx ? JSON.parse(ctx.session_ids_json ?? '[]') as string[] : [],
      },
      diagnosticFetches: fetches.map(f => {
        const rec: import('@zarb/shared-types').DiagnosticFetchRecord = {
          id: f.id, type: f.type, status: f.status, createdAt: f.created_at,
        };
        if (f.provider) rec.provider = f.provider;
        if (f.raw_link) rec.rawLink = f.raw_link;
        return rec;
      }),
    };
  }

  async getTrace(runId: string, testcaseId: string): Promise<TraceDetail | null> {
    const fetches = this.diagnosticFetches.findByTestcase(runId, testcaseId);
    let traceFetch = fetches.find(f => f.type === 'trace' && f.status === 'succeeded');
    if (!traceFetch && this.shouldFetchDiagnostic(fetches, 'trace')) {
      // On-demand fetch if not yet populated
      await this.fetchDiagnostics(runId, testcaseId);
      const updated = this.diagnosticFetches.findByTestcase(runId, testcaseId);
      traceFetch = updated.find(f => f.type === 'trace' && f.status === 'succeeded');
    }
    if (!traceFetch) {
      // Return a degraded detail with reason instead of null
      const ctx = this.correlations.findByTestcase(runId, testcaseId);
      const traceIds: string[] = ctx ? JSON.parse(ctx.trace_ids_json ?? '[]') as string[] : [];
      const degraded = fetches.find(f => f.type === 'trace' && f.status === 'degraded')
        ?? this.diagnosticFetches.findByTestcase(runId, testcaseId).find(f => f.type === 'trace' && f.status === 'degraded');
      const reason = traceIds.length === 0
        ? 'No trace IDs found in correlation context'
        : degraded
          ? `Trace provider returned no data for trace ID(s): ${traceIds.join(', ')}`
          : 'Trace provider not configured or not reachable';
      return {
        summary: { traceId: traceIds[0] ?? '', hasError: false, errorSpans: [], topSlowSpans: [] },
        fetchedAt: new Date().toISOString(),
        unavailableReason: reason,
      };
    }
    const summary = traceFetch.summary_json
      ? JSON.parse(traceFetch.summary_json) as import('@zarb/shared-types').TraceSummary
      : { traceId: traceFetch.id, hasError: false, errorSpans: [], topSlowSpans: [] };
    return {
      summary: { ...summary, ...(traceFetch.raw_link ? { rawLink: traceFetch.raw_link } : {}) },
      fetchedAt: traceFetch.created_at,
    };
  }

  async getLogs(runId: string, testcaseId: string): Promise<LogDetail | null> {
    const fetches = this.diagnosticFetches.findByTestcase(runId, testcaseId);
    let logFetch = fetches.find(f => f.type === 'log' && f.status === 'succeeded');
    if (!logFetch && this.shouldFetchDiagnostic(fetches, 'log')) {
      await this.fetchDiagnostics(runId, testcaseId);
      const updated = this.diagnosticFetches.findByTestcase(runId, testcaseId);
      logFetch = updated.find(f => f.type === 'log' && f.status === 'succeeded');
    }
    if (!logFetch) {
      const ctx = this.correlations.findByTestcase(runId, testcaseId);
      const hasIds = ctx && (
        JSON.parse(ctx.trace_ids_json ?? '[]') as string[]).length > 0 ||
        (JSON.parse(ctx?.request_ids_json ?? '[]') as string[]).length > 0 ||
        (JSON.parse(ctx?.session_ids_json ?? '[]') as string[]).length > 0;
      const degraded = fetches.find(f => f.type === 'log' && f.status === 'degraded')
        ?? this.diagnosticFetches.findByTestcase(runId, testcaseId).find(f => f.type === 'log' && f.status === 'degraded');
      const reason = !hasIds
        ? 'No correlation IDs found in context'
        : degraded
          ? 'Log provider returned no matching entries'
          : 'Log provider not configured or not reachable';
      return {
        summary: { matched: false, highlights: [], errorSamples: [] },
        fetchedAt: new Date().toISOString(),
        unavailableReason: reason,
      };
    }
    const summary = logFetch.summary_json
      ? JSON.parse(logFetch.summary_json) as import('@zarb/shared-types').LogSummary
      : { matched: true, highlights: [], errorSamples: [] };
    return {
      summary: { ...summary, ...(logFetch.raw_link ? { rawLink: logFetch.raw_link } : {}) },
      fetchedAt: logFetch.created_at,
    };
  }

  getAnalysis(runId: string, testcaseId: string): AnalysisDetail | null {
    const row = this.analyses.findByTestcase(runId, testcaseId);
    if (!row) return null;
    return {
      id: row.id,
      ...(row.category ? { category: row.category } : {}),
      ...(row.suspected_layer ? { suspectedLayer: row.suspected_layer } : {}),
      ...(row.confidence !== null ? { confidence: row.confidence } : {}),
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.probable_cause ? { probableCause: row.probable_cause } : {}),
      suggestions: row.suggestions_json ? JSON.parse(row.suggestions_json) as string[] : [],
      version: row.version,
      createdAt: row.created_at,
    };
  }

  /**
   * fetchDiagnostics — call trace/log providers for a testcase and persist results.
   * Writes summary JSON files to the documented diagnostics layout and DB rows.
   * Provider failures are recorded as 'degraded' and do not throw.
   */
  async fetchDiagnostics(runId: string, testcaseId: string): Promise<void> {
    const ctx = this.correlations.findByTestcase(runId, testcaseId);
    const traceIds: string[] = ctx ? JSON.parse(ctx.trace_ids_json ?? '[]') as string[] : [];
    const requestIds: string[] = ctx ? JSON.parse(ctx.request_ids_json ?? '[]') as string[] : [];
    const sessionIds: string[] = ctx ? JSON.parse(ctx.session_ids_json ?? '[]') as string[] : [];
    const fromTime = ctx?.from_time ?? new Date(Date.now() - 60_000).toISOString();
    const toTime = ctx?.to_time ?? new Date().toISOString();
    const now = new Date().toISOString();

    // Fetch trace for each traceId
    if (traceIds.length > 0) {
      for (const traceId of traceIds) {
        let status: 'succeeded' | 'degraded' = 'degraded';
        let summaryJson: string | undefined;
        try {
          const summary = await this.traceProvider.getTrace(traceId);
          if (summary) {
            status = 'succeeded';
            summaryJson = JSON.stringify(summary);
            this.writeSummaryFile(traceSummaryPath(runId, testcaseId), summaryJson);
          }
        } catch { /* degraded */ }
        this.diagnosticFetches.save({
          id: randomUUID(),
          runId,
          testcaseId,
          type: 'trace',
          status,
          provider: 'jaeger',
          requestJson: JSON.stringify({ traceId }),
          ...(summaryJson ? { summaryJson } : {}),
          createdAt: now,
        });
      }
    }

    // Fetch logs
    if (traceIds.length > 0 || requestIds.length > 0 || sessionIds.length > 0) {
      let status: 'succeeded' | 'degraded' = 'degraded';
      let summaryJson: string | undefined;
      try {
        const summary = await this.logProvider.query({ traceIds, requestIds, sessionIds, fromTime, toTime });
        if (summary) {
          status = 'succeeded';
          summaryJson = JSON.stringify(summary);
          this.writeSummaryFile(logSummaryPath(runId, testcaseId), summaryJson);
        }
      } catch { /* degraded */ }
      this.diagnosticFetches.save({
        id: randomUUID(),
        runId,
        testcaseId,
        type: 'log',
        status,
        provider: 'loki',
        requestJson: JSON.stringify({ traceIds, requestIds, sessionIds, fromTime, toTime }),
        ...(summaryJson ? { summaryJson } : {}),
        createdAt: now,
      });
    }
  }

  private writeSummaryFile(relativePath: string, content: string): void {
    try {
      const abs = this.resolveDiagnosticWritePath(relativePath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    } catch { /* non-fatal */ }
  }

  retryAnalysis(runId: string, testcaseId: string): ActionResult {
    if (!this.aiEngine) {
      // Degrade gracefully — no AI engine configured, but don't fail the request
      return { success: true, message: 'Analysis retry queued (no AI engine configured)', nextSuggestedAction: 'poll-analysis' };
    }
    const result = this.results.findByTestcase(runId, testcaseId);
    const engine = this.aiEngine;
    void (async () => {
      try {
        const analysis = await engine.analyzeFailure({
          runId,
          testcaseId,
          testcaseName: testcaseId,
          ...(result?.error_message ? { errorMessage: result.error_message } : {}),
          ...(result?.error_type ? { errorType: result.error_type } : {}),
        });
        await engine.createCodeTaskDraft(analysis);
      } catch { /* degrade gracefully */ }
    })();
    return { success: true, message: 'Analysis retry queued', nextSuggestedAction: 'poll-analysis' };
  }
}
