# 应用服务与访问方式设计

## 1. 目标

定义 `zarb` CLI、Web UI 和本地服务之间的职责边界，确保当前“所有业务操作和查看统一在 HTML 页面”实现简单，同时为未来 CLI 增强和平台化演进预留空间。

配套文档：

- [HTTP API 契约设计](./api-contract-design.md)

## 2. 总体原则

- CLI 和 Web UI 不直接承载核心业务逻辑
- 核心业务逻辑统一沉到应用服务层
- 当前业务动作统一由 Web UI 通过 API 发起
- CLI 当前仅承担 bootstrap/init/doctor/start-ui，不承载业务操作流
- Web UI 通过 localhost HTTP API 调用本地应用服务
- 长流程动作用状态机推进，不在单次请求中等待全流程完成

## 3. 三层边界

### 3.1 CLI

定位：

- 本地工具入口
- 初始化与诊断入口
- 本地 HTML 工作台启动入口
- 未来脚本化扩展入口（预留）

适合的动作：

- `zarb`
- `zarb init`
- `zarb doctor`
- `zarb ui`

### 3.2 Web UI

定位：

- 默认工作台
- 当前唯一业务操作与查看入口
- 报告查看入口
- diagnostics、review、commit 的主可视化入口

适合的动作：

- 发起日常运行
- 查看失败报告
- 查看 diagnostics
- 审批 CodeTask
- review / commit
- 编辑个人配置并即时生效

### 3.3 Local App Process

定位：

- 本地应用服务宿主进程
- 本地 API 服务
- UI 静态资源服务

内部承载：

- 应用服务层
- orchestrator
- repository
- event store
- provider adapters

## 4. 应用服务列表

### 4.1 BootstrapService

负责：

- 初始化工具目录
- 初始化配置
- 初始化 SQLite
- 启动本地 app process
- 打开 UI

### 4.2 WorkspaceService

负责：

- 读取和更新 `target workspace`
- 解析 `sharedRoot`
- 返回 workspace 状态

### 4.3 RunService

负责：

- 创建 run
- 查询 run 列表和详情
- 查询 run 执行报告
- pause / resume / cancel
- 查询事件时间线

### 4.4 DiagnosticsService

负责：

- 获取 failure report
- 获取 diagnostics 明细
- 获取 testcase 执行明细（流程/点击/接口）
- 获取 trace / logs / analysis
- 重新触发 analysis

### 4.5 CodeTaskService

负责：

- 查询 code tasks
- approve / reject / execute / retry / cancel
- 获取 code task detail

### 4.6 ReviewService

负责：

- 查询 review 状态
- 提交 review 决策

### 4.7 CommitService

负责：

- 查询 commit 状态
- 创建 commit record
- 触发实际 commit

### 4.8 SettingsService

负责：

- 读取当前个人配置快照
- 校验配置 patch 是否可应用
- 保存配置到 `config.local.yaml`
- 将配置变更即时应用到运行时模块

## 5. 方法清单

### 5.1 BootstrapService

```ts
interface BootstrapService {
  bootstrap(): Promise<BootstrapResult>;
  init(config?: InitRequest): Promise<InitResult>;
  doctor(): Promise<DoctorResult>;
  startUi(): Promise<UiLaunchResult>;
}
```

### 5.2 WorkspaceService

```ts
interface WorkspaceService {
  getWorkspace(): Promise<WorkspaceSummary>;
  updateWorkspace(input: UpdateWorkspaceInput): Promise<WorkspaceSummary>;
  resolveSharedAssets(): Promise<SharedAssetsStatus>;
}
```

### 5.3 RunService

```ts
interface RunService {
  startRun(input: StartRunInput): Promise<StartRunResult>;
  listRuns(query?: ListRunsQuery): Promise<RunSummaryPage>;
  getRun(runId: string): Promise<RunDetail>;
  getExecutionReport(runId: string): Promise<ExecutionReport | null>;
  getRunEvents(runId: string, query?: RunEventsQuery): Promise<RunEventPage>;
  pauseRun(runId: string): Promise<ActionResult>;
  resumeRun(runId: string): Promise<ActionResult>;
  cancelRun(runId: string): Promise<ActionResult>;
}
```

### 5.4 DiagnosticsService

```ts
interface DiagnosticsService {
  listFailureReports(runId: string): Promise<FailureReportSummary[]>;
  getFailureReport(runId: string, testcaseId: string): Promise<FailureReport>;
  getExecutionProfile(runId: string, testcaseId: string): Promise<TestcaseExecutionProfile | null>;
  getDiagnostics(runId: string, testcaseId: string): Promise<DiagnosticsDetail>;
  getTrace(runId: string, testcaseId: string): Promise<TraceDetail | null>;
  getLogs(runId: string, testcaseId: string): Promise<LogDetail | null>;
  getAnalysis(runId: string, testcaseId: string): Promise<AnalysisDetail | null>;
  retryAnalysis(runId: string, testcaseId: string): Promise<ActionResult>;
}
```

### 5.5 CodeTaskService

```ts
interface CodeTaskService {
  listCodeTasks(query?: ListCodeTasksQuery): Promise<CodeTaskSummaryPage>;
  getCodeTask(taskId: string): Promise<CodeTaskDetail>;
  approveCodeTask(taskId: string): Promise<ActionResult>;
  rejectCodeTask(taskId: string): Promise<ActionResult>;
  executeCodeTask(taskId: string): Promise<ActionResult>;
  retryCodeTask(taskId: string): Promise<ActionResult>;
  cancelCodeTask(taskId: string): Promise<ActionResult>;
}
```

### 5.6 ReviewService

```ts
interface ReviewService {
  getReview(taskId: string): Promise<ReviewDetail | null>;
  submitReview(input: SubmitReviewInput): Promise<ActionResult>;
}
```

### 5.7 CommitService

```ts
interface CommitService {
  getCommit(taskId: string): Promise<CommitDetail | null>;
  createCommit(input: CreateCommitInput): Promise<ActionResult>;
}
```

### 5.8 SettingsService

```ts
interface SettingsService {
  getSettings(): Promise<SettingsSnapshot>;
  validateSettings(input: UpdateSettingsInput): Promise<SettingsValidationResult>;
  updateSettings(input: UpdateSettingsInput): Promise<SettingsApplyResult>;
}
```

## 6. DTO 设计原则

- Summary 和 Detail 分层
- DTO 面向使用场景设计，不直接暴露数据库结构
- 所有动作接口统一返回 `ActionResult`

## 7. 关键 DTO

### 7.1 WorkspaceSummary

```ts
interface WorkspaceSummary {
  targetWorkspacePath: string | null;
  targetGitRoot: string | null;
  sharedRootConfigured: boolean;
  sharedRootResolvedPath: string | null;
  sharedRootStatus: 'missing' | 'available' | 'invalid';
  codexAvailable: boolean;
  kiroAvailable: boolean;
  playwrightAvailable: boolean;
}
```

### 7.1.1 SettingsSnapshot

```ts
interface PersonalSettings {
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
    defaultMode?: 'regression' | 'exploration' | 'hybrid';
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

interface SettingsSnapshot {
  version: number;
  sourcePath: string;
  updatedAt: string;
  values: PersonalSettings;
}

interface UpdateSettingsInput {
  patch: Partial<PersonalSettings>;
  expectedVersion?: number;
}

interface SettingsValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

interface SettingsApplyResult extends ActionResult {
  version?: number;
  reloadedModules?: string[];
  nextRunOnlyKeys?: string[];
  requiresRestart?: boolean;
}
```

说明：

- `exploration` 在本地配置中可省略；系统必须先与 `config.default.yaml` 合并后再对外暴露 `SettingsSnapshot`
- 当用户未显式配置时，默认值来自默认配置中的 `exploration.maxSteps / maxPages / allowedHosts / defaultFocusAreas`

### 7.2 RunSummary

```ts
interface RunSummary {
  runId: string;
  runMode: 'regression' | 'exploration' | 'hybrid';
  status: string;
  scopeType?: 'suite' | 'scenario' | 'tag' | 'testcase' | 'exploration';
  scopeValue?: string;
  startedAt: string;
  endedAt?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  currentStage?: string;
}
```

### 7.2.1 StartRunInput

```ts
type RunMode = 'regression' | 'exploration' | 'hybrid';
type RunScopeType = 'suite' | 'scenario' | 'tag' | 'testcase' | 'exploration';

interface RunSelector {
  suite?: string;
  scenarioId?: string;
  tag?: string;
  testcaseId?: string;
}

interface StartRunInput {
  runMode: RunMode;
  selector?: RunSelector;
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
```

约束：

- `regression` 模式要求 `selector` 四个字段必须且只能有一个有效值
- `exploration` 模式必须提供 `exploration`
- `hybrid` 模式要求 `selector + exploration`
- 若入参不满足约束，返回 `StartRunResult.success=false`，不启动 run

### 7.2.2 StartRunResult

```ts
interface StartRunResult extends ActionResult {
  run?: RunSummary;
}
```

### 7.3 RunDetail

```ts
interface RunDetail {
  summary: RunSummary;
  testResults: TestResultSummary[];
  findings?: Array<{
    id: string;
    severity: string;
    category: string;
    pageUrl?: string;
    summary: string;
  }>;
  selectedFailure?: FailureSnapshot;
  diagnosticsSummary?: DiagnosticsSummary;
  analysisSummary?: AnalysisSummary;
  events: RunEventItem[];
}
```

说明：

- 第一阶段 findings 直接内嵌在 `RunDetail`
- 若后续 findings 规模变大，可再拆出独立 `GET /runs/:runId/findings`

### 7.3.0 RunEventItem / RunEventsQuery

```ts
interface ListRunsQuery {
  cursor?: string;
  limit?: number;
  status?: string;
  runMode?: RunMode;
}

interface RunSummaryPage {
  items: RunSummary[];
  nextCursor?: string;
}

interface RunEventItem {
  eventId: string;
  runId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  payloadSchemaVersion?: string;
  createdAt: string;
}

interface RunEventsQuery {
  cursor?: string;
  limit?: number;
}

interface RunEventPage {
  items: RunEventItem[];
  nextCursor?: string;
}
```

### 7.3.1 ExecutionReport

```ts
interface ExecutionStageResult {
  stage: string;
  status: 'success' | 'degraded' | 'failed' | 'skipped';
  message?: string;
}

interface ExecutionReport {
  runId: string;
  status: string;
  runMode: RunMode;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  scopeType?: RunScopeType;
  scopeValue?: string;
  selector?: RunSelector;
  exploration?: StartRunInput['exploration'];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  totals: {
    flowStepCount: number;
    uiActionCount: number;
    apiCallCount: number;
    failedApiCount: number;
  };
  stageResults: ExecutionStageResult[];
  degradedSteps: string[];
  fatalReason?: string;
  failureReports: Array<{
    testcaseId: string;
    errorMessage?: string;
    reportPath?: string;
  }>;
  codeTaskSummaries: Array<{
    taskId: string;
    testcaseId?: string;
    status: string;
    updatedAt: string;
  }>;
  flowSummaries: Array<{
    flowId: string;
    stepCount: number;
    uiActionCount: number;
    apiCallCount: number;
    failedApiCount: number;
    durationMs?: number;
  }>;
  testcaseProfiles: Array<{
    testcaseId: string;
    profilePath: string;
  }>;
  artifactLinks: string[];
  warnings?: string[];
  recommendations?: string[];
}
```

### 7.3.2 TestcaseExecutionProfile

```ts
interface ApiCallItem {
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

interface UiActionItem {
  id: string;
  flowStepId?: string;
  actionType: 'click' | 'input' | 'select' | 'assert' | 'wait' | 'other';
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

interface FlowStepItem {
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

interface TestcaseExecutionProfile {
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  summary: {
    flowStepCount: number;
    uiActionCount: number;
    apiCallCount: number;
    failedApiCount: number;
  };
  flowSteps: FlowStepItem[];
  uiActions: UiActionItem[];
  apiCalls: ApiCallItem[];
}
```

### 7.4 FailureReportSummary

```ts
interface FailureReportSummary {
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  testcaseName: string;
  errorType?: string;
  errorMessage?: string;
  analysisStatus?: string;
  codeTaskStatus?: string;
}
```

### 7.5 FailureReport

```ts
interface FailureReport {
  runId: string;
  testcaseId: string;
  scenarioId?: string;
  testcaseName: string;
  errorType?: string;
  errorMessage?: string;
  artifacts: ArtifactRefs;
  correlationContext: CorrelationContext;
  traceSummary?: TraceDetail | null;
  logSummary?: LogDetail | null;
  analysis?: AnalysisDetail | null;
}
```

### 7.6 CodeTaskSummary

```ts
interface CodeTaskSummary {
  taskId: string;
  parentTaskId?: string;
  taskVersion: number;
  runId: string;
  testcaseId?: string;
  status: string;
  agentName?: string;
  automationLevel: 'headless' | 'interactive';
  workspacePath: string;
  goal: string;
  verifyPassed?: boolean;
  updatedAt: string;
}
```

说明：

- `taskVersion` 是 API/DTO 语义，对应持久层中的 `code_tasks.attempt`
- `ReviewRecord.codeTaskVersion` 与 `SubmitReviewInput.codeTaskVersion` 必须引用同一轮 attempt

### 7.7 CodeTaskDetail

```ts
interface CodeTaskDetail {
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
```

```ts
interface ListCodeTasksQuery {
  cursor?: string;
  limit?: number;
  status?: string;
  runId?: string;
}

interface CodeTaskSummaryPage {
  items: CodeTaskSummary[];
  nextCursor?: string;
}
```

### 7.7.1 ReviewRecord / CommitDetail

```ts
interface ReviewRecord {
  reviewId: string;
  taskId: string;
  decision: 'accept' | 'reject' | 'retry';
  comment?: string;
  diffHash?: string;
  patchHash?: string;
  codeTaskVersion: number;
  createdAt: string;
}

interface CommitDetail {
  commitRecordId: string;
  taskId: string;
  branchName?: string;
  commitSha?: string;
  commitMessage?: string;
  status: 'pending' | 'committed' | 'failed';
  errorMessage?: string;
  createdAt: string;
}

interface SubmitReviewInput {
  taskId: string;
  decision: 'accept' | 'reject' | 'retry';
  comment?: string;
  diffHash?: string;
  patchHash?: string;
  codeTaskVersion: number;
  forceReviewOnVerifyFailure?: boolean;
}

interface CreateCommitInput {
  taskId: string;
  commitMessage: string;
  expectedTaskVersion?: number;
}
```

说明：

- `forceReviewOnVerifyFailure=true` 仅用于 verify 失败后的受控 override review；它不是第四种 `decision`
- 当使用该字段时，`decision` 必须仍为 `accept`

### 7.8 ActionResult

```ts
interface ActionResult {
  success: boolean;
  message: string;
  errorCode?: string;
  warnings?: string[];
  nextSuggestedAction?: string;
  retryable?: boolean;
}
```

## 8. 同步与异步动作

### 8.1 适合同步返回

- `bootstrap`
- `doctor`
- `startUi`
- `getWorkspace`
- `updateWorkspace`
- `resolveSharedAssets`
- `listRuns`
- `getRun`
- `getExecutionReport`
- `getRunEvents`
- `listFailureReports`
- `getFailureReport`
- `getExecutionProfile`
- `getDiagnostics`
- `getTrace`
- `getLogs`
- `getAnalysis`
- `listCodeTasks`
- `getCodeTask`
- `getReview`
- `getCommit`
- `getSettings`
- `validateSettings`
- `updateSettings`

### 8.2 适合触发后返回

- `init`
- `startRun`
- `pauseRun`
- `resumeRun`
- `cancelRun`
- `retryAnalysis`
- `approveCodeTask`
- `rejectCodeTask`
- `executeCodeTask`
- `retryCodeTask`
- `cancelCodeTask`
- `submitReview`
- `createCommit`

这些动作应立即返回，并由状态机继续推进后续流程。

## 9. CLI / UI / API 映射原则

- Web UI 通过 localhost API 调应用服务，并承载当前全部业务操作和查看
- CLI 当前仅调用 `BootstrapService` 相关能力（`bootstrap/init/doctor/startUi`）
- 业务服务语义保持统一，未来 CLI 扩展时复用同一套应用服务
- API 按业务对象组织，不按底层模块组织
- `updateSettings` 成功后必须在同一请求生命周期内完成保存和运行时生效
- `report.port` 变更通过 `nextRunOnlyKeys` 提示“下次启动生效”，第一阶段不返回 `redirectUrl`
- 第一阶段事件刷新以轮询为主，SSE 不作为默认前提
