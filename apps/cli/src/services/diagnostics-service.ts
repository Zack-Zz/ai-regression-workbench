import type { Db } from '@zarb/storage';
import {
  TestResultRepository, CorrelationContextRepository, DiagnosticFetchRepository, AnalysisRepository,
  ApiCallRepository, UiActionRepository, FlowStepRepository,
} from '@zarb/storage';
import type {
  FailureReportSummary, FailureReport, DiagnosticsDetail, AnalysisDetail, ActionResult,
  TestcaseExecutionProfile, TraceDetail, LogDetail,
} from '@zarb/shared-types';

export class DiagnosticsService {
  private readonly results: TestResultRepository;
  private readonly correlations: CorrelationContextRepository;
  private readonly diagnosticFetches: DiagnosticFetchRepository;
  private readonly analyses: AnalysisRepository;
  private readonly apiCalls: ApiCallRepository;
  private readonly uiActions: UiActionRepository;
  private readonly flowSteps: FlowStepRepository;

  constructor(private readonly db: Db) {
    this.results = new TestResultRepository(db);
    this.correlations = new CorrelationContextRepository(db);
    this.diagnosticFetches = new DiagnosticFetchRepository(db);
    this.analyses = new AnalysisRepository(db);
    this.apiCalls = new ApiCallRepository(db);
    this.uiActions = new UiActionRepository(db);
    this.flowSteps = new FlowStepRepository(db);
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
      },
      correlationContext: {
        traceIds: ctx ? JSON.parse(ctx.trace_ids_json ?? '[]') as string[] : [],
        requestIds: ctx ? JSON.parse(ctx.request_ids_json ?? '[]') as string[] : [],
        sessionIds: ctx ? JSON.parse(ctx.session_ids_json ?? '[]') as string[] : [],
      },
    };
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

  getTrace(runId: string, testcaseId: string): TraceDetail | null {
    const fetches = this.diagnosticFetches.findByTestcase(runId, testcaseId);
    const traceFetch = fetches.find(f => f.type === 'trace' && f.status === 'succeeded');
    if (!traceFetch) return null;
    return {
      summary: {
        traceId: traceFetch.id,
        hasError: false,
        errorSpans: [],
        topSlowSpans: [],
        ...(traceFetch.raw_link ? { rawLink: traceFetch.raw_link } : {}),
      },
      fetchedAt: traceFetch.created_at,
    };
  }

  getLogs(runId: string, testcaseId: string): LogDetail | null {
    const fetches = this.diagnosticFetches.findByTestcase(runId, testcaseId);
    const logFetch = fetches.find(f => f.type === 'log' && f.status === 'succeeded');
    if (!logFetch) return null;
    return {
      summary: {
        matched: true,
        highlights: [],
        errorSamples: [],
        ...(logFetch.raw_link ? { rawLink: logFetch.raw_link } : {}),
      },
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

  retryAnalysis(_runId: string, _testcaseId: string): ActionResult {
    return { success: true, message: 'Analysis retry queued', nextSuggestedAction: 'poll-analysis' };
  }
}
