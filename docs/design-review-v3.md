# 设计评估报告 v3

> 评审范围：`docs/` 下全部设计文档（v2.2，含 v2 修订后版本）
> 评审日期：2026-03-14
> 对比基准：`design-review-v2-disposition.md` 处置记录

---

## 一、总体评价

经过三轮迭代，这套设计文档已经达到了相当高的完整度和一致性。v2 处置记录中承诺的所有高优先级修订均已落地：

- `agent_sessions`、`findings`、`code_tasks.attempt`、`reviews.code_task_version` 等 DDL 全部补齐
- Harness pause/resume 协议已明确（安全点暂停 + checkpoint 恢复）
- `PLANNING_EXPLORATION` 职责已明确，失败处理已定义
- `Finding` 来源已明确（仅来自 exploration session）
- `GeneratedTestDraft` 生命周期已补充
- 分页规范、错误码命名规范已补充
- 仓库结构中 `packages/agent-harness` 已补充

以下是本轮评审发现的**剩余问题**和**实施前需要补充的内容**，分两部分呈现。

---

## 二、设计层面的剩余问题

### 2.1 Run 状态机：多 CodeTask 并行时的 Run 聚合规则有歧义

`orchestrator-design.md` 第 7.2 节定义了多 CodeTask 聚合规则，但状态机图（`design.md` 第 8.1 节）中 `AWAITING_REVIEW --> AWAITING_CODE_ACTION: review retry -> 新建 CodeTask` 这条路径与聚合规则存在矛盾：

- 聚合规则说"某个 CodeTask retry 后，Run 回到 `AWAITING_CODE_ACTION`"
- 但如果同一 run 还有其他 CodeTask 处于 `AWAITING_REVIEW`，Run 不应该整体回退

**建议**：在状态机图的注释或说明中补充："Run 聚合状态由所有活跃 CodeTask 的最低优先级状态决定，单个 CodeTask retry 不强制回退其他 CodeTask 的状态"。

### 2.2 `COLLECTING_ARTIFACTS` 在 exploration 模式下的语义不清

状态机图中 `RUNNING_EXPLORATION --> COLLECTING_ARTIFACTS`，但 exploration 模式下"artifacts"的含义与 regression 不同：
- regression 的 artifacts 是 screenshot/video/trace/network
- exploration 的 artifacts 是 finding、candidate steps、session trace

两者都走 `COLLECTING_ARTIFACTS` 这个状态，但采集逻辑完全不同，可能导致实现时混淆。

**建议**：在 `orchestrator-design.md` 中补充说明 `COLLECTING_ARTIFACTS` 在不同 runMode 下的具体采集内容，或者将 exploration 的产物采集合并到 `RUNNING_EXPLORATION` 阶段内部，不单独作为一个 Run 状态。

### 2.3 `ExplorationAgent.explore()` 接口的返回值与 Harness 的关系不清

`design.md` 第 11.7 节定义了：

```ts
explore(request: RunRequest, session: AgentSession): Promise<Finding[]>
```

但 `agent-harness-design.md` 说 Harness 负责 tool call 日志、trace、预算消耗，而 `ExplorationAgent` 只负责决策。这意味着 `explore()` 的实际执行是通过 Harness 注册的工具完成的，而不是 `ExplorationAgent` 直接返回 `Finding[]`。

这个接口签名暗示 `ExplorationAgent` 是一个同步的"黑盒"，但实际上它是一个多步骤的交互式 agent，每一步都需要 Harness 介入。

**建议**：将 `ExplorationAgent` 的接口改为事件驱动或回调模式，例如：

```ts
interface ExplorationAgent {
  onStep(context: StepContext, tools: ToolRegistry): Promise<StepDecision>;
  shouldStop(context: SessionContext, policy: HarnessPolicy): boolean;
}
```

由 Harness 驱动循环，而不是 `explore()` 一次性返回所有 findings。

### 2.4 `CodeAgent` 接口与 Harness 的边界重叠

`design.md` 第 11.8 节定义了 `CodeAgent.plan/apply/verify`，但 `agent-harness-design.md` 说 Harness 负责"以工作区 diff/patch/verify 为准落盘产物"。这意味着：

- `CodeAgent.apply()` 执行代码修改
- Harness 在 `apply()` 完成后自行计算 diff/patch

但 `CodeChangeResult` 接口中有 `diffPath`、`patchPath`，暗示 `CodeAgent` 自己也会产出这些。

**建议**：明确分工：`CodeAgent` 只负责执行修改并返回 `rawOutputPath`，diff/patch 的计算和落盘统一由 Harness 在 `apply()` 完成后通过 `git diff` 生成，`CodeChangeResult.diffPath/patchPath` 由 Harness 填充而非 CodeAgent 自报。

### 2.5 `FailureAnalysis.version` 与 `retryCount` 的语义重叠

`design.md` 第 12.5 节 `FailureAnalysis` 有 `version` 和 `retryCount` 两个字段，但两者语义接近：
- `version` 表示第几次分析
- `retryCount` 表示重试了几次

如果每次 retry 都创建新记录，`retryCount` 应该是 `version - 1`，两者冗余。

**建议**：只保留 `version`（从 1 开始递增），去掉 `retryCount`，或者明确 `retryCount` 是累计重试次数（跨多次 run 的历史），而 `version` 是当前 run 内的分析版本。

### 2.6 `test_runs` 表中 `timeout_at` 字段没有对应的业务逻辑

`design.md` 第 13.1 节 `test_runs` DDL 中有 `timeout_at TEXT` 字段，但：
- 没有说明谁写入这个字段
- 没有说明超时检测的触发机制（是定时轮询还是 Orchestrator 主动检查）
- 没有说明超时后的状态转换由谁负责

**建议**：在 `orchestrator-design.md` 的超时策略章节补充 `timeout_at` 的写入时机和超时检测机制（建议由 `TimeoutPolicy` 在每次状态推进时检查，而不是独立的定时器）。


### 2.7 `AgentSession` 接口与领域模型的字段不一致

`design.md` 第 11.6 节 `AgentHarness` 接口中 `StartAgentSessionInput` 有 `contextRefs: string[]` 字段，但：
- `AgentSession` 领域模型（第 12.5.1 节）和 DDL（第 13.5.1 节）中没有对应的 `context_refs` 字段
- `agent-harness-design.md` 第 3.1 节的 `AgentSession` 字段列表中也没有这个字段

这意味着 session 启动时传入的上下文引用无法持久化，无法支持 replay 和 eval。

**建议**：在 `agent_sessions` 表和 `AgentSession` 领域模型中补充 `contextRefsJson TEXT` 字段，用于记录 session 启动时的上下文引用列表。

### 2.8 `CodeTaskStatus` 状态机中 `SUCCEEDED` 到 `COMMIT_PENDING` 的路径缺少中间状态

`design.md` 第 8.2 节 CodeTask 状态机图中：

```
SUCCEEDED --> COMMIT_PENDING: review accept
SUCCEEDED --> REJECTED: review reject
```

但 `code-task-design.md` 第 2 节的流程描述是：

```
SUCCEEDED -> Review Action -> COMMIT_PENDING
```

这意味着 `SUCCEEDED` 状态实际上是"等待 review"的状态，但状态名称 `SUCCEEDED` 语义上表示"已成功完成"，容易让实现者误以为任务已经结束，不需要再等待 review。

实际上 `SUCCEEDED` 在这里的语义是"verify 通过，等待 review 决策"，而不是"整个 CodeTask 流程已完成"。

**建议**：将 `SUCCEEDED` 重命名为 `AWAITING_REVIEW`（CodeTask 级别），或者在文档中明确标注"`SUCCEEDED` 表示 verify 通过但尚未 review，不是终态"，避免与 Run 级别的 `COMPLETED` 语义混淆。

### 2.9 `RunRepository` 接口缺少关键查询方法

`design.md` 第 11.11 节 `RunRepository` 只定义了写方法（`save*`），没有定义任何读方法。但 Orchestrator 在状态推进时需要读取 Run、CodeTask、AgentSession 等数据，例如：
- 恢复 run 时需要读取 `pausedAtStage`
- 聚合 Run 状态时需要读取所有关联 CodeTask 的状态
- 超时检测时需要读取 `timeout_at`

**建议**：在 `RunRepository` 接口中补充核心查询方法，至少包括：
```ts
getRun(runId: string): Promise<Run | null>;
getCodeTasksByRunId(runId: string): Promise<PersistedCodeTask[]>;
getAgentSession(sessionId: string): Promise<AgentSession | null>;
```

---

## 三、实施前需要补充的内容

### 3.1 `ExplorationConfig` 与 `PersonalSettings.exploration` 的默认值合并规则未定义

`design.md` 第 11.0 节 `ExplorationConfig` 中 `maxSteps` 和 `maxPages` 是必填字段，但 `app-services-design.md` 第 7.1.1 节说 `exploration` 配置可以省略，系统会与 `config.default.yaml` 合并。

问题在于：合并的优先级和时机没有明确定义：
- 是 `StartRunInput.exploration` 覆盖 `PersonalSettings.exploration` 覆盖 `config.default.yaml`？
- 还是 `PersonalSettings.exploration` 作为 `StartRunInput.exploration` 的默认值？
- 合并在哪一层发生（RunService？Orchestrator？）

**建议**：在 `app-services-design.md` 或 `orchestrator-design.md` 中明确三层配置的合并优先级和合并时机，并说明合并后的完整 `ExplorationConfig` 在哪里落盘（建议落到 `test_runs.exploration_config_json`）。

### 3.2 `ExecutionReport` 与 `execution_reports` 表的字段映射不完整

`app-services-design.md` 第 7.3.1 节定义了完整的 `ExecutionReport` DTO，包含 `flowSummaries`、`testcaseProfiles`、`artifactLinks`、`warnings`、`recommendations` 等字段，但 `design.md` 第 13.13 节的 `execution_reports` 表只有：

```sql
id, run_id, status, report_path, totals_json, generated_at
```

`totals_json` 只能存 `summary` 部分，`stageResults`、`degradedSteps`、`fatalReason`、`failureReports`、`codeTaskSummaries`、`flowSummaries` 等字段都没有对应的存储位置。

**建议**：明确 `ExecutionReport` 的存储策略：
- 方案 A：`execution_reports` 表只存索引字段，完整报告序列化到 `runs/<runId>-execution-report.json`，`report_path` 指向该文件
- 方案 B：在 `execution_reports` 表中增加 `report_json TEXT` 字段存完整报告

建议采用方案 A，并在 `storage-mapping-design.md` 中明确说明。

### 3.3 `TestcaseExecutionProfile` 没有对应的 SQLite 表或文件路径

`app-services-design.md` 第 7.3.2 节定义了 `TestcaseExecutionProfile` DTO，`storage-mapping-design.md` 第 4 节的映射矩阵中有 `diagnostics/<runId>/<testcaseId>/api-calls.jsonl` 等文件，但没有说明 `TestcaseExecutionProfile` 本身是否落盘，以及 `GET /runs/:runId/testcases/:testcaseId/execution-profile` 接口是实时聚合还是读取预计算结果。

**建议**：明确 `TestcaseExecutionProfile` 的生成策略：
- 是每次请求时实时从 `api_call_records`、`ui_action_records`、`flow_step_records` 聚合？
- 还是在 testcase 执行完成后预计算并落盘到 `diagnostics/<runId>/<testcaseId>/execution-profile.json`？

建议预计算并落盘，并在 `storage-mapping-design.md` 的映射矩阵中补充该文件路径。

### 3.4 `Scenario` 的创建来源和管理入口未定义

`design.md` 第 7.2.1 节和第 13.2.1 节定义了 `Scenario` 模型和 DDL，`test-assets-design.md` 第 6 节也提到了 `Scenario`，但没有说明：
- `Scenario` 由谁创建（手工定义？从测试文件扫描？AI 从 exploration 中提取？）
- `Scenario` 的管理入口在哪里（UI 有没有 Scenario 管理页面？）
- `test_results.scenario_id` 是如何关联到 `scenarios.scenario_id` 的（测试文件中如何声明 `scenarioId`？）

**建议**：在 `test-assets-design.md` 中补充 `Scenario` 的创建来源说明，至少明确第一阶段的策略（例如：第一阶段 `Scenario` 由测试文件中的 `scenarioId` 注解静态声明，不提供 UI 管理入口）。

### 3.5 `DiagnosticsService.getExecutionProfile` 与 `RunService.getExecutionReport` 的职责边界模糊

`app-services-design.md` 中：
- `DiagnosticsService.getExecutionProfile(runId, testcaseId)` 返回 `TestcaseExecutionProfile`（testcase 级明细）
- `RunService.getExecutionReport(runId)` 返回 `ExecutionReport`（run 级汇总）

但 `ExecutionReport` 中有 `testcaseProfiles: Array<{ testcaseId, profilePath }>`，这意味着 run 级报告引用了 testcase 级明细的路径。

问题在于：`ExecutionReport` 的 `flowSummaries` 字段是 run 级聚合，但 `flowSummaries` 的数据来源是 `flow_step_records`，而 `flow_step_records` 是 testcase 级的。这个聚合由谁做、在什么时机做，没有说明。

**建议**：在 `orchestrator-design.md` 或 `app-services-design.md` 中明确 `ExecutionReportBuilder` 的聚合逻辑，说明 `flowSummaries` 是在 run 终态时由 `ExecutionReportBuilder` 从 `flow_step_records` 聚合生成。

### 3.6 `local-ui-design.md` 中的接口列表与 `api-contract-design.md` 存在不一致

`local-ui-design.md` 第 5 节列出了 UI 需要的接口，其中包括：
- `GET /runs/:runId/findings`（标注"后续可选；第一阶段先内嵌在 RunDetail"）
- `GET /runs/:runId/testcases/:testcaseId/failure-report`
- `GET /runs/:runId/testcases/:testcaseId/execution-profile`
- `GET /runs/:runId/testcases/:testcaseId/diagnostics`
- `GET /runs/:runId/testcases/:testcaseId/trace`
- `GET /runs/:runId/testcases/:testcaseId/logs`
- `GET /runs/:runId/testcases/:testcaseId/analysis`

但 `api-contract-design.md` 第 6 节只列出了：
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/execution-report`
- `GET /runs/:runId/events`

`api-contract-design.md` 缺少了大量 testcase 级诊断接口的定义，导致前后端契约不完整。

**建议**：在 `api-contract-design.md` 中补充 testcase 级诊断接口的定义，至少包括路径规范、请求参数和响应 DTO 引用。

### 3.7 `observability-design.md` 中 `ObservedHarness` 的实现位置未明确

`observability-design.md` 第 4 节建议使用 `ObservedHarness` 装饰器模式，但没有说明：
- `ObservedHarness` 的代码放在哪里（`packages/agent-harness`？`apps/orchestrator`？独立包？）
- `ObservedHarness` 是否需要在 `packages/agent-harness` 中导出，还是在 `apps/orchestrator` 中组装？
- 与 `zai-xray` 的集成是通过 npm 包依赖还是通过 HTTP 回调？

**建议**：在 `observability-design.md` 中补充 `ObservedHarness` 的代码归属和与外部工具的集成方式（建议：`ObservedHarness` 放在 `packages/agent-harness` 中作为可选装饰器，通过 `ObservabilityAdapter` 接口与外部工具解耦）。

### 3.8 配置热更新的观察者注册时机未说明

`design.md` 第 10.12 节说 `ConfigManager` 保存配置后"通过观察者接口向 trace/log/diagnostics/ai/harness/codeAgent 广播最新快照"，但没有说明：
- 各模块何时注册观察者（`BootstrapService.bootstrap()` 时统一注册？还是各模块自行注册？）
- 如果模块懒加载，如何保证它能收到最新配置？
- 观察者接口的具体签名是什么？

**建议**：在 `app-services-design.md` 或 `packages/config` 的设计说明中补充观察者注册时机和接口签名，例如：
```ts
interface ConfigObserver {
  onConfigUpdated(snapshot: SettingsSnapshot): Promise<void>;
}
```
并明确在 `BootstrapService.bootstrap()` 时统一完成所有模块的观察者注册。


---

## 四、跨文档一致性问题

### 4.1 `RunRepository` 接口与 `storage-mapping-design.md` 的写入模块不一致

`storage-mapping-design.md` 第 4 节映射矩阵中：
- `Finding` 的写入模块是 `AgentHarness / AI Engine`
- `FlowStepRecord` 的写入模块是 `Test Runner / Orchestrator`

但 `design.md` 第 11.11 节 `RunRepository` 接口中，`saveFinding` 和 `saveFlowStep` 都是 `RunRepository` 的方法，没有区分调用方。

这不是严重问题，但在实现时可能导致混淆：`AgentHarness` 是否应该直接调用 `RunRepository`，还是通过 `Orchestrator` 中转？

**建议**：在 `orchestrator-design.md` 或 `agent-harness-design.md` 中明确 `AgentHarness` 是否可以直接调用 `Repository`，还是必须通过事件或回调通知 `Orchestrator` 来写入。

### 4.2 `code-task-design.md` 中 `taskVersion` 字段与 `design.md` 的 DDL 对应关系

`code-task-design.md` 第 3 节提到 `taskVersion`（API/DTO 名称，对应持久层 `attempt`），`app-services-design.md` 第 7.6 节 `CodeTaskSummary` 也有 `taskVersion`，`design.md` 第 13.6 节 DDL 中有 `attempt INTEGER NOT NULL DEFAULT 1`。

三处文档的对应关系已经明确，但 `code-task-design.md` 第 3 节的字段列表中写的是 `taskVersion`，而不是 `attempt`，容易让实现者误以为 DDL 字段名是 `task_version`。

**建议**：在 `code-task-design.md` 中明确标注"持久层字段名为 `attempt`，API/DTO 暴露为 `taskVersion`"，避免实现时字段名混淆。

### 4.3 `local-ui-design.md` 第 3.2 节 `QuickRunPanel` 与 `StartRunInput` 的字段对应关系

`local-ui-design.md` 第 3.2 节说 `QuickRunPanel` 支持 `selector` 输入，但 `app-services-design.md` 第 7.2.1 节 `StartRunInput` 中 `selector` 是 `RunSelector` 对象（有 `suite/scenarioId/tag/testcaseId` 四个字段）。

UI 层如何将用户输入映射到 `RunSelector` 的具体字段没有说明（例如：用户输入 `smoke`，是 `suite=smoke` 还是 `tag=smoke`？）。

**建议**：在 `local-ui-design.md` 中补充 `QuickRunPanel` 的 selector 输入交互设计，明确用户如何选择 selector 类型（建议提供下拉选择 `suite/scenario/tag/testcase`，再输入对应值）。

### 4.4 `packaging-design.md` 中 `zarb doctor` 检查项与实际配置项不完全对应

`packaging-design.md` 第 6 节 `doctor` 检查项包括"是否存在待执行迁移"，但 `storage-mapping-design.md` 第 5.3 节说"启动时若存在待执行迁移，应先迁移再对外提供服务"。

这意味着 `doctor` 检查"是否存在待执行迁移"时，正常情况下应该总是"无待执行迁移"（因为启动时已自动执行）。`doctor` 检查这一项的实际意义是什么？

**建议**：明确 `doctor` 检查迁移状态的语义：是检查"迁移是否成功执行"（即验证当前 schema 版本与预期一致），而不是检查"是否有待执行迁移"。

---

## 五、整体缺口汇总（本轮新发现）

| 缺口 | 影响 | 优先级 |
|------|------|--------|
| `ExplorationAgent.explore()` 接口签名与 Harness 驱动模型不符 | 实现时接口边界混乱 | 高 |
| `CodeAgent` 与 Harness 的 diff/patch 产出职责重叠 | 实现时两侧各自计算 diff | 高 |
| `RunRepository` 缺少核心查询方法 | Orchestrator 无法读取状态 | 高 |
| `ExplorationConfig` 三层配置合并规则未定义 | 实现时合并逻辑各自为政 | 高 |
| `ExecutionReport` 与 `execution_reports` 表字段映射不完整 | 报告无法完整落盘 | 高 |
| `api-contract-design.md` 缺少 testcase 级诊断接口定义 | 前后端契约不完整 | 高 |
| `AgentSession.contextRefsJson` 字段缺失 | session replay 无法还原上下文 | 中 |
| `CodeTaskStatus.SUCCEEDED` 语义歧义（verify 通过但非终态） | 实现时误以为任务已完成 | 中 |
| `FailureAnalysis.version` 与 `retryCount` 语义重叠 | 字段冗余，实现时不知道用哪个 | 中 |
| `test_runs.timeout_at` 字段无对应业务逻辑 | 字段写入时机和检测机制不明 | 中 |
| `TestcaseExecutionProfile` 生成策略未定义（实时聚合 vs 预计算） | 接口性能不可预期 | 中 |
| `Scenario` 创建来源和管理入口未定义 | 实现时不知道谁负责创建 Scenario | 中 |
| `ExecutionReport.flowSummaries` 聚合逻辑未说明 | 实现时不知道在哪里聚合 | 中 |
| `ObservedHarness` 代码归属和集成方式未明确 | 实现时放置混乱 | 中 |
| 配置热更新观察者注册时机未说明 | 模块初始化顺序不确定 | 中 |
| `COLLECTING_ARTIFACTS` 在 exploration 模式下语义不清 | 实现时采集逻辑混淆 | 中 |
| Run 聚合状态与单个 CodeTask retry 的关系有歧义 | 状态机实现时边界不清 | 中 |
| `AgentHarness` 是否可直接调用 `Repository` 未明确 | 模块依赖方向不确定 | 低 |
| `code-task-design.md` 中 `taskVersion` vs `attempt` 标注不清晰 | 实现时字段名混淆 | 低 |
| `QuickRunPanel` 的 selector 输入交互设计缺失 | UI 实现时不知道如何映射 | 低 |
| `doctor` 检查迁移状态的语义不准确 | 检查项意义模糊 | 低 |

---

## 六、总结

本轮评审基于完整阅读所有设计文档（`design.md`、`orchestrator-design.md`、`agent-harness-design.md`、`ai-engine-design.md`、`api-contract-design.md`、`app-services-design.md`、`code-task-design.md`、`storage-mapping-design.md`、`diagnostics-design.md`、`test-assets-design.md`、`local-ui-design.md`、`packaging-design.md`、`observability-design.md`）进行。

整体评价：这套文档已经具备相当高的工程落地质量，核心流程、状态机、存储映射、API 契约都已经达到可以开始编码的水平。本轮发现的问题主要集中在三个方向：

**1. 接口边界的精确性**

`ExplorationAgent.explore()` 的签名与 Harness 驱动模型不符，`CodeAgent` 与 Harness 的 diff/patch 产出职责重叠，`RunRepository` 缺少查询方法——这三个问题如果不在编码前解决，会导致实现时接口边界混乱，两侧各自实现一套逻辑。

**2. 存储与 DTO 的完整映射**

`ExecutionReport` 的完整字段没有对应的存储策略，`TestcaseExecutionProfile` 的生成策略（实时聚合 vs 预计算）未定义，`api-contract-design.md` 缺少 testcase 级诊断接口——这些问题会导致实现时存储层和 API 层各自发明方案。

**3. 配置与初始化的细节**

`ExplorationConfig` 三层配置合并规则未定义，配置热更新观察者注册时机未说明——这些问题在单模块开发时不明显，但在多模块联调时会暴露。

**建议优先级**：

- 编码前必须解决：高优先级缺口（接口边界、存储映射、API 契约）
- 对应模块开发前解决：中优先级缺口（配置合并、聚合逻辑、观察者注册）
- 可在实现中自然解决：低优先级缺口（命名标注、UI 交互细节）
