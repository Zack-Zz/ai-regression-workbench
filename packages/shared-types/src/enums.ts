// Run lifecycle statuses
export type RunStatus =
  | 'CREATED'
  | 'RUNNING_TESTS'
  | 'PLANNING_EXPLORATION'
  | 'RUNNING_EXPLORATION'
  | 'COLLECTING_ARTIFACTS'
  | 'FETCHING_TRACES'
  | 'FETCHING_LOGS'
  | 'ANALYZING_FAILURES'
  | 'AWAITING_CODE_ACTION'
  | 'RUNNING_CODE_TASK'
  | 'AWAITING_REVIEW'
  | 'READY_TO_COMMIT'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED'
  | 'CANCELLED';

export const RUN_TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const RUN_ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set([
  'CREATED',
  'RUNNING_TESTS',
  'PLANNING_EXPLORATION',
  'RUNNING_EXPLORATION',
  'COLLECTING_ARTIFACTS',
  'FETCHING_TRACES',
  'FETCHING_LOGS',
  'ANALYZING_FAILURES',
  'AWAITING_CODE_ACTION',
  'RUNNING_CODE_TASK',
  'AWAITING_REVIEW',
  'READY_TO_COMMIT',
]);

// CodeTask lifecycle statuses
// NOTE: SUCCEEDED is not a terminal state — it means verify passed and the task
// is awaiting review. COMMITTED and REJECTED are the true terminal states.
export type CodeTaskStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'RUNNING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'COMMIT_PENDING'
  | 'COMMITTED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

export const CODE_TASK_TERMINAL_STATUSES: ReadonlySet<CodeTaskStatus> = new Set([
  'COMMITTED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
]);

// Run modes
export type RunMode = 'regression' | 'exploration' | 'hybrid';

// Scope types
export type RunScopeType = 'suite' | 'scenario' | 'tag' | 'testcase' | 'exploration';

// Agent session kinds
export type AgentSessionKind = 'exploration' | 'code-repair';

export type AgentSessionStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'waiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Review decisions
export type ReviewDecision = 'accept' | 'reject' | 'retry';

// Automation levels for CodeTask
export type AutomationLevel = 'headless' | 'interactive';

// CodeTask modes
export type CodeTaskMode = 'suggest' | 'apply' | 'verify';

// CodeTask targets
export type CodeTaskTarget = 'test' | 'app' | 'mixed';

// Run event types
export type RunEventType =
  | 'RUN_CREATED'
  | 'RUN_STARTED'
  | 'RUN_PAUSED'
  | 'RUN_RESUMED'
  | 'TESTCASE_PASSED'
  | 'TESTCASE_FAILED'
  | 'EXPLORATION_SESSION_STARTED'
  | 'EXPLORATION_STEP_COMPLETED'
  | 'FINDING_RECORDED'
  | 'ARTIFACT_SAVED'
  | 'CORRELATION_CONTEXT_CAPTURED'
  | 'UI_ACTION_CAPTURED'
  | 'API_CALL_CAPTURED'
  | 'FLOW_STEP_COMPLETED'
  | 'TRACE_FETCH_SUCCEEDED'
  | 'TRACE_FETCH_FAILED'
  | 'LOG_FETCH_SUCCEEDED'
  | 'LOG_FETCH_FAILED'
  | 'AI_ANALYSIS_COMPLETED'
  | 'AI_ANALYSIS_FAILED'
  | 'CODE_TASK_CREATED'
  | 'CODE_TASK_APPROVED'
  | 'CODE_TASK_REJECTED'
  | 'CODE_TASK_STARTED'
  | 'PATCH_GENERATED'
  | 'VERIFY_COMPLETED'
  | 'REVIEW_ACCEPTED'
  | 'REVIEW_REJECTED'
  | 'COMMIT_CREATED'
  | 'RUN_STEP_DEGRADED'
  | 'EXECUTION_PROFILE_UPDATED'
  | 'EXECUTION_REPORT_CREATED'
  | 'RUN_COMPLETED'
  | 'RUN_CANCELLED';

// System event types
export type SystemEventType =
  | 'SETTINGS_VALIDATED'
  | 'SETTINGS_UPDATED'
  | 'SETTINGS_APPLIED'
  | 'BOOTSTRAP_COMPLETED'
  | 'MIGRATION_APPLIED'
  | 'HARNESS_POLICY_UPDATED';

// Finding severity
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// Shared asset status
export type SharedRootStatus = 'missing' | 'available' | 'invalid';

// Commit record status
export type CommitStatus = 'pending' | 'committed' | 'failed';

// Diagnostic fetch types
export type DiagnosticFetchType = 'trace' | 'log';

// Diagnostic fetch status
export type DiagnosticFetchStatus = 'pending' | 'succeeded' | 'failed' | 'degraded';

// UI action types
export type UiActionType = 'click' | 'input' | 'select' | 'assert' | 'wait' | 'other';

// Execution stage result status
export type StageResultStatus = 'success' | 'degraded' | 'failed' | 'skipped';
