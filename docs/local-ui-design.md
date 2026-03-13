# Local UI 详细设计

## 1. 模块目标

`local-ui` 是本地可视化控制台，负责展示状态并发起控制动作。

## 2. 推荐技术栈

- React
- Vite
- TypeScript

## 3. 页面结构

- `RunListPage`
- `RunDetailPage`
- `CodeTaskDetailPage`
- `ReviewCommitPanel`

## 3.1 错误报告与修复情况展示

`local-ui` 第一版必须能直接展示错误报告和修复情况，而不只是显示状态。

错误报告建议展示：

- 失败 testcase 基本信息
- 错误类型与错误消息
- screenshot / video / trace.zip / network log
- `CorrelationContext`
- `TraceSummary`
- `LogSummary`
- `FailureAnalysis`

修复情况建议展示：

- `CodeTask` 当前状态
- 目标项目目录
- 选中的 agent
- 修复目标和作用范围
- changed files
- diff / patch
- verify 结果
- review 决策记录
- commit 记录

## 4. 核心组件

- `EventTimeline`
- `DiagnosticsPanel`
- `ReviewPanel`
- `CommitPanel`
- `FailureReportCard`
- `CodeChangeSummary`

## 5. 推荐接口

- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/events`
- `GET /runs/:runId/failure-report`
- `GET /runs/:runId/testcases/:testcaseId/diagnostics`
- `GET /code-tasks/:taskId`
- `GET /code-tasks/:taskId/review`
- `GET /code-tasks/:taskId/commit`
- `POST /code-tasks/:taskId/approve`
- `POST /code-tasks/:taskId/execute`
- `POST /reviews`
- `POST /commits`

## 6. 设计约束

- UI 不直接访问 SQLite
- UI 由状态机驱动，不自行推导业务状态
- 第一版优先保证可观测性和控制能力，而不是复杂交互
- UI 需要明确展示当前 `target workspace`
