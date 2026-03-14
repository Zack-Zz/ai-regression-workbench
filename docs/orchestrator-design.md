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
- `CodeAgent`
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

## 8. 设计约束

- 状态推进必须持久化
- 所有状态切换必须写事件
- 外部依赖失败应降级，不直接污染原始执行结果
- 可恢复接口错误需记录 `RUN_STEP_DEGRADED` 并继续后续可执行步骤
- 仅在 blocking 错误时终止 run
- Run 进入终态时必须生成执行报告并写 `EXECUTION_REPORT_CREATED`
