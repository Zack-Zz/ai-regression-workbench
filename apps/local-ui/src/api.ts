/** Thin API client — all calls go through /api proxy to the CLI server. */

const BASE = '/api';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly errorCode: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const json = await res.json() as { success: boolean; data?: T; message: string; errorCode?: string };
  if (!json.success) throw new ApiError(res.status, json.errorCode ?? 'UNKNOWN', json.message);
  return json.data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);

// Runs
export const api = {
  listRuns: (q?: string) => get<import('./types').RunSummaryPage>(`/runs${q ? `?${q}` : ''}`),
  getRun: (id: string) => get<import('./types').RunDetail>(`/runs/${id}`),
  getExecutionReport: (id: string) => get<import('./types').ExecutionReport>(`/runs/${id}/execution-report`),
  getRunEvents: (id: string, q?: string) => get<import('./types').RunEventPage>(`/runs/${id}/events${q ? `?${q}` : ''}`),
  startRun: (body: import('./types').StartRunInput) => post<import('./types').StartRunResult>('/runs', body),
  pauseRun: (id: string) => post<import('./types').ActionResult>(`/runs/${id}/pause`),
  resumeRun: (id: string) => post<import('./types').ActionResult>(`/runs/${id}/resume`),
  cancelRun: (id: string) => post<import('./types').ActionResult>(`/runs/${id}/cancel`),

  // Diagnostics
  listFailureReports: (runId: string) => get<import('./types').FailureReportSummary[]>(`/runs/${runId}/failure-reports`),
  getFailureReport: (runId: string, tcId: string) => get<import('./types').FailureReport>(`/runs/${runId}/testcases/${tcId}/failure-report`),
  getExecutionProfile: (runId: string, tcId: string) => get<import('./types').TestcaseExecutionProfile>(`/runs/${runId}/testcases/${tcId}/execution-profile`),
  getDiagnostics: (runId: string, tcId: string) => get<import('./types').DiagnosticsDetail>(`/runs/${runId}/testcases/${tcId}/diagnostics`),
  getTrace: (runId: string, tcId: string) => get<import('./types').TraceDetail | null>(`/runs/${runId}/testcases/${tcId}/trace`),
  getLogs: (runId: string, tcId: string) => get<import('./types').LogDetail | null>(`/runs/${runId}/testcases/${tcId}/logs`),
  getAnalysis: (runId: string, tcId: string) => get<import('./types').AnalysisDetail | null>(`/runs/${runId}/testcases/${tcId}/analysis`),
  retryAnalysis: (runId: string, tcId: string) => post<import('./types').ActionResult>(`/runs/${runId}/testcases/${tcId}/analysis/retry`),
  listDrafts: (runId: string, tcId: string) => get<import('./types').CodeTaskDraftRow[]>(`/runs/${runId}/testcases/${tcId}/drafts`),
  promoteDraft: (runId: string, tcId: string, draftId: string) => post<import('./types').ActionResult & { taskId?: string }>(`/runs/${runId}/testcases/${tcId}/drafts/${draftId}/promote`),

  // Code Tasks
  listCodeTasks: (q?: string) => get<import('./types').CodeTaskSummaryPage>(`/code-tasks${q ? `?${q}` : ''}`),
  getCodeTask: (id: string) => get<import('./types').CodeTaskDetail>(`/code-tasks/${id}`),
  approveCodeTask: (id: string) => post<import('./types').ActionResult>(`/code-tasks/${id}/approve`),
  rejectCodeTask: (id: string) => post<import('./types').ActionResult>(`/code-tasks/${id}/reject`),
  executeCodeTask: (id: string) => post<import('./types').ActionResult>(`/code-tasks/${id}/execute`),
  retryCodeTask: (id: string) => post<import('./types').ActionResult>(`/code-tasks/${id}/retry`),
  cancelCodeTask: (id: string) => post<import('./types').ActionResult>(`/code-tasks/${id}/cancel`),
  submitReview: (body: import('./types').SubmitReviewInput) => post<import('./types').ActionResult>('/reviews', body),
  createCommit: (body: import('./types').CreateCommitInput) => post<import('./types').ActionResult>('/commits', body),

  // Settings
  getSettings: () => get<import('./types').SettingsSnapshot>('/settings'),
  validateSettings: (body: import('./types').UpdateSettingsInput) => post<import('./types').SettingsValidationResult>('/settings/validate', body),
  updateSettings: (body: import('./types').UpdateSettingsInput) => put<import('./types').SettingsApplyResult>('/settings', body),
};
