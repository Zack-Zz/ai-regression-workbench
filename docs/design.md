# AI 自动化回归与受控修复工作台设计文档

## 1. 文档信息

- 文档名称：AI 自动化回归与受控修复工作台设计文档
- 文档版本：v2.1
- 目标形态：本地单体部署、模块化代码结构、可中断流程、可观测、可审批、平台化可演进
- 主要用途：作为项目初始化与第一阶段实施的直接输入

### 1.1 文档导航

总设计文档负责描述项目全貌，模块级细节拆分到以下文档：

- [Orchestrator 详细设计](./orchestrator-design.md)
- [Diagnostics 详细设计](./diagnostics-design.md)
- [AI Engine 详细设计](./ai-engine-design.md)
- [CodeTask 与 Review 详细设计](./code-task-design.md)
- [Local UI 详细设计](./local-ui-design.md)
- [本地工具打包与分发设计](./packaging-design.md)
- [Test Assets 详细设计](./test-assets-design.md)
- [外部观测集成设计](./observability-design.md)
- [应用服务与访问方式设计](./app-services-design.md)

外部参考文档：

- [OpenAI Codex CLI 官方文档](https://developers.openai.com/codex/cli)
- [Kiro CLI 官方文档](https://kiro.dev/docs/cli/)

---

## 2. 项目定位

### 2.1 背景

当前希望基于 Playwright 构建一个本地可运行的 AI 自动化测试工作台，用于本地环境或开发环境下的回归测试，并在失败后进入受控修复流程。

系统需要能够：

1. 执行已有 Playwright 测试集。
2. 采集执行产物并提取诊断关联键。
3. 联动 trace 与日志系统辅助定位后端问题。
4. 使用 AI 对失败进行归因分析。
5. 面向用户配置的目标项目目录执行测试和代码修改。
6. 生成并执行受控代码修复任务。
7. 支持人工 review、人工确认提交。
8. 整个流程可暂停、可恢复、可取消、可审计。

### 2.2 本阶段目标

本阶段要交付的不是“纯测试工作台”，也不是“全自动自愈平台”，而是一个：

- 本地单机可运行
- 可稳定执行回归测试
- 可产出可追踪失败报告
- 可关联 trace 和日志定位问题
- 可面向指定本地项目目录工作
- 可生成并执行受控代码修复任务
- 可让用户在关键节点审批、review、提交
- 可逐步升级为平台化系统的骨架

### 2.3 非目标

当前阶段不做以下内容：

- 多租户能力
- 在线 SaaS 化
- 分布式调度
- 无人工 review 的自动提交主分支
- 复杂多 agent 编排系统
- 自动上线与发布审批流

---

## 3. 核心设计原则

### 3.1 Local-First

第一阶段优先本地运行体验，单机即可启动、执行、调试、review 和提交。

### 3.2 Human-in-the-Loop

分析可以自动推进，代码修改和提交必须受控，关键节点必须允许用户介入。

### 3.3 Interruptible by Design

流程必须支持暂停、恢复、取消、重试，且不能依赖进程内状态。

### 3.4 Observable by Default

所有关键步骤都要落事件、落状态、落产物，CLI 与 UI 基于同一套状态与事件展示。

### 3.5 Platform-Ready

虽然当前是本地单体，但模块边界和接口抽象要为未来服务化拆分预留空间。

### 3.6 Asset and Audit First

测试资产、执行结果、AI 建议、代码修改记录、review 记录、commit 记录都必须持久化，可追溯。

### 3.7 Diagnostics First

trace、日志、network、screenshot、verify 输出应被视为一等诊断输入，而不是附属产物。

---

## 4. 最小完整闭环

本项目优先打通的最小完整闭环为：

```text
Playwright 执行
  -> artifacts 落地
  -> 诊断关联键提取
  -> trace 查询
  -> 日志查询
  -> AI 失败分析
  -> 报告展示
  -> 生成 CodeTask
  -> 用户审批
  -> 代码修改器执行
  -> verify
  -> 人工 review
  -> 人工确认提交
```

约束：

- `AI 分析` 可自动执行。
- `CodeTask 执行` 默认停在待审批状态。
- `Commit` 必须是独立动作，不与 review 自动绑定。

---

## 5. 系统总体架构

### 5.1 架构概览

本地版本整体采用“单体进程 + 模块化分层 + 持久化状态机”的结构。

核心模块包括：

1. CLI：命令入口与控制面
2. Orchestrator：状态推进与任务编排
3. Test Runner：Playwright 执行器
4. Trace Bridge：链路查询桥接
5. Log Bridge：日志查询桥接
6. AI Engine：失败分析与修复任务生成
7. Code Agent Adapter：受控代码修改执行层
8. Review Manager：review 与提交控制
9. Local Report UI：本地可视化界面
10. Storage：SQLite 与本地文件存储
11. Event Store：事件记录与时间线能力

模块细节跳转：

- 状态推进与中断恢复见 [orchestrator-design.md](./orchestrator-design.md)
- trace / 日志 / 关联键见 [diagnostics-design.md](./diagnostics-design.md)
- AI 分析与 CodeTask draft 见 [ai-engine-design.md](./ai-engine-design.md)
- CodeTask / review / commit 见 [code-task-design.md](./code-task-design.md)
- 本地前端控制台见 [local-ui-design.md](./local-ui-design.md)
- 本地工具交付形态见 [packaging-design.md](./packaging-design.md)
- 测试资产与共享目录见 [test-assets-design.md](./test-assets-design.md)
- 外部观测旁路集成见 [observability-design.md](./observability-design.md)
- 应用服务边界见 [app-services-design.md](./app-services-design.md)

### 5.2 高层执行链路

```text
CLI / UI 发起 Run
  ->
Orchestrator 创建 Run
  ->
Test Runner 执行 Playwright
  ->
保存 artifacts / network / correlation context
  ->
Trace Bridge 查询 TraceSummary
  ->
Log Bridge 查询 LogSummary
  ->
AI Engine 生成 FailureAnalysis
  ->
创建 CodeTask（默认 PENDING_APPROVAL）
  ->
用户决定 approve / reject / skip / cancel
  ->
Code Agent 执行修改与 verify
  ->
用户 review diff / patch / verify 输出
  ->
用户决定 accept / reject / retry
  ->
用户决定是否提交
```

### 5.3 架构分层

```text
+---------------------------------------------------------------+
| CLI / Local UI                                                |
+---------------------------------------------------------------+
| Orchestrator / Review Manager / Event Store                   |
+---------------------------------------------------------------+
| Test Runner | Trace Bridge | Log Bridge | AI Engine           |
+---------------------------------------------------------------+
| Code Agent Adapter | Config | Storage | Shared Types          |
+---------------------------------------------------------------+
| Playwright | Trace API | Log API | SQLite | Local File System |
+---------------------------------------------------------------+
```

### 5.4 设计架构说明

- CLI 与 UI 只调用控制层，不直接耦合底层实现。
- Orchestrator 负责状态机推进，不承载 provider 细节。
- 诊断层由 `Test Runner + Trace Bridge + Log Bridge` 共同组成。
- AI Engine 只消费诊断上下文并输出分析与修复任务，不直接管理执行器。
- Code Agent Adapter 负责落盘 diff、patch、verify 输出。
- Event Store 贯穿全链路，是可观测性与恢复能力的基础。
- 外部观测工具只允许旁路接入，不作为主流程依赖。

当前访问方式约束：

- CLI 作为本地工具入口和高级控制面
- Web UI 作为默认工作台和主可视化入口
- Local App Process 作为本地应用服务宿主
- CLI 直接调用应用服务
- Web UI 通过 localhost API 调用应用服务

### 5.5 部署形态

本阶段部署形态：

- 单仓库
- 本地 Node.js 进程
- 本地 SQLite
- 本地文件存储
- 本地 UI

未来平台化演进方向：

- Orchestrator 拆分为调度服务
- Runner 拆为独立 worker
- Trace / Log Bridge 拆为集成服务
- Code Agent 执行器拆为隔离 worker
- SQLite 替换为 PostgreSQL
- 本地文件替换为对象存储
- Local UI 升级为平台 Web Console

---

## 6. 项目结构设计

### 6.1 建议仓库结构

```text
ai-regression-workbench/
  apps/
    cli/
      src/
    orchestrator/
      src/
    test-runner/
      src/
    trace-bridge/
      src/
    log-bridge/
      src/
    ai-engine/
      src/
    review-manager/
      src/
    local-ui/
      src/
  packages/
    shared-types/
      src/
    shared-utils/
      src/
    config/
      src/
    storage/
      src/
    event-store/
      src/
    logger/
      src/
    test-assets/
      tests/
      pages/
      fixtures/
      data/
      helpers/
  data/
    sqlite/
    runs/
    artifacts/
    diagnostics/
    analysis/
    code-tasks/
    commits/
  docs/
  scripts/
  package.json
  pnpm-workspace.yaml
  playwright.config.ts
  tsconfig.base.json
```

### 6.2 目录职责

- `apps/cli`
  命令入口、终端输出、watch、控制动作。

- `apps/orchestrator`
  状态推进、任务调度、暂停恢复、统一错误处理。
  详见 [orchestrator-design.md](./orchestrator-design.md)

- `apps/test-runner`
  Playwright 执行、network capture、correlation context 提取。

- `apps/trace-bridge`
  Trace provider 适配和 `TraceSummary` 归一化。

- `apps/log-bridge`
  Log provider 适配和 `LogSummary` 归一化。
  详见 [diagnostics-design.md](./diagnostics-design.md)

- `apps/ai-engine`
  `FailureAnalysis`、`CodeTask` draft、agent 路由策略。
  详见 [ai-engine-design.md](./ai-engine-design.md)

- `apps/review-manager`
  Review、commit、审计记录。
  详见 [code-task-design.md](./code-task-design.md)

- `apps/local-ui`
  Run、diagnostics、code task、review 视图。
  详见 [local-ui-design.md](./local-ui-design.md)

- `packages/shared-types`
  DTO、状态枚举、接口定义。

- `packages/config`
  YAML + env 配置加载、默认值、校验。

- `packages/storage`
  SQLite repository、本地 artifact store。

- `packages/event-store`
  事件写入、查询、时间线聚合。

- `packages/logger`
  Pino 等结构化日志封装。

- `packages/test-assets`
  测试资产、page object、fixtures、测试数据。
  详见 [test-assets-design.md](./test-assets-design.md)

### 6.3 模块依赖约束

- `apps/*` 可以依赖 `packages/*`。
- `packages/*` 不依赖 `apps/*`。
- `apps/orchestrator` 不直接依赖具体 provider 的实现细节，只依赖接口。
- `apps/local-ui` 不直连 SQLite，统一通过 API 或读取统一 repository 接口。

### 6.4 目标项目目录约束

系统自身仓库与被测试、被修改的目标项目目录不一定相同。

因此必须引入可配置的目标工作区概念：

- `tool workspace`
  `ai-regression-workbench` 自身运行和存储数据的目录。

- `target workspace`
  被测试、被分析、被 code agent 修改的业务工程目录。

设计要求：

- 所有 Playwright 执行、代码搜索、代码修改、git 操作都必须基于 `target workspace`
- 所有运行数据、diagnostics、analysis、code-task 产物默认保存在 `tool workspace` 下
- UI 必须能展示当前生效的 `target workspace`
- CLI 必须允许用户显式指定或覆盖 `target workspace`

---

## 7. 核心领域模型

本项目的主轴不再只有 `TestRun`，而是以下核心对象。

### 7.1 Run

表示一次测试执行任务。

职责：

- 记录执行入口和范围
- 维护整体状态
- 关联 test results、diagnostics、analysis、code tasks、events

### 7.2 TestResult

表示某个 testcase 在某次 run 中的执行结果。

职责：

- 记录原始失败信息
- 关联 artifacts 与 diagnostics

### 7.3 CorrelationContext

表示从网络响应和执行上下文中提取的诊断关联键。

职责：

- 为 trace 查询与日志查询提供统一输入

### 7.4 FailureAnalysis

表示一次针对失败 testcase 的 AI 归因分析。

职责：

- 对失败原因进行结构化归类
- 产出修复建议
- 为后续 CodeTask 提供输入

说明：

- `FailureAnalysis` 只负责建议，不直接改代码。

### 7.5 CodeTask

表示一次受控代码修改任务。

职责：

- 定义目标、范围、约束、执行 agent
- 承载修改产物与验证结果
- 作为 review 和 commit 的基础对象

### 7.6 Review

表示一次人工审查动作。

职责：

- 审查 diff / patch / verify 输出
- 决定接受、驳回、重试或仅保留结果

### 7.7 CommitRecord

表示一次提交动作。

职责：

- 记录 branch、commit sha、message
- 记录是否已正式提交

### 7.8 RunEvent

表示状态推进中的一个事件。

职责：

- 为 UI/CLI 提供时间线
- 为恢复与排错提供依据

---

## 8. 状态机设计

### 8.1 RunStatus

```text
CREATED
-> RUNNING_TESTS
-> COLLECTING_ARTIFACTS
-> FETCHING_TRACES
-> FETCHING_LOGS
-> ANALYZING_FAILURES
-> AWAITING_CODE_ACTION
-> RUNNING_CODE_TASK
-> AWAITING_REVIEW
-> READY_TO_COMMIT
-> COMPLETED
```

异常状态：

- `FAILED`
- `CANCELLED`

说明：

- 没有失败用例时，`ANALYZING_FAILURES` 后可直接进入 `COMPLETED`。
- 若用户选择只分析不修复，则 `AWAITING_CODE_ACTION` 后可直接进入 `COMPLETED`。
- trace/log 查询失败不应直接导致 run 失败，应记录降级事件并继续。

### 8.2 CodeTaskStatus

```text
DRAFT
-> PENDING_APPROVAL
-> APPROVED
-> RUNNING
-> VERIFYING
-> SUCCEEDED
-> COMMIT_PENDING
-> COMMITTED
```

异常状态：

- `FAILED`
- `REJECTED`
- `CANCELLED`

### 8.3 控制动作

系统必须支持以下控制动作：

- `pause`：当前步骤结束后暂停，不进入下一步
- `resume`：从最近稳定状态继续
- `cancel`：取消尚未执行的后续流程
- `retry-analysis`：基于原始失败证据重新分析
- `retry-code-task`：重新生成或重新执行修复任务
- `reject`：否决某个 CodeTask
- `approve`：批准某个 CodeTask 可以执行

### 8.4 设计要求

- 状态推进必须持久化，不依赖单个进程内存。
- 每一步推进都必须记录事件。
- 所有可中断节点都必须可恢复。

---

## 9. 可观测性与事件流

### 9.1 设计目标

系统的可观测性依赖以下三层：

1. 结构化运行日志
2. 持久化状态
3. 统一事件流

CLI 与 UI 都应基于状态表与事件表展示实时进度。

### 9.2 事件模型

建议定义统一事件：

- `RUN_CREATED`
- `RUN_STARTED`
- `TESTCASE_PASSED`
- `TESTCASE_FAILED`
- `ARTIFACT_SAVED`
- `CORRELATION_CONTEXT_CAPTURED`
- `TRACE_FETCH_SUCCEEDED`
- `TRACE_FETCH_FAILED`
- `LOG_FETCH_SUCCEEDED`
- `LOG_FETCH_FAILED`
- `AI_ANALYSIS_COMPLETED`
- `AI_ANALYSIS_FAILED`
- `CODE_TASK_CREATED`
- `CODE_TASK_APPROVED`
- `CODE_TASK_REJECTED`
- `CODE_TASK_STARTED`
- `PATCH_GENERATED`
- `VERIFY_COMPLETED`
- `REVIEW_ACCEPTED`
- `REVIEW_REJECTED`
- `COMMIT_CREATED`
- `RUN_COMPLETED`
- `RUN_CANCELLED`

### 9.3 Event Store

建议新增统一事件表，支持：

- 时间线展示
- CLI watch
- 调试与审计
- 恢复执行

### 9.4 结构化日志要求

关键阶段必须打印结构化日志：

- run 创建
- runner 开始/结束
- testcase 失败
- correlation context 提取结果
- trace 查询结果
- 日志查询结果
- AI 分析结果
- code task 审批/执行/验证
- review / commit 决策

---

## 10. 模块设计

### 10.1 CLI

职责：

- 提供用户控制面
- 发起 run / diagnostics / review / commit 等动作
- 支持 watch、pause、resume、cancel

### 10.2 Orchestrator

职责：

- 维护 Run 与 CodeTask 状态机
- 驱动模块协作
- 执行自动推进
- 在待审批节点停下

要求：

- 不直接依赖 Playwright 细节
- 不直接写死某个 code agent CLI

### 10.3 Test Runner

职责：

- 执行 Playwright 测试
- 输出 trace、screenshot、video、network log
- 提取诊断关联键

支持粒度：

- suite
- scenario
- tag
- testcase

### 10.4 Trace Bridge

职责：

- 根据 traceId 查询后端追踪系统
- 将原始结果转成统一 `TraceSummary`

### 10.5 Log Bridge

职责：

- 根据诊断关联键与时间窗口查询日志系统
- 将结果归一化为 `LogSummary`

### 10.6 AI Engine

职责：

- 失败归因分析
- 生成修复建议
- 生成 CodeTask 草稿

说明：

- AI 输出默认只到 `CodeTask:DRAFT` 或 `PENDING_APPROVAL`

### 10.7 Code Agent Adapter

职责：

- 调用 Codex CLI / Kiro CLI 等 agent
- 执行受控范围内的代码修改
- 落地 raw output / diff / patch / verify 输出

执行模型：

- `CodexCliAgent`
  作为 `headless automation agent` 使用，适合自动编排执行

- `KiroCliAgent`
  作为 `interactive assisted agent` 使用，适合用户接管的交互式修复会话

参考：

- [OpenAI Codex CLI 官方文档](https://developers.openai.com/codex/cli)
- [Kiro CLI 官方文档](https://kiro.dev/docs/cli/)

### 10.8 Review Manager

职责：

- 记录人工 review 决策
- 控制是否允许进入提交阶段

### 10.9 Local Report UI

职责：

- 展示 run 列表与详情
- 展示 testcase、diagnostics、analysis、code task
- 展示事件时间线
- 提供 approve、execute、review、commit 控制入口

---

## 11. 核心接口抽象

### 11.1 TestRunner

```ts
export interface TestRunner {
  run(request: RunRequest): Promise<RunResult>;
}
```

### 11.2 CorrelationContext

```ts
export interface CorrelationContext {
  traceIds: string[];
  requestIds: string[];
  sessionIds: string[];
  serviceHints?: string[];
  fromTime?: string;
  toTime?: string;
}
```

### 11.3 TraceProvider

```ts
export interface TraceProvider {
  getTrace(traceId: string): Promise<TraceSummary | null>;
}
```

### 11.4 LogProvider

```ts
export interface LogQuery {
  traceIds?: string[];
  requestIds?: string[];
  sessionIds?: string[];
  services?: string[];
  fromTime: string;
  toTime: string;
  keywords?: string[];
  limit?: number;
}

export interface LogSummary {
  matched: boolean;
  source?: string;
  totalHits?: number;
  highlights: string[];
  errorSamples: Array<{
    timestamp: string;
    level?: string;
    service?: string;
    message: string;
  }>;
  rawLink?: string;
}

export interface LogProvider {
  query(input: LogQuery): Promise<LogSummary | null>;
}
```

### 11.5 AIEngine

```ts
export interface FailureContext {
  run: Run;
  result: TestResult;
  correlationContext: CorrelationContext;
  traceSummaries: TraceSummary[];
  logSummary?: LogSummary | null;
  networkSummary?: NetworkSummary;
  screenshotPath?: string;
}

export interface AIEngine {
  analyzeFailure(input: FailureContext): Promise<FailureAnalysis>;
  createCodeTask(input: CodeTaskDraftInput): Promise<CodeTaskDraft>;
}
```

### 11.6 CodeAgent

```ts
export interface CodeTask {
  taskId: string;
  mode: 'suggest' | 'apply' | 'verify';
  target: 'test' | 'app' | 'mixed';
  automationLevel: 'headless' | 'interactive';
  workspacePath: string;
  scopePaths: string[];
  goal: string;
  contextFiles?: string[];
  diagnostics?: string[];
  constraints?: string[];
  verificationCommands?: string[];
  branchName?: string;
}

export interface CodeChangeResult {
  success: boolean;
  summary: string;
  changedFiles: string[];
  diffPath?: string;
  patchPath?: string;
  verification?: {
    passed: boolean;
    outputs: string[];
  };
  rawOutputPath?: string;
}

export interface CodeAgent {
  name: string;
  isAvailable(): Promise<boolean>;
  plan(task: CodeTask): Promise<string>;
  apply(task: CodeTask): Promise<CodeChangeResult>;
  verify(task: CodeTask): Promise<CodeChangeResult>;
}
```

### 11.7 CodeTaskPolicy

```ts
export interface CodeTaskPolicy {
  check(task: CodeTask): {
    allowed: boolean;
    reason?: string;
    normalizedScope?: string[];
  };
}
```

### 11.8 ArtifactStore

```ts
export interface ArtifactStore {
  saveArtifact(input: SaveArtifactInput): Promise<ArtifactRef>;
  readArtifact(path: string): Promise<Buffer | string>;
}
```

### 11.9 Repository

```ts
export interface RunRepository {
  saveRun(run: Run): Promise<void>;
  saveResult(result: TestResult): Promise<void>;
  saveCorrelationContext(context: PersistedCorrelationContext): Promise<void>;
  saveDiagnosticFetch(fetch: DiagnosticFetch): Promise<void>;
  saveAnalysis(analysis: FailureAnalysis): Promise<void>;
  saveCodeTask(task: PersistedCodeTask): Promise<void>;
  saveReview(review: Review): Promise<void>;
  saveCommit(record: CommitRecord): Promise<void>;
}
```

---

## 12. 数据模型设计

### 12.1 Run

建议字段：

- `runId`
- `triggerType`
- `environment`
- `suite`
- `scenarioId`
- `tag`
- `status`
- `pauseRequested`
- `startedAt`
- `endedAt`
- `total`
- `passed`
- `failed`
- `skipped`
- `summary`

### 12.2 TestResult

建议字段：

- `id`
- `runId`
- `testcaseId`
- `scenarioId`
- `status`
- `errorType`
- `errorMessage`
- `durationMs`
- `screenshotPath`
- `videoPath`
- `tracePath`
- `htmlReportPath`
- `networkLogPath`
- `createdAt`

### 12.3 CorrelationContext

建议字段：

- `id`
- `runId`
- `testcaseId`
- `traceIdsJson`
- `requestIdsJson`
- `sessionIdsJson`
- `serviceHintsJson`
- `fromTime`
- `toTime`
- `createdAt`

### 12.4 DiagnosticFetch

建议字段：

- `id`
- `runId`
- `testcaseId`
- `type`
- `status`
- `provider`
- `requestJson`
- `summaryJson`
- `rawLink`
- `createdAt`

### 12.5 FailureAnalysis

建议字段：

- `id`
- `runId`
- `testcaseId`
- `category`
- `suspectedLayer`
- `confidence`
- `summary`
- `probableCause`
- `traceSummaryJson`
- `logSummaryJson`
- `suggestionsJson`
- `createdAt`

### 12.6 CodeTask

建议字段：

- `taskId`
- `runId`
- `testcaseId`
- `analysisId`
- `status`
- `agentName`
- `mode`
- `target`
- `automationLevel`
- `workspacePath`
- `scopePathsJson`
- `goal`
- `constraintsJson`
- `verificationCommandsJson`
- `summary`
- `diffPath`
- `patchPath`
- `rawOutputPath`
- `verifyPassed`
- `createdAt`
- `updatedAt`

### 12.7 Review

建议字段：

- `id`
- `taskId`
- `reviewer`
- `decision`
- `comment`
- `createdAt`

### 12.8 CommitRecord

建议字段：

- `id`
- `taskId`
- `branchName`
- `commitSha`
- `commitMessage`
- `createdAt`

### 12.9 RunEvent

建议字段：

- `id`
- `runId`
- `entityType`
- `entityId`
- `eventType`
- `payloadJson`
- `createdAt`

---

## 13. SQLite 表设计建议

### 13.1 test_runs

```sql
CREATE TABLE test_runs (
  run_id TEXT PRIMARY KEY,
  trigger_type TEXT,
  environment TEXT,
  suite TEXT,
  scenario_id TEXT,
  tag TEXT,
  status TEXT NOT NULL,
  pause_requested INTEGER DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  total INTEGER,
  passed INTEGER,
  failed INTEGER,
  skipped INTEGER,
  summary TEXT
);
```

### 13.2 test_results

```sql
CREATE TABLE test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  scenario_id TEXT,
  status TEXT,
  error_type TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  screenshot_path TEXT,
  video_path TEXT,
  trace_path TEXT,
  html_report_path TEXT,
  network_log_path TEXT,
  created_at TEXT
);
```

### 13.3 correlation_contexts

```sql
CREATE TABLE correlation_contexts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  trace_ids_json TEXT,
  request_ids_json TEXT,
  session_ids_json TEXT,
  service_hints_json TEXT,
  from_time TEXT,
  to_time TEXT,
  created_at TEXT
);
```

### 13.4 diagnostic_fetches

```sql
CREATE TABLE diagnostic_fetches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  request_json TEXT,
  summary_json TEXT,
  raw_link TEXT,
  created_at TEXT
);
```

### 13.5 failure_analysis

```sql
CREATE TABLE failure_analysis (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  category TEXT,
  suspected_layer TEXT,
  confidence REAL,
  summary TEXT,
  probable_cause TEXT,
  trace_summary_json TEXT,
  log_summary_json TEXT,
  suggestions_json TEXT,
  created_at TEXT
);
```

### 13.6 code_tasks

```sql
CREATE TABLE code_tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  analysis_id TEXT,
  status TEXT NOT NULL,
  agent_name TEXT,
  mode TEXT,
  target TEXT,
  automation_level TEXT,
  workspace_path TEXT NOT NULL,
  scope_paths_json TEXT,
  goal TEXT,
  constraints_json TEXT,
  verification_commands_json TEXT,
  summary TEXT,
  diff_path TEXT,
  patch_path TEXT,
  raw_output_path TEXT,
  verify_passed INTEGER,
  created_at TEXT,
  updated_at TEXT
);
```

### 13.7 reviews

```sql
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  reviewer TEXT,
  decision TEXT NOT NULL,
  comment TEXT,
  created_at TEXT
);
```

### 13.8 commit_records

```sql
CREATE TABLE commit_records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  branch_name TEXT,
  commit_sha TEXT,
  commit_message TEXT,
  created_at TEXT
);
```

### 13.9 run_events

```sql
CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT
);
```

---

## 14. 文件系统存储规范

建议结构如下：

```text
/data
  /artifacts
    /<runId>
      /<testcaseId>
        screenshot.png
        video.webm
        trace.zip
        network.json
        report-link.json
  /diagnostics
    /<runId>
      /<testcaseId>
        correlation-context.json
        trace-summary.json
        log-summary.json
  /analysis
    /<runId>
      /<testcaseId>.json
  /code-tasks
    /<taskId>
      input.json
      raw-output.txt
      changes.diff
      changes.patch
      verify.txt
  /commits
    /<taskId>.json
  /runs
    /<runId>.json
```

设计要求：

- artifacts 按 `runId / testcaseId` 分层
- diagnostics 独立于 artifacts 管理
- code task 产物按 `taskId` 独立分层
- 数据库存路径，不直接存大文件内容
- 删除历史 run 时可整批清理

---

## 15. 配置体系设计

### 15.1 配置来源

按优先级覆盖：

1. 环境变量
2. 本地配置文件 `config.local.yaml`
3. 默认配置 `config.default.yaml`

### 15.2 配置项示例

```yaml
app:
  name: ai-regression-workbench
  baseUrl: http://localhost:8080

storage:
  sqlitePath: ./data/sqlite/app.db
  artifactRoot: ./data/artifacts
  diagnosticRoot: ./data/diagnostics
  codeTaskRoot: ./data/code-tasks

workspace:
  targetProjectPath: /absolute/path/to/your/project
  gitRootStrategy: auto
  allowOutsideToolWorkspace: true

testAssets:
  sharedRoot: /absolute/or/relative/path
  sharedRootMode: auto
  generatedRoot: .ai-regression-workbench/data/generated-tests
  includeSharedInRuns: true
  includeGeneratedInRuns: false
  requireGitForSharedRoot: false

playwright:
  headless: true
  browser: chromium
  trace: retain-on-failure
  video: retain-on-failure
  screenshot: only-on-failure

diagnostics:
  correlationKeys:
    responseHeaders:
      - X-Trace-Id
      - X-B3-TraceId
      - X-Request-Id
    responseBodyPaths:
      - traceId
      - requestId
      - data.traceId
    logFields:
      - traceId
      - trace_id
      - requestId
      - sessionId
    caseInsensitiveHeaderMatch: true
    timeWindowSeconds: 120

trace:
  provider: jaeger
  endpoint: http://localhost:16686/api/traces

logs:
  provider: loki
  endpoint: http://localhost:3100
  defaultLimit: 50
  redactFields:
    - authorization
    - cookie
    - token

ai:
  provider: openai
  model: gpt-5.4-thinking
  enabled: true

codeAgent:
  defaultApprovalRequired: true
  allowedWriteScopes:
    - packages/test-assets
    - playwright
    - data/generated-tests
  defaultVerifyCommands:
    - pnpm test

report:
  port: 3910
```

### 15.3 诊断关联键配置要求

不同用户系统返回的 header、body 字段、日志字段可能不同，因此实现中禁止写死 `X-Trace-Id`。

建议支持以下配置：

- `diagnostics.correlationKeys.responseHeaders`
  允许配置多个候选响应头，按顺序匹配。

- `diagnostics.correlationKeys.responseBodyPaths`
  当 header 不存在时，可从响应体约定字段中提取。

- `diagnostics.correlationKeys.logFields`
  指定日志系统中的关联字段名。

- `diagnostics.correlationKeys.caseInsensitiveHeaderMatch`
  是否忽略 header 名大小写。

- `diagnostics.correlationKeys.timeWindowSeconds`
  日志查询默认时间窗口。

实现要求：

- 默认值可以包含 `X-Trace-Id`
- 用户必须能在配置文件中覆盖
- UI/CLI 需要能展示当前生效配置

### 15.4 目标项目目录配置要求

建议支持以下配置：

- `workspace.targetProjectPath`
  指定被测试、被修复的本地项目绝对路径

- `workspace.gitRootStrategy`
  目标目录不是 git 根目录时的处理策略，建议支持 `auto | strict`

- `workspace.allowOutsideToolWorkspace`
  是否允许目标项目目录位于工具自身目录之外

实现要求：

- 默认要求使用绝对路径
- CLI 可以通过参数临时覆盖该值
- code agent 执行前必须打印当前目标目录
- UI 中要能看到当前目标目录与 git 根目录

### 15.5 测试资产目录配置要求

建议支持以下配置：

- `testAssets.sharedRoot`
  团队共享测试集目录，可以是目标项目内相对路径，也可以是外部绝对路径

- `testAssets.sharedRootMode`
  目录解析策略，建议支持 `auto | relative-to-target | absolute`

- `testAssets.generatedRoot`
  候选测试输出目录

- `testAssets.includeSharedInRuns`
  是否默认执行共享正式测试

- `testAssets.includeGeneratedInRuns`
  是否默认执行候选测试

- `testAssets.requireGitForSharedRoot`
  是否要求共享目录必须受 Git 管理

实现要求：

- `sharedRoot` 必须支持团队显式配置
- `sharedRoot` 不存在时应视为“当前无团队共享测试集”
- 系统需要展示当前生效的共享目录
- code agent 修改正式测试时必须受 `sharedRoot` 限制

---

## 16. Playwright 设计规范

### 16.1 建议目录

```text
packages/test-assets/
  tests/
    smoke/
    regression/
    generated/
  pages/
  fixtures/
  data/
  helpers/
    trace-helper.ts
    network-helper.ts
```

### 16.2 关键规范

- 尽量使用语义化 locator
- 公共操作封装为 page object
- 诊断关联键抓取逻辑封装为通用 helper
- 每个测试必须绑定 `scenarioId / testcaseId`
- 避免在测试中硬编码环境依赖

### 16.3 诊断关联键抓取建议

通过 Playwright network hook 拦截 response：

- 优先按配置的 `responseHeaders` 依次读取响应头
- 若 header 不存在，再尝试按配置的 `responseBodyPaths` 从响应体解析
- 记录失败请求 URL、状态码、响应摘要、请求时间
- 生成 `CorrelationContext`

建议封装：

- `captureCorrelationContext(page, diagnosticsConfig)`
- `attachNetworkLogs(testInfo)`

---

## 17. Trace 与日志联动设计

### 17.1 目标

在接口失败时，自动把测试失败与后端 trace 和日志关联起来。

### 17.2 推荐数据流

```text
Response failed (500/4xx)
  ->
根据配置提取 correlation keys
  ->
按 traceIds 查询 trace
  ->
按 traceIds / requestIds / sessionIds + time window 查询日志
  ->
输出 TraceSummary + LogSummary
  ->
写入 diagnostics / failure_analysis / 报告页面
```

### 17.3 TraceSummary 结构建议

```ts
export interface TraceSummary {
  traceId: string;
  rootService?: string;
  rootOperation?: string;
  durationMs?: number;
  hasError: boolean;
  errorSpans: Array<{
    spanId: string;
    service?: string;
    operation?: string;
    message?: string;
    durationMs?: number;
  }>;
  topSlowSpans: Array<{
    spanId: string;
    service?: string;
    operation?: string;
    durationMs?: number;
  }>;
  rawLink?: string;
}
```

### 17.4 LogSummary 结构建议

```ts
export interface LogSummary {
  matched: boolean;
  source?: string;
  totalHits?: number;
  highlights: string[];
  errorSamples: Array<{
    timestamp: string;
    level?: string;
    service?: string;
    message: string;
  }>;
  rawLink?: string;
}
```

### 17.5 第一阶段日志集成范围

- 只查询与失败 testcase 强关联的日志
- 只支持一种日志 provider
- 只产生日志摘要，不做完整日志浏览器
- 需要支持敏感字段脱敏

---

## 18. AI 失败分析与受控改代码设计

### 18.1 FailureAnalysis 输入

AI 分析输入建议包含：

- testcase 基本信息
- 场景信息
- 失败信息
- 网络请求摘要
- trace 摘要
- 日志摘要
- screenshot 路径或摘要说明
- verify 输出

### 18.2 FailureAnalysis 输出

建议输出结构化对象：

```json
{
  "category": "API_ERROR",
  "suspectedLayer": "backend",
  "confidence": 0.86,
  "summary": "订单创建接口返回 500，trace 指向 order-service，日志中存在数据库唯一键冲突。",
  "probableCause": "订单落库逻辑触发数据库约束异常。",
  "suggestions": [
    "检查 order-service 中 create order 相关 DB 写入逻辑",
    "核对请求参数与数据库唯一约束",
    "对比最近一次通过版本的 SQL 或模型变更"
  ]
}
```

### 18.3 CodeTask 生成原则

AI 分析完成后，可以自动生成 `CodeTask` 草稿，但不能自动直接执行。

默认流程：

```text
FailureAnalysis 完成
  ->
AIEngine 生成 CodeTask Draft
  ->
CodeTaskPolicy 审核
  ->
落为 PENDING_APPROVAL
  ->
等待用户 approve
```

### 18.4 Code Agent 接入策略

第一阶段优先接入：

- `CodexCliAgent`
- `KiroCliAgent`

保留后续扩展位：

- `ClaudeCodeCliAgent`

建议定位：

- `CodexCliAgent`
  主自动化执行路径，负责 `plan / apply / verify`

- `KiroCliAgent`
  主交互式辅助路径，负责打开和承载用户接管会话

参考：

- [OpenAI Codex CLI 官方文档](https://developers.openai.com/codex/cli)
- [Kiro CLI 官方文档](https://kiro.dev/docs/cli/)

### 18.5 权限分级

建议分三级：

#### L1：建议级

- 只输出修复计划
- 不落盘
- 不改文件

#### L2：测试代码修改级

允许修改：

- `packages/test-assets/**`
- `playwright/**`
- `data/generated-tests/**`

禁止修改业务代码目录。

#### L3：业务代码修复级

允许修改业务代码，但必须满足：

- 新建 git 分支
- 明确 `scopePaths`
- 强制执行验证命令
- 输出 diff / patch / 变更说明
- 默认要求人工 review

### 18.6 review 与提交原则

- review 通过不等于自动 commit
- commit 必须是显式动作
- commit 前建议至少展示：
  - diff
  - patch
  - verify 输出
  - changed files

---

## 19. Local UI 设计

一期建议只做以下页面：

### 19.1 Home / Workbench

展示：

- 当前工作区状态
- 快速运行面板
- 最近运行
- 待处理任务
- 系统告警

### 19.2 Run List

展示：

- runId
- 开始时间
- 当前状态
- 总数 / 通过 / 失败
- 当前卡点

### 19.3 Run Detail

展示：

- 执行总览
- testcase 结果
- artifacts
- diagnostics
- AI 分析摘要
- 错误报告
- 关联 code tasks
- 事件时间线

### 19.4 Failure Report

展示：

- 失败 testcase 基本信息
- artifacts
- CorrelationContext
- TraceSummary
- LogSummary
- FailureAnalysis
- Create CodeTask / Retry Analysis 等操作

### 19.5 CodeTask Detail

展示：

- task 状态
- goal / scope / constraints
- 修复摘要
- changed files
- raw output
- diff / patch
- verify 输出
- review / commit 历史
- 审批与执行按钮

### 19.6 Review / Commit Panel

展示：

- review 决策入口
- commit 信息输入与提交入口

---

## 20. CLI 设计

建议首批 CLI 命令：

```bash
zarb
zarb init
zarb doctor
zarb ui
zarb run start --suite smoke
zarb run start --suite smoke --project-path /path/to/project
zarb run show --run-id <runId>
zarb run watch --run-id <runId>
zarb run pause --run-id <runId>
zarb run resume --run-id <runId>
zarb run cancel --run-id <runId>

zarb diagnostics show --run-id <runId> --testcase <testcaseId>
zarb trace fetch --trace-id <traceId>
zarb logs query --run-id <runId> --testcase <testcaseId>

zarb analysis retry --run-id <runId> --testcase <testcaseId>

zarb code-task list --run-id <runId>
zarb code-task show --task-id <taskId>
zarb code-task approve --task-id <taskId>
zarb code-task reject --task-id <taskId>
zarb code-task execute --task-id <taskId>
zarb code-task retry --task-id <taskId>
zarb code-task cancel --task-id <taskId>

zarb review submit --task-id <taskId> --decision accept
zarb review submit --task-id <taskId> --decision reject

zarb commit create --task-id <taskId>
zarb workspace show
zarb workspace set --project-path /path/to/project
```

设计要求：

- `approve` 与 `execute` 分离
- 所有控制命令都写事件
- `watch` 读取事件时间线而非仅轮询日志
- `run start` 和 `code-task execute` 必须显示当前目标项目目录
- 默认入口 `zarb` 应支持首次运行自动初始化并启动工作台

分工原则：

- CLI 负责启动、配置、脚本化触发、快速状态查询
- Web UI 负责主操作流、问题定位、审批、审阅

---

## 21. 实现分层与职责边界

### 21.1 控制层

包含：

- CLI
- Local UI
- Review Manager

职责：

- 接收用户输入
- 发起状态转换动作
- 展示结果

### 21.2 状态层

包含：

- Orchestrator
- Event Store
- Repository

职责：

- 统一状态推进
- 管理中断、恢复、重试
- 持久化事件与实体

### 21.3 诊断层

包含：

- Test Runner
- Trace Bridge
- Log Bridge

职责：

- 收集诊断证据
- 归一化输出
- 为 AI 分析提供输入

### 21.4 执行层

包含：

- AI Engine
- Code Agent Adapter

职责：

- 生成建议
- 生成 CodeTask
- 执行修复与 verify

---

## 22. 第一阶段 MVP 范围

### 22.1 必做

1. monorepo 初始化
2. CLI 基础命令入口
3. Run 状态机初版
4. Playwright runner 封装
5. SQLite 基础表
6. 本地 artifacts 存储
7. diagnostics correlation context 抓取
8. trace 查询桥接，先支持一种 provider
9. 日志查询桥接，先支持一种 provider
10. AI 失败分析接口与基础实现
11. CodeTask 模型与表结构
12. CodeTaskPolicy 初版
13. CodexCliAgent / KiroCliAgent 基础接入
14. code task approve / execute / verify 流程
15. review 与 commit 控制动作
16. Local UI 展示 run、diagnostics、code task、事件时间线
17. 目标项目目录配置与展示
18. 共享测试集目录配置与展示

### 22.2 可后置

1. Scenario 编辑 UI
2. 自动页面探测
3. locator 自动修复建议增强
4. ClaudeCodeCliAgent 适配器
5. CI 集成
6. 回归门禁策略
7. 多 agent 协作编排

---

## 23. 开发分阶段计划

### 阶段 A：测试与诊断闭环

目标：能跑测试、采集产物、提取关联键、查询 trace 和日志、生成 AI 分析。

交付物：

- CLI
- Run / TestResult / CorrelationContext / FailureAnalysis 基础模型
- Playwright runner
- correlation key 提取
- Trace Bridge
- Log Bridge
- 运行结果与诊断报告页

### 阶段 B：受控修复闭环

目标：能创建、审批、执行 CodeTask，并保存修复产物。

交付物：

- CodeTask 模型
- CodeTaskPolicy
- CodexCliAgent / KiroCliAgent
- diff / patch / verify 落盘
- CodeTask Detail 页面

### 阶段 C：review 与提交闭环

目标：能人工 review、决定是否 commit，并支持中断恢复。

交付物：

- Review / CommitRecord
- 事件时间线
- pause / resume / cancel
- review / commit CLI
- UI review 面板

---

## 24. 开发任务拆分建议

### 24.1 基础设施

1. 初始化 `pnpm workspace`
2. 建立 `tsconfig.base.json`
3. 建立 `eslint` / `prettier` / `vitest` 基础配置
4. 搭建 `packages/shared-types`
5. 搭建 `packages/config`
6. 搭建 `packages/storage`
7. 搭建 `packages/event-store`

### 24.2 核心后端

1. 定义状态枚举和核心 DTO
2. 建立 SQLite schema 与 repository
3. 建立 Orchestrator 状态推进骨架
4. 建立 CLI 控制命令

### 24.3 诊断能力

1. 接入 Playwright 执行
2. 保存 artifacts / network log
3. 实现 correlation context 提取 helper
4. 实现 JaegerTraceProvider 或等价 provider
5. 实现 LokiLogProvider 或等价 provider
6. 生成 trace/log summary

### 24.4 AI 与代码修复

1. 实现 AIEngine 占位版
2. 定义 CodeTask draft 流程
3. 定义 CodeTaskPolicy
4. 接入 CodexCliAgent
5. 接入 KiroCliAgent
6. 实现 verify 流程与产物落盘

### 24.5 前端

1. 实现 Run List
2. 实现 Run Detail
3. 实现 CodeTask Detail
4. 实现 Review / Commit 面板
5. 实现事件时间线

---

## 25. 风险与规避建议

### 25.1 风险：流程自动推进过度

后果：

- 用户失去控制
- code agent 修改越权

建议：

- 执行修改默认停在 `PENDING_APPROVAL`
- commit 必须独立确认

### 25.2 风险：traceId 或日志关联字段不稳定

后果：

- 无法稳定关联后端问题

建议：

- 支持用户配置 correlation keys
- 推动网关、后端、日志链路统一埋点规范

### 25.3 风险：状态只在内存中

后果：

- 无法恢复
- 无法准确观察流程卡点

建议：

- 状态与事件必须全部持久化

### 25.4 风险：日志信息噪声过大或包含敏感字段

后果：

- AI 分析不稳定
- 存在安全风险

建议：

- 第一阶段只做日志摘要
- 对敏感字段做脱敏

### 25.5 风险：review 失真

后果：

- 用户无法判断 agent 是否安全修改

建议：

- 强制保存 raw output / diff / patch / verify 输出

---

## 26. 编码约束建议

### 26.1 代码风格

- 使用 TypeScript 严格模式
- 核心模型与 DTO 独立定义
- 各模块只通过接口交互
- 禁止跨模块直接依赖实现细节

### 26.2 错误处理

- 外部依赖失败时要降级，不可导致整体 run 崩溃
- trace 查询失败时仍保存原始测试结果
- 日志查询失败时仍允许进入 AI 分析
- AI 分析失败时只标记分析失败，不影响主流程完成
- code task 执行失败时不能污染 run 的原始执行结果

### 26.3 审计要求

- 所有状态变更必须写事件
- 所有关键执行产物必须落盘
- review 和 commit 必须保留历史记录

---

## 27. 实施建议

建议按以下顺序实现：

1. 初始化 monorepo 与 workspace
2. 创建 `shared-types`、`config`、`storage`、`event-store` 包
3. 创建 `orchestrator` 与 `test-runner` 基础骨架
4. 接入 Playwright 基础执行
5. 建立 SQLite schema 与 repository
6. 落地 artifacts 与 diagnostics 存储规范
7. 添加可配置 correlation keys、Trace Bridge、Log Bridge
8. 添加 AIEngine 接口与本地占位实现
9. 定义 CodeTask / CodeTaskPolicy / CodeAgent
10. 接入 CodexCliAgent 与 KiroCliAgent
11. 开发 Local UI 基础页面
12. 补 review 与 commit 控制面

建议每一轮只完成一个清晰子目标，不要一次性生成整套系统全部代码。

---

## 28. 本阶段最终结论

本项目当前正确定位不是“纯测试平台”，而是：

**一个本地可运行、具备回归执行、trace 联动、日志联动、AI 分析、受控代码修复、人工 review 与提交能力的人机协同工作台。**

第一阶段优先打通的最小完整闭环为：

**Playwright 执行 -> artifacts 落地 -> 诊断关联键提取 -> trace 查询 -> 日志查询 -> AI 分析 -> 报告展示 -> CodeTask 审批与执行 -> review -> commit**

只要这个闭环稳定跑通，系统就已经具备真实生产价值，也为后续平台化和更强的 agent 能力打下基础。
