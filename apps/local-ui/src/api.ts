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

  // Exploration session detail
  getRunSteps: (runId: string) => get<import('./types').StepLogEntry[]>(`/runs/${runId}/steps`),
  getRunNetwork: (runId: string) => get<import('./types').NetworkLogEntry[]>(`/runs/${runId}/network`),

  // Settings
  getSettings: () => get<import('./types').SettingsSnapshot>('/settings'),
  validateSettings: (body: import('./types').UpdateSettingsInput) => post<import('./types').SettingsValidationResult>('/settings/validate', body),
  updateSettings: (body: import('./types').UpdateSettingsInput) => put<import('./types').SettingsApplyResult>('/settings', body),

  // Projects
  listProjects: () => get<import('./types').Project[]>('/projects'),
  createProject: (body: { name: string; description?: string }) => post<import('./types').Project>('/projects', body),
  getProject: (id: string) => get<import('./types').Project>(`/projects/${id}`),
  updateProject: (id: string, body: { name: string; description?: string }) => put<import('./types').Project>(`/projects/${id}`, body),
  deleteProject: (id: string) => request<import('./types').ActionResult>('DELETE', `/projects/${id}`),

  listSites: (projectId: string) => get<import('./types').Site[]>(`/projects/${projectId}/sites`),
  createSite: (projectId: string, body: { name: string; baseUrl: string; description?: string }) => post<import('./types').Site>(`/projects/${projectId}/sites`, body),
  updateSite: (projectId: string, siteId: string, body: { name: string; baseUrl: string; description?: string }) => put<import('./types').Site>(`/projects/${projectId}/sites/${siteId}`, body),
  deleteSite: (projectId: string, siteId: string) => request<import('./types').ActionResult>('DELETE', `/projects/${projectId}/sites/${siteId}`),

  listCredentials: (projectId: string, siteId: string) => get<import('./types').SiteCredential[]>(`/projects/${projectId}/sites/${siteId}/credentials`),
  createCredential: (projectId: string, siteId: string, body: {
    label: string; authType?: 'userpass' | 'cookie' | 'token';
    loginUrl?: string; usernameSelector?: string; passwordSelector?: string; submitSelector?: string;
    username?: string; password?: string; cookiesJson?: string; headersJson?: string;
  }) => post<import('./types').SiteCredential>(`/projects/${projectId}/sites/${siteId}/credentials`, body),
  updateCredential: (projectId: string, siteId: string, credId: string, body: {
    label?: string; authType?: 'userpass' | 'cookie' | 'token';
    loginUrl?: string; username?: string; password?: string; cookiesJson?: string; headersJson?: string;
  }) => put<import('./types').SiteCredential>(`/projects/${projectId}/sites/${siteId}/credentials/${credId}`, body),
  deleteCredential: (projectId: string, siteId: string, credId: string) => request<import('./types').ActionResult>('DELETE', `/projects/${projectId}/sites/${siteId}/credentials/${credId}`),

  listRepos: (projectId: string) => get<import('./types').LocalRepo[]>(`/projects/${projectId}/repos`),
  createRepo: (projectId: string, body: { name: string; path: string; description?: string; testOutputDir?: string }) => post<import('./types').LocalRepo>(`/projects/${projectId}/repos`, body),
  updateRepo: (projectId: string, repoId: string, body: { name: string; path: string; description?: string; testOutputDir?: string }) => put<import('./types').LocalRepo>(`/projects/${projectId}/repos/${repoId}`, body),
  deleteRepo: (projectId: string, repoId: string) => request<import('./types').ActionResult>('DELETE', `/projects/${projectId}/repos/${repoId}`),

  listSelectors: (projectId: string, siteId: string, repoId: string, type?: string) =>
    get<import('./types').SelectorCacheEntry[]>(`/projects/${projectId}/sites/${siteId}/selectors?repoId=${repoId}${type ? `&type=${type}` : ''}`),
  scanSelectors: (projectId: string, siteId: string, repoId: string) =>
    post<{ scanned: number; upserted: number }>(`/projects/${projectId}/sites/${siteId}/selectors/scan`, { repoId }),
  listSelectorsForRepo: (projectId: string, repoId: string, type?: string) =>
    get<import('./types').SelectorCacheEntry[]>(`/projects/${projectId}/repos/${repoId}/selectors${type ? `?type=${type}` : ''}`),
  scanSelectorsForRepo: (projectId: string, repoId: string) =>
    post<{ scanned: number; upserted: number }>(`/projects/${projectId}/repos/${repoId}/selectors/scan`, {}),
  listSelectorsForProject: (projectId: string, type?: string) =>
    get<import('./types').SelectorCacheEntry[]>(`/projects/${projectId}/selectors${type ? `?type=${type}` : ''}`),
  getRepoGitInfo: (projectId: string, repoId: string) =>
    get<{ branches: string[]; current: string; isGit: boolean }>(`/projects/${projectId}/repos/${repoId}/git-info`),
  validatePath: (path: string) =>
    post<{ exists: boolean; isDir: boolean; isGit: boolean }>('/utils/validate-path', { path }),
};
