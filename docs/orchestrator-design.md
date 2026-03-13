# Orchestrator 详细设计

## 1. 模块目标

`orchestrator` 是系统的状态推进核心，负责驱动 `Run` 和 `CodeTask` 生命周期，并在可审批节点停下等待用户动作。

## 2. 核心职责

- 创建和更新 `Run`
- 驱动测试执行、诊断查询、AI 分析
- 创建 `CodeTask`
- 协调 pause、resume、cancel、retry
- 写入 `run_events`

## 3. 状态推进

`RunStatus`：

- `CREATED`
- `RUNNING_TESTS`
- `COLLECTING_ARTIFACTS`
- `FETCHING_TRACES`
- `FETCHING_LOGS`
- `ANALYZING_FAILURES`
- `AWAITING_CODE_ACTION`
- `RUNNING_CODE_TASK`
- `AWAITING_REVIEW`
- `READY_TO_COMMIT`
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

## 4. 关键接口

```ts
export interface Orchestrator {
  startRun(input: RunRequest): Promise<Run>;
  resumeRun(runId: string): Promise<void>;
  pauseRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  approveCodeTask(taskId: string): Promise<void>;
  executeCodeTask(taskId: string): Promise<void>;
}
```

## 5. 设计约束

- 状态推进必须持久化
- 所有状态切换必须写事件
- 外部依赖失败应降级，不直接污染原始执行结果
