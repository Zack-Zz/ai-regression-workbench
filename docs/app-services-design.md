# 应用服务与访问方式设计

## 1. 目标

定义 `zarb` CLI、Web UI 和本地服务之间的职责边界，确保当前实现简单，同时为未来 CLI 增强和平台化演进预留空间。

## 2. 总体原则

- CLI 和 Web UI 不直接承载核心业务逻辑
- 核心业务逻辑统一沉到应用服务层
- CLI 直接调用本地应用服务
- Web UI 通过 localhost HTTP API 调用本地应用服务
- 长流程动作用状态机推进，不在单次请求中等待全流程完成

## 3. 三层边界

### 3.1 CLI

定位：

- 本地工具入口
- 初始化与诊断入口
- 高级控制面
- 脚本化和自动化入口

适合的动作：

- `zarb`
- `zarb init`
- `zarb doctor`
- `zarb run ...`
- `zarb workspace ...`

### 3.2 Web UI

定位：

- 默认工作台
- 报告查看入口
- diagnostics、review、commit 的主可视化入口

适合的动作：

- 发起日常运行
- 查看失败报告
- 查看 diagnostics
- 审批 CodeTask
- review / commit

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
- pause / resume / cancel
- 查询事件时间线

### 4.4 DiagnosticsService

负责：

- 获取 failure report
- 获取 diagnostics 明细
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
  startRun(input: StartRunInput): Promise<RunSummary>;
  listRuns(query?: ListRunsQuery): Promise<RunSummary[]>;
  getRun(runId: string): Promise<RunDetail>;
  getRunEvents(runId: string): Promise<RunEventItem[]>;
  pauseRun(runId: string): Promise<ActionResult>;
  resumeRun(runId: string): Promise<ActionResult>;
  cancelRun(runId: string): Promise<ActionResult>;
}
```

### 5.4 DiagnosticsService

```ts
interface DiagnosticsService {
  getFailureReport(runId: string, testcaseId: string): Promise<FailureReport>;
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
  listCodeTasks(query?: ListCodeTasksQuery): Promise<CodeTaskSummary[]>;
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

### 7.2 RunSummary

```ts
interface RunSummary {
  runId: string;
  status: string;
  scopeType: 'suite' | 'scenario' | 'tag' | 'testcase';
  scopeValue: string;
  startedAt: string;
  endedAt?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  currentStage?: string;
}
```

### 7.3 RunDetail

```ts
interface RunDetail {
  summary: RunSummary;
  testResults: TestResultSummary[];
  selectedFailure?: FailureSnapshot;
  diagnosticsSummary?: DiagnosticsSummary;
  analysisSummary?: AnalysisSummary;
  events: RunEventItem[];
}
```

### 7.4 FailureReport

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

### 7.5 CodeTaskSummary

```ts
interface CodeTaskSummary {
  taskId: string;
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

### 7.6 CodeTaskDetail

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

### 7.7 ActionResult

```ts
interface ActionResult {
  success: boolean;
  message: string;
  warnings?: string[];
  nextSuggestedAction?: string;
}
```

## 8. 同步与异步动作

### 8.1 适合同步返回

- `getWorkspace`
- `updateWorkspace`
- `listRuns`
- `getRun`
- `getCodeTask`
- `getReview`
- `getCommit`

### 8.2 适合触发后返回

- `startRun`
- `retryAnalysis`
- `executeCodeTask`
- `createCommit`

这些动作应立即返回，并由状态机继续推进后续流程。

## 9. CLI / UI / API 映射原则

- CLI 直接调用应用服务
- Web UI 通过 localhost API 调应用服务
- CLI 和 UI 共享同一套服务语义
- API 按业务对象组织，不按底层模块组织
