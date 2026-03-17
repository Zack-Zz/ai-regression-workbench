// Local type definitions mirroring @zarb/shared-types for the UI bundle

export type RunMode = 'regression' | 'exploration' | 'hybrid';
export type RunStatus = 'CREATED' | 'RUNNING_TESTS' | 'PLANNING_EXPLORATION' | 'RUNNING_EXPLORATION' |
  'COLLECTING_ARTIFACTS' | 'FETCHING_TRACES' | 'FETCHING_LOGS' | 'ANALYZING_FAILURES' |
  'AWAITING_CODE_ACTION' | 'RUNNING_CODE_TASK' | 'AWAITING_REVIEW' | 'READY_TO_COMMIT' |
  'COMPLETED' | 'PAUSED' | 'FAILED' | 'CANCELLED';
export type CodeTaskStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'RUNNING' | 'VERIFYING' |
  'SUCCEEDED' | 'COMMIT_PENDING' | 'COMMITTED' | 'FAILED' | 'REJECTED' | 'CANCELLED';

export interface RunSummary {
  runId: string; runMode: RunMode; status: RunStatus;
  scopeType?: string; scopeValue?: string;
  projectId?: string; siteId?: string;
  projectName?: string; siteName?: string; siteBaseUrl?: string; credLabel?: string;
  startedAt: string; endedAt?: string;
  total: number; passed: number; failed: number; skipped: number;
  currentStage?: string;
  summary?: string;
}

export interface TestResultSummary {
  id: string; runId: string; testcaseId: string; scenarioId?: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number; errorType?: string; errorMessage?: string;
}

export interface FindingSummaryItem {
  id: string; severity: string; category: string; pageUrl?: string; summary: string;
}

export interface RunEventItem {
  eventId: string; runId: string; eventType: string;
  entityType: string; entityId: string; createdAt: string;
}

export interface ExplorationConfig {
  startUrls: string[];
  maxSteps?: number;
  maxPages?: number;
  focusAreas?: string[];
  allowedHosts?: string[];
  persistAsCandidateTests?: boolean;
}

export interface RunDetail {
  summary: RunSummary;
  testResults: TestResultSummary[];
  findings?: FindingSummaryItem[];
  events: RunEventItem[];
  explorationConfig?: ExplorationConfig;
}

export interface RunSummaryPage { items: RunSummary[]; nextCursor?: string; }
export interface RunEventPage { items: RunEventItem[]; nextCursor?: string; }

export interface ExecutionReport {
  runId: string; status: RunStatus; runMode: RunMode;
  startedAt: string; endedAt?: string;
  summary: { total: number; passed: number; failed: number; skipped: number };
  totals: { flowStepCount: number; uiActionCount: number; apiCallCount: number; failedApiCount: number };
  stageResults: Array<{ stageName: string; status: string; durationMs?: number }>;
  degradedSteps: string[]; fatalReason?: string;
  failureReports: Array<{ testcaseId: string; errorMessage?: string }>;
  codeTaskSummaries: Array<{ taskId: string; testcaseId?: string; status: CodeTaskStatus; updatedAt: string }>;
  flowSummaries: Array<{ flowId: string; stepCount: number; uiActionCount: number; apiCallCount: number; failedApiCount: number; durationMs?: number }>;
  testcaseProfiles: Array<{ testcaseId: string; profilePath: string }>;
  artifactLinks: string[];
  warnings?: string[];
}

export interface FailureReportSummary {
  runId: string; testcaseId: string; testcaseName: string;
  errorType?: string; errorMessage?: string;
  analysisStatus?: string; codeTaskStatus?: string;
}

export interface FailureReport {
  runId: string; testcaseId: string; testcaseName: string;
  errorType?: string; errorMessage?: string;
  artifacts: { screenshotPath?: string; videoPath?: string; tracePath?: string; htmlReportPath?: string; networkLogPath?: string };
  correlationContext: { traceIds: string[]; requestIds: string[]; sessionIds: string[] };
  traceSummary?: { traceId: string; hasError: boolean; errorSpans: unknown[]; topSlowSpans: unknown[]; rawLink?: string } | null;
  logSummary?: { matched: boolean; highlights: string[]; errorSamples: unknown[]; rawLink?: string } | null;
  analysis?: AnalysisDetail | null;
}

export interface TestcaseExecutionProfile {
  runId: string; testcaseId: string;
  summary: { flowStepCount: number; uiActionCount: number; apiCallCount: number; failedApiCount: number };
  flowSteps: Array<{ id: string; flowId: string; stepName: string; success: boolean; startedAt: string; durationMs?: number }>;
  uiActions: Array<{ id: string; actionType: string; success: boolean; startedAt: string; pageUrl?: string; durationMs?: number }>;
  apiCalls: Array<{ id: string; url: string; method?: string; statusCode?: number; success: boolean; durationMs?: number; errorMessage?: string; responseSummary?: string }>;
}

export interface DiagnosticsDetail {
  correlationContext: { traceIds: string[]; requestIds: string[]; sessionIds: string[] };
  diagnosticFetches: Array<{ id: string; type: string; status: string; provider?: string; rawLink?: string; createdAt: string }>;
}

export interface TraceDetail {
  summary: { traceId: string; hasError: boolean; errorSpans: unknown[]; topSlowSpans: unknown[]; rawLink?: string };
  fetchedAt: string;
  unavailableReason?: string;
}

export interface LogDetail {
  summary: { matched: boolean; highlights: string[]; errorSamples: unknown[]; rawLink?: string };
  fetchedAt: string;
  unavailableReason?: string;
}

export interface AnalysisDetail {
  id: string; category?: string; suspectedLayer?: string; confidence?: number;
  summary?: string; probableCause?: string; suggestions?: string[];
  version: number; createdAt: string;
}

export interface CodeTaskSummary {
  taskId: string; parentTaskId?: string; taskVersion: number; runId: string;
  testcaseId?: string; status: CodeTaskStatus; agentName?: string;
  automationLevel: string; mode: string; target: string;
  workspacePath: string; goal: string; verifyPassed?: boolean; updatedAt: string;
}

export interface ReviewRecord {
  reviewId: string; taskId: string; decision: 'accept' | 'reject' | 'retry';
  comment?: string; codeTaskVersion: number; createdAt: string;
}

export interface CommitRecord {
  commitRecordId: string; taskId: string; branchName?: string;
  commitSha?: string; commitMessage?: string; status: string;
  errorMessage?: string; createdAt: string;
}

export interface CodeTaskDetail {
  summary: CodeTaskSummary;
  scopePaths: string[]; constraints: string[]; verificationCommands: string[];
  changedFiles: string[]; diffPath?: string; patchPath?: string; rawOutputPath?: string;
  reviews: ReviewRecord[];
  commit?: CommitRecord;
}

export interface CodeTaskSummaryPage { items: CodeTaskSummary[]; nextCursor?: string; }

export interface CodeTaskDraftRow {
  id: string; run_id: string; analysis_id: string | null;
  goal: string; target: string; workspace_path: string;
  scope_paths_json: string | null; constraints_json: string | null;
  verification_commands_json: string | null;
  prompt_template_version: string; status: string; created_at: string;
}

export interface Project {
  id: string; name: string; description?: string; createdAt: string; updatedAt: string;
}
export interface Site {
  id: string; projectId: string; name: string; baseUrl: string;
  description?: string; createdAt: string; updatedAt: string;
}
export interface SiteCredential {
  id: string; siteId: string; label: string; username?: string;
  authType?: 'userpass' | 'cookie' | 'token';
  isDefault: boolean; createdAt: string;
}
export interface LocalRepo {
  id: string; projectId: string; name: string; path: string;
  description?: string; testOutputDir?: string; baseBranch?: string; createdAt: string; updatedAt: string;
}

export interface SelectorCacheEntry {
  id: string; site_id: string; repo_id: string;
  type: 'suite' | 'scenario' | 'tag' | 'testcase';
  value: string; source: 'scan' | 'history'; last_seen: string;
}

export interface StepLogEntry {
  ts: string; component: string; action: string; detail?: string;
  status: 'ok' | 'warn' | 'error' | 'skip' | 'pending'; durationMs?: number;
  toolInput?: unknown; toolOutput?: unknown;
  pageState?: { url: string; title: string; formCount: number; linkCount: number; consoleErrors: number; networkErrors: number };
  reason?: string;
  model?: string;
  tool?: string;
  actionId?: string;
}
export interface NetworkLogEntry {
  ts: string; url: string; method: string; status: number;
  durationMs: number; resourceType: string; error?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

export interface ActionResult {
  success: boolean; message: string; errorCode?: string; nextSuggestedAction?: string;
}

export interface StartRunInput {
  runMode: RunMode;
  selector?: { suite?: string; scenarioId?: string; tag?: string; testcaseId?: string };
  projectPath?: string;
  projectId?: string;
  siteId?: string;
  credentialId?: string;
  exploration?: { startUrls: string[]; allowedHosts?: string[]; maxSteps: number; maxPages: number; focusAreas?: string[]; persistAsCandidateTests?: boolean; credentialId?: string };
}

export interface StartRunResult extends ActionResult { run?: RunSummary; }

export interface SubmitReviewInput {
  taskId: string; decision: 'accept' | 'reject' | 'retry';
  comment?: string; diffHash?: string; patchHash?: string;
  codeTaskVersion: number; forceReviewOnVerifyFailure?: boolean;
}

export interface CreateCommitInput { taskId: string; commitMessage: string; expectedTaskVersion?: number; }

export interface PersonalSettings {
  storage: { sqlitePath: string; artifactRoot: string; diagnosticRoot: string; codeTaskRoot: string };
  workspace: { targetProjectPath: string; gitRootStrategy: string; allowOutsideToolWorkspace: boolean };
  testAssets: { sharedRootMode: string; generatedRoot: string; includeSharedInRuns: boolean; includeGeneratedInRuns: boolean; requireGitForSharedRoot: boolean; sharedRoot?: string };
  diagnostics: { correlationKeys: { responseHeaders: string[]; responseBodyPaths: string[]; logFields: string[]; caseInsensitiveHeaderMatch: boolean; timeWindowSeconds: number } };
  trace: { provider: string; endpoint: string };
  logs: { provider: string; endpoint: string; defaultLimit: number; redactFields: string[] };
  ai: {
    activeProvider: string;
    enabled: boolean;
    promptTemplatesDir?: string;
    providers: {
      [key: string]: {
        baseUrl: string;
        model: string;
        apiKey?: string;
        apiKeyEnvVar?: string;
      };
    };
  };
  codeAgent: { defaultApprovalRequired: boolean; allowedWriteScopes: string[]; defaultVerifyCommands: string[]; allowReviewOnVerifyFailure?: boolean };
  report: { port: number };
  ui?: { locale?: 'zh-CN' | 'en-US' };
}

export interface SettingsSnapshot { version: number; sourcePath: string; updatedAt: string; values: PersonalSettings; }
export interface UpdateSettingsInput { patch: Partial<PersonalSettings>; expectedVersion?: number; }
export interface SettingsValidationResult { valid: boolean; errors: string[]; warnings?: string[]; }
export interface SettingsApplyResult extends ActionResult { version?: number; requiresRestart?: boolean; reloadedModules?: string[]; nextRunOnlyKeys?: string[]; }

export type SSEEventType =
  | 'run.created' | 'run.updated' | 'run.step.updated'
  | 'code-task.created' | 'code-task.updated';
export interface SSEEvent { type: SSEEventType; id?: string; projectId?: string; ts: number; }
