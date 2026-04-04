# Orchestrator 详细设计

## 1. 模块目标

`orchestrator` 是系统的业务状态推进核心，负责驱动 `Run`、`Exploration`、`CodeTask`、`Review`、`Commit` 生命周期，并在需要人工动作的节点停下等待。

## 2. 核心职责

- 创建和更新 `Run`
- 根据 `runMode` 驱动回归执行、自主探测或混合流程
- 驱动测试执行、诊断查询、AI 分析
- 创建 `CodeTask`
- 协调 pause、resume、cancel、retry
- 处理接口错误分级（degraded / blocking）
- 汇总流程/点击/接口统计并生成执行报告
- 写入 `run_events`
- 启动、恢复、取消 harness session

## 3. 明确不负责

- 不负责 prompt 构建细节
- 不负责工具调用权限细节
- 不负责 agent step 级 trace 持久化
- 不直接执行 code agent CLI

这些能力分别下沉到：

- `AIEngine`
- `AgentHarness`
- `CodeRepairAgent` / transport
- `ExecutionReportBuilder`

## 4. 内部协作者建议

为了避免 `orchestrator` 膨胀，建议内部拆为：

- `RunLifecycleCoordinator`
- `CodeTaskLifecycleManager`
- `ExecutionReportBuilder`
- `TimeoutPolicy`

对外仍保留统一 `Orchestrator` facade。

## 5. 状态推进

`RunStatus`：

- `CREATED`
- `RUNNING_TESTS`
- `PLANNING_EXPLORATION`
- `RUNNING_EXPLORATION`
- `COLLECTING_ARTIFACTS`
- `FETCHING_TRACES`
- `FETCHING_LOGS`
- `ANALYZING_FAILURES`
- `AWAITING_CODE_ACTION`
- `RUNNING_CODE_TASK`
- `AWAITING_REVIEW`
- `READY_TO_COMMIT`
- `PAUSED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

`CodeTaskStatus`：

- `DRAFT`
- `PENDING_APPROVAL`
- `APPROVED`
- `RUNNING`
- `VERIFYING`
- `SUCCEEDED`
- `COMMIT_PENDING`
- `COMMITTED`
- `FAILED`
- `REJECTED`
- `CANCELLED`

说明：

- `retryCodeTask` 语义为“创建子任务并进入新一轮执行”，而不是让旧任务状态回退
- `pause` 动作在当前稳定步骤结束后落到 `PAUSED`
- `resumeRun(runId)` 不要求调用方指定目标状态；Orchestrator 必须根据已持久化的 `pausedAtStage / currentStage / checkpoint` 自动恢复
- Run 状态是聚合视图，不逐个暴露每个 CodeTask 的内部状态

## 6. 关键接口

```ts
export interface Orchestrator {
  startRun(input: RunRequest): Promise<Run>;
  resumeRun(runId: string): Promise<void>;
  pauseRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  retryAnalysis(runId: string, testcaseId: string): Promise<void>;
  approveCodeTask(taskId: string): Promise<void>;
  rejectCodeTask(taskId: string): Promise<void>;
  executeCodeTask(taskId: string): Promise<void>;
  retryCodeTask(taskId: string): Promise<void>;
  cancelCodeTask(taskId: string): Promise<void>;
}
```

## 7. 超时与恢复策略

建议至少定义：

- `test runner` 超时
- `trace/log` 查询超时
- `AI analysis` 超时
- `harness session` 超时
- `verify` 超时

要求：

- 超时必须落事件
- 超时后进入明确状态
- 可恢复超时允许用户显式重试

推荐映射：

- `test runner` 超时
  - Run 进入 `FAILED`
- `trace/log` 查询超时
  - 写 `RUN_STEP_DEGRADED`，继续后续流程
- `AI analysis` 超时
  - 写 `RUN_STEP_DEGRADED`，Run 可进入 `COMPLETED`，但不生成新的 CodeTaskDraft
- `harness session` 超时
  - 若绑定 run exploration，则当前 run 进入 `FAILED`
  - 若绑定 code repair，则当前 CodeTask 进入 `FAILED`
- `verify` 超时
  - CodeTask 进入 `FAILED`

`timeout_at` 语义：

- Run/CodeTask 进入带超时预算的活跃阶段时，Orchestrator 负责写入下一次超时截止时间
- `TimeoutPolicy` 在每次状态推进、恢复和关键子步骤完成后检查 `timeout_at`
- 第一阶段不要求独立后台定时器；超时检测可绑定在状态推进与轮询触发点

## 7.1 PLANNING_EXPLORATION 职责

- 汇总 `runMode`、`selector`、`startUrls`、`focusAreas`、历史 findings 与 regression 结果
- 归一化 exploration budget，并生成首轮 probe plan
- 创建 Harness session 与初始 policy snapshot

失败处理：

- 参数或 policy 归一化失败：Run 进入 `FAILED`
- Harness session 初始化失败：Run 进入 `FAILED`
- 可恢复的 planning 依赖错误：写 `RUN_STEP_DEGRADED` 后进入 `FAILED`，不允许跳过 planning 直接开始 exploration

## 7.2 多 CodeTask 与 Run 聚合规则

- 同一 run 可以关联多个 CodeTask
- `AWAITING_CODE_ACTION` 表示“至少存在一个待 approve / execute / retry 的 CodeTask”
- `AWAITING_REVIEW` 表示“至少存在一个待 review 的 CodeTask，且当前没有正在执行的 code task”
- 某个 CodeTask 执行 `review retry` 并创建子任务后：
  - 新 task 进入 `PENDING_APPROVAL`
  - 若不存在其他更高优先级的待 review / 待 commit 任务，则 Run 聚合状态回到 `AWAITING_CODE_ACTION`
- Run 是否进入 `READY_TO_COMMIT` / `COMPLETED`，由是否仍存在待 review、待执行或待 commit 的 CodeTask 聚合决定

## 7.3 ExecutionReportBuilder 聚合职责

- 在 Run 进入终态时读取 `test_results`、`api_call_records`、`ui_action_records`、`flow_step_records`
- 聚合 `flowSummaries`、`totals`、`failureReports`、`codeTaskSummaries`
- 产出完整 `ExecutionReport` JSON，并写入 `runs/<runId>-execution-report.json`
- 同时向 `execution_reports` 表写入索引记录

## 8. 设计约束

- 状态推进必须持久化
- 所有状态切换必须写事件
- 外部依赖失败应降级，不直接污染原始执行结果
- 可恢复接口错误需记录 `RUN_STEP_DEGRADED` 并继续后续可执行步骤
- 仅在 blocking 错误时终止 run
- Run 进入终态时必须生成执行报告并写 `EXECUTION_REPORT_CREATED`
