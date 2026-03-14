import type {
  ActionResult,
  AgentSession,
  AnalysisDetail,
  CodeTaskDetail,
  CodeTaskSummaryPage,
  CommitDetail,
  DiagnosticsDetail,
  ExecutionReport,
  FailureReport,
  FailureReportSummary,
  LogDetail,
  ReviewRecord,
  RunDetail,
  RunEventPage,
  RunSummaryPage,
  StartRunResult,
  TestcaseExecutionProfile,
  TraceDetail,
  WorkspaceSummary,
} from './dtos.js';
import type { RunMode } from './enums.js';

// ---------------------------------------------------------------------------
// Query inputs
// ---------------------------------------------------------------------------

export interface ListRunsQuery {
  cursor?: string;
  limit?: number;
  status?: string;
  runMode?: RunMode;
}

export interface RunEventsQuery {
  cursor?: string;
  limit?: number;
}

export interface ListCodeTasksQuery {
  cursor?: string;
  limit?: number;
  status?: string;
  runId?: string;
}

// ---------------------------------------------------------------------------
// Mutation inputs
// ---------------------------------------------------------------------------

export interface StartRunInput {
  runMode: RunMode;
  selector?: {
    suite?: string;
    scenarioId?: string;
    tag?: string;
    testcaseId?: string;
  };
  projectPath?: string;
  includeSharedInRuns?: boolean;
  includeGeneratedInRuns?: boolean;
  exploration?: {
    startUrls: string[];
    allowedHosts?: string[];
    maxSteps: number;
    maxPages: number;
    focusAreas?: string[];
    persistAsCandidateTests?: boolean;
  };
}

export interface UpdateWorkspaceInput {
  targetProjectPath: string;
}

export interface SubmitReviewInput {
  taskId: string;
  decision: 'accept' | 'reject' | 'retry';
  comment?: string;
  diffHash?: string;
  patchHash?: string;
  /** Must match the current CodeTask.taskVersion (persisted as attempt) */
  codeTaskVersion: number;
  /** Only valid when decision=accept and verify failed; enables override review */
  forceReviewOnVerifyFailure?: boolean;
}

export interface CreateCommitInput {
  taskId: string;
  commitMessage: string;
  expectedTaskVersion?: number;
}

// ---------------------------------------------------------------------------
// Settings types
// ---------------------------------------------------------------------------

export interface PersonalSettings {
  storage: {
    sqlitePath: string;
    artifactRoot: string;
    diagnosticRoot: string;
    codeTaskRoot: string;
  };
  workspace: {
    targetProjectPath: string;
    gitRootStrategy: 'auto' | 'strict';
    allowOutsideToolWorkspace: boolean;
  };
  testAssets: {
    sharedRoot?: string;
    sharedRootMode: 'auto' | 'relative-to-target' | 'absolute';
    generatedRoot: string;
    includeSharedInRuns: boolean;
    includeGeneratedInRuns: boolean;
    requireGitForSharedRoot: boolean;
  };
  diagnostics: {
    correlationKeys: {
      responseHeaders: string[];
      responseBodyPaths: string[];
      logFields: string[];
      caseInsensitiveHeaderMatch: boolean;
      timeWindowSeconds: number;
    };
  };
  trace: {
    provider: string;
    endpoint: string;
  };
  logs: {
    provider: string;
    endpoint: string;
    defaultLimit: number;
    redactFields: string[];
  };
  ai: {
    provider: string;
    model: string;
    enabled: boolean;
    promptTemplatesDir?: string;
    apiKeyEnvVar?: string;
  };
  exploration?: {
    defaultMode?: RunMode;
    maxSteps?: number;
    maxPages?: number;
    allowedHosts?: string[];
    defaultFocusAreas?: string[];
    persistAsCandidateTests?: boolean;
  };
  codeAgent: {
    defaultApprovalRequired: boolean;
    allowedWriteScopes: string[];
    defaultVerifyCommands: string[];
    allowReviewOnVerifyFailure?: boolean;
  };
  report: {
    port: number;
  };
  ui?: {
    locale?: 'zh-CN' | 'en-US';
  };
}

export interface SettingsSnapshot {
  version: number;
  sourcePath: string;
  updatedAt: string;
  values: PersonalSettings;
}

export interface UpdateSettingsInput {
  patch: Partial<PersonalSettings>;
  expectedVersion?: number;
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface SettingsApplyResult extends ActionResult {
  version?: number;
  reloadedModules?: string[];
  nextRunOnlyKeys?: string[];
  requiresRestart?: boolean;
}

export interface SharedAssetsStatus {
  sharedRootStatus: 'missing' | 'available' | 'invalid';
  resolvedPath: string | null;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Bootstrap / init / doctor
// ---------------------------------------------------------------------------

export interface BootstrapResult extends ActionResult {
  initialized: boolean;
  migrationsApplied: number;
}

export interface InitRequest {
  targetProjectPath?: string;
  sharedRoot?: string;
}

export interface InitResult extends ActionResult {
  configPath: string;
  dataDir: string;
}

export interface DoctorCheckItem {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message?: string;
}

export interface DoctorResult {
  allPassed: boolean;
  checks: DoctorCheckItem[];
}

export interface UiLaunchResult extends ActionResult {
  url: string;
}

// ---------------------------------------------------------------------------
// Review detail (used by ReviewService)
// ---------------------------------------------------------------------------

export interface ReviewDetail {
  taskId: string;
  reviews: ReviewRecord[];
  latestReview?: ReviewRecord;
}

// ---------------------------------------------------------------------------
// Service interfaces
// ---------------------------------------------------------------------------

export interface BootstrapService {
  bootstrap(): Promise<BootstrapResult>;
  init(config?: InitRequest): Promise<InitResult>;
  doctor(): Promise<DoctorResult>;
  startUi(): Promise<UiLaunchResult>;
}

export interface WorkspaceService {
  getWorkspace(): Promise<WorkspaceSummary>;
  updateWorkspace(input: UpdateWorkspaceInput): Promise<WorkspaceSummary>;
  resolveSharedAssets(): Promise<SharedAssetsStatus>;
}

export interface RunService {
  startRun(input: StartRunInput): Promise<StartRunResult>;
  listRuns(query?: ListRunsQuery): Promise<RunSummaryPage>;
  getRun(runId: string): Promise<RunDetail>;
  getExecutionReport(runId: string): Promise<ExecutionReport | null>;
  getRunEvents(runId: string, query?: RunEventsQuery): Promise<RunEventPage>;
  pauseRun(runId: string): Promise<ActionResult>;
  resumeRun(runId: string): Promise<ActionResult>;
  cancelRun(runId: string): Promise<ActionResult>;
}

export interface DiagnosticsService {
  listFailureReports(runId: string): Promise<FailureReportSummary[]>;
  getFailureReport(runId: string, testcaseId: string): Promise<FailureReport>;
  getExecutionProfile(runId: string, testcaseId: string): Promise<TestcaseExecutionProfile | null>;
  getDiagnostics(runId: string, testcaseId: string): Promise<DiagnosticsDetail>;
  getTrace(runId: string, testcaseId: string): Promise<TraceDetail | null>;
  getLogs(runId: string, testcaseId: string): Promise<LogDetail | null>;
  getAnalysis(runId: string, testcaseId: string): Promise<AnalysisDetail | null>;
  retryAnalysis(runId: string, testcaseId: string): Promise<ActionResult>;
}

export interface CodeTaskService {
  listCodeTasks(query?: ListCodeTasksQuery): Promise<CodeTaskSummaryPage>;
  getCodeTask(taskId: string): Promise<CodeTaskDetail>;
  approveCodeTask(taskId: string): Promise<ActionResult>;
  rejectCodeTask(taskId: string): Promise<ActionResult>;
  executeCodeTask(taskId: string): Promise<ActionResult>;
  retryCodeTask(taskId: string): Promise<ActionResult>;
  cancelCodeTask(taskId: string): Promise<ActionResult>;
}

export interface ReviewService {
  getReview(taskId: string): Promise<ReviewDetail | null>;
  submitReview(input: SubmitReviewInput): Promise<ActionResult>;
}

export interface CommitService {
  getCommit(taskId: string): Promise<CommitDetail | null>;
  createCommit(input: CreateCommitInput): Promise<ActionResult>;
}

export interface SettingsService {
  getSettings(): Promise<SettingsSnapshot>;
  validateSettings(input: UpdateSettingsInput): Promise<SettingsValidationResult>;
  updateSettings(input: UpdateSettingsInput): Promise<SettingsApplyResult>;
}

// ---------------------------------------------------------------------------
// Config observer (for hot-reload broadcast)
// ---------------------------------------------------------------------------

export interface ConfigObserver {
  onConfigUpdated(snapshot: SettingsSnapshot): Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent session (used by Harness)
// ---------------------------------------------------------------------------

export { AgentSession };
