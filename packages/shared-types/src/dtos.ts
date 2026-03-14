import type {
  RunMode,
  RunScopeType,
  RunStatus,
  CodeTaskStatus,
  AutomationLevel,
  ReviewDecision,
  CommitStatus,
  RunEventType,
  SystemEventType,
  FindingSeverity,
  AgentSessionKind,
  AgentSessionStatus,
  CodeTaskMode,
  CodeTaskTarget,
  UiActionType,
  StageResultStatus,
  DiagnosticFetchType,
  DiagnosticFetchStatus,
} from './enums.js';
// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface RunSelector {
  suite?: string;
  scenarioId?: string;
  tag?: string;
  testcaseId?: string;
}

export interface ExplorationConfig {
  startUrls: string[];
  allowedHosts?: string[];
  maxSteps: number;
  maxPages: number;
  focusAreas?: Array<'smoke' | 'navigation' | 'forms' | 'console-errors' | 'network-errors' | 'auth'>;
  persistAsCandidateTests?: boolean;
}

export interface RunSummary {
  runId: string;
  runMode: RunMode;
  status: RunStatus;
  scopeType?: RunScopeType;
  scopeValue?: string;
  startedAt: string;
  endedAt?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  currentStage?: string;
}

export interface RunDetail {
  summary: RunSummary;
  testResults: TestResultSummary[];
  findings?: FindingSummaryItem[];
  selectedFailure?: FailureSnapshot;
  diagnosticsSummary?: DiagnosticsSummary;
  analysisSummary?: AnalysisSummary;
  events: RunEventItem[];
}

export interface FindingSummaryItem {
  id: string;
  severity: FindingSeverity;
  category: string;
  pageUrl?: string;
  summary: string;
}

export interface FailureSnapshot {
  testcaseId: string;
  errorType?: string;
  errorMessage?: string;
}

export interface DiagnosticsSummary {
  traceAvailable: boolean;
  logsAvailable: boolean;
  correlationKeysFound: number;
}

export interface AnalysisSummary {
  category?: string;
  confidence?: number;
  summary?: string;
}

// ---------------------------------------------------------------------------
// TestResult
// ---------------------------------------------------------------------------

export interface TestResultSummary {
  id: string;
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  status: 'passed' | 'failed' | 'skipped';
  errorType?: string;
  errorMessage?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface RunEventItem {
  eventId: string;
  runId: string;
  eventType: RunEventType;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  payloadSchemaVersion?: number;
  createdAt: string;
}

export interface RunEventPage {
  items: RunEventItem[];
  nextCursor?: string;
}

export interface RunSummaryPage {
  items: RunSummary[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// CodeTask
// ---------------------------------------------------------------------------

export interface CodeTaskSummary {
  taskId: string;
  parentTaskId?: string;
  /** API/DTO name for persisted `attempt` field */
  taskVersion: number;
  runId: string;
  testcaseId?: string;
  status: CodeTaskStatus;
  agentName?: string;
  automationLevel: AutomationLevel;
  mode: CodeTaskMode;
  target: CodeTaskTarget;
  workspacePath: string;
  goal: string;
  verifyPassed?: boolean;
  updatedAt: string;
}

export interface CodeTaskDetail {
  summary: CodeTaskSummary;
  scopePaths: string[];
  constraints: string[];
  verificationCommands: string[];
  changedFiles: string[];
  diffPath?: string;
  patchPath?: string;
  rawOutputPath?: string;
  verifyOutputPath?: string;
  reviews: ReviewRecord[];
  commit?: CommitDetail | null;
}

export interface CodeTaskSummaryPage {
  items: CodeTaskSummary[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Review & Commit
// ---------------------------------------------------------------------------

export interface ReviewRecord {
  reviewId: string;
  taskId: string;
  decision: ReviewDecision;
  comment?: string;
  diffHash?: string;
  patchHash?: string;
  /** Corresponds to CodeTask.taskVersion (persisted as attempt) */
  codeTaskVersion: number;
  createdAt: string;
}

export interface CommitDetail {
  commitRecordId: string;
  taskId: string;
  branchName?: string;
  commitSha?: string;
  commitMessage?: string;
  status: CommitStatus;
  errorMessage?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Execution Report
// ---------------------------------------------------------------------------

export interface ExecutionStageResult {
  stage: string;
  status: StageResultStatus;
  message?: string;
}

export interface ExecutionReport {
  runId: string;
  status: RunStatus;
  runMode: RunMode;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  scopeType?: RunScopeType;
  scopeValue?: string;
  selector?: RunSelector;
  exploration?: ExplorationConfig;
  summary: { total: number; passed: number; failed: number; skipped: number };
  totals: { flowStepCount: number; uiActionCount: number; apiCallCount: number; failedApiCount: number };
  stageResults: ExecutionStageResult[];
  degradedSteps: string[];
  fatalReason?: string;
  failureReports: Array<{ testcaseId: string; errorMessage?: string; reportPath?: string }>;
  codeTaskSummaries: Array<{ taskId: string; testcaseId?: string; status: CodeTaskStatus; updatedAt: string }>;
  flowSummaries: Array<{
    flowId: string;
    stepCount: number;
    uiActionCount: number;
    apiCallCount: number;
    failedApiCount: number;
    durationMs?: number;
  }>;
  testcaseProfiles: Array<{ testcaseId: string; profilePath: string }>;
  artifactLinks: string[];
  warnings?: string[];
  recommendations?: string[];
}

// ---------------------------------------------------------------------------
// Testcase Execution Profile
// ---------------------------------------------------------------------------

export interface ApiCallItem {
  id: string;
  flowStepId?: string;
  uiActionId?: string;
  method?: string;
  url: string;
  statusCode?: number;
  responseSummary?: string;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  traceId?: string;
  requestId?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export interface UiActionItem {
  id: string;
  flowStepId?: string;
  actionType: UiActionType;
  locator?: string;
  pageUrl?: string;
  success: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  apiCallCount?: number;
  failedApiCount?: number;
  apiCallIds?: string[];
}

export interface FlowStepItem {
  id: string;
  flowId: string;
  stepName: string;
  success: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  uiActionCount?: number;
  apiCallCount?: number;
  failedApiCount?: number;
  uiActionIds?: string[];
  apiCallIds?: string[];
}

export interface TestcaseExecutionProfile {
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  summary: { flowStepCount: number; uiActionCount: number; apiCallCount: number; failedApiCount: number };
  flowSteps: FlowStepItem[];
  uiActions: UiActionItem[];
  apiCalls: ApiCallItem[];
}

// ---------------------------------------------------------------------------
// Failure Report
// ---------------------------------------------------------------------------

export interface FailureReportSummary {
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  testcaseName: string;
  errorType?: string;
  errorMessage?: string;
  analysisStatus?: string;
  codeTaskStatus?: string;
}

export interface CorrelationContext {
  traceIds: string[];
  requestIds: string[];
  sessionIds: string[];
  serviceHints?: string[];
  fromTime?: string;
  toTime?: string;
}

export interface TraceSummary {
  traceId: string;
  rootService?: string;
  rootOperation?: string;
  durationMs?: number;
  hasError: boolean;
  errorSpans: Array<{ spanId: string; service?: string; operation?: string; message?: string; durationMs?: number }>;
  topSlowSpans: Array<{ spanId: string; service?: string; operation?: string; durationMs?: number }>;
  rawLink?: string;
}

export interface LogSummary {
  matched: boolean;
  source?: string;
  totalHits?: number;
  highlights: string[];
  errorSamples: Array<{ timestamp: string; level?: string; service?: string; message: string }>;
  rawLink?: string;
}

export interface FailureReport {
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  testcaseName: string;
  errorType?: string;
  errorMessage?: string;
  artifacts: ArtifactRefs;
  correlationContext: CorrelationContext;
  traceSummary?: TraceSummary | null;
  logSummary?: LogSummary | null;
  analysis?: AnalysisDetail | null;
}

export interface ArtifactRefs {
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  htmlReportPath?: string;
  networkLogPath?: string;
}

export interface TraceDetail {
  summary: TraceSummary;
  fetchedAt: string;
}

export interface LogDetail {
  summary: LogSummary;
  fetchedAt: string;
}

export interface AnalysisDetail {
  id: string;
  category?: string;
  suspectedLayer?: string;
  confidence?: number;
  summary?: string;
  probableCause?: string;
  suggestions?: string[];
  version: number;
  createdAt: string;
}

export interface DiagnosticsDetail {
  correlationContext: CorrelationContext;
  diagnosticFetches: DiagnosticFetchRecord[];
}

export interface DiagnosticFetchRecord {
  id: string;
  type: DiagnosticFetchType;
  status: DiagnosticFetchStatus;
  provider?: string;
  rawLink?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Agent Session
// ---------------------------------------------------------------------------

export interface AgentSession {
  sessionId: string;
  runId: string;
  taskId?: string;
  agentName: string;
  kind: AgentSessionKind;
  status: AgentSessionStatus;
  policyJson?: string;
  checkpointId?: string;
  contextRefsJson?: string;
  tracePath?: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  targetWorkspacePath: string | null;
  targetGitRoot: string | null;
  sharedRootConfigured: boolean;
  sharedRootResolvedPath: string | null;
  sharedRootStatus: 'missing' | 'available' | 'invalid';
  codexAvailable: boolean;
  kiroAvailable: boolean;
  playwrightAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Action result (common response envelope for mutations)
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  message: string;
  errorCode?: string;
  warnings?: string[];
  nextSuggestedAction?: string;
  retryable?: boolean;
}

export interface StartRunResult extends ActionResult {
  run?: RunSummary;
}

// ---------------------------------------------------------------------------
// System event
// ---------------------------------------------------------------------------

export interface SystemEventRecord {
  id: string;
  eventType: SystemEventType;
  payloadSchemaVersion: number;
  payloadJson?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AI Engine — Phase 6
// ---------------------------------------------------------------------------

export interface FailureContext {
  runId: string;
  testcaseId: string;
  testcaseName: string;
  errorType?: string;
  errorMessage?: string;
  screenshotPath?: string;
  networkLogPath?: string;
  traceSummary?: TraceSummary;
  logSummary?: LogSummary;
  verifyOutput?: string;
}

export interface ExplorationFindingContext {
  runId: string;
  sessionId: string;
  findings: Array<{
    findingId: string;
    category: string;
    severity: string;
    description: string;
    url?: string;
    screenshotPath?: string;
  }>;
}

export interface FailureAnalysis {
  id: string;
  runId: string;
  testcaseId: string;
  category: string;
  suspectedLayer: string;
  confidence: number;
  summary: string;
  probableCause: string;
  suggestions: string[];
  promptTemplateVersion: string;
  createdAt: string;
}

export interface FindingSummary {
  findingId: string;
  category: string;
  severity: string;
  summary: string;
  suggestedAction: string;
}

export interface GeneratedTestDraft {
  id: string;
  runId: string;
  testcaseId?: string;
  sessionId?: string;
  title: string;
  code: string;
  filePath: string;
  promptTemplateVersion: string;
  status: 'draft' | 'pending-approval';
  createdAt: string;
}

export interface CodeTaskDraft {
  id: string;
  runId: string;
  analysisId?: string;
  goal: string;
  target: 'app' | 'test';
  workspacePath: string;
  scopePaths: string[];
  constraints: string[];
  verificationCommands: string[];
  promptTemplateVersion: string;
  status: 'draft' | 'pending-approval';
  createdAt: string;
}
