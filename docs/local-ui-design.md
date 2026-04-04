# Local UI 详细设计

## 1. 模块目标

`local-ui` 是本地可视化控制台，负责展示状态并发起控制动作。

产品定位：

- Web UI 不是单纯的 report viewer，而是工作台
- 当前版本所有业务操作与结果查看都在 HTML Web UI 完成
- CLI 当前仅承担初始化、诊断、启动 UI，并保留后续扩展能力

## 2. 推荐技术栈

- React
- Vite
- TypeScript

## 3. 页面结构

- `HomePage`
- `CodeTaskListPage`
- `RunListPage`
- `RunDetailPage`
- `ExecutionReportPage`
- `TestcaseExecutionPage`
- `FailureReportPage`
- `CodeTaskDetailPage`
- `ReviewCommitPanel`
- `SettingsPage`

## 3.1 全局导航与设置入口

导航与入口约束：

- 主导航仅包含业务页面：`Home / Run List / Run Detail / Failure Report / CodeTask Detail / Review / Commit`
- 导航中不包含 `Settings`
- 每个页面右上角都提供独立 `Settings` 按钮，点击后跳转到设置页
- `SettingsPage` 是独立页面路由
- 从设置页返回其他页面通过主导航菜单完成

## 3.2 首页信息架构

首页建议包含：

- `WorkspaceBar`
- `QuickRunPanel`
- `ActiveRecentRuns`
- `ActionInbox`
- `SystemNotices`

`QuickRunPanel` 第一阶段建议支持：

- `runMode` 选择：`regression | exploration | hybrid`
- `selectorType` 选择：`suite | scenario | tag | testcase`
- `selectorValue` 输入（用于 `regression / hybrid`）
- `startUrls`、`allowedHosts`、`maxSteps / maxPages`、`focusAreas`（用于 `exploration / hybrid`）
- 提交前展示当前 `target workspace`、共享测试目录状态与预计权限级别

交互约束：

- 当 `runMode=regression` 时，必须选择 `selectorType` 并填写对应 `selectorValue`
- 当 `runMode=hybrid` 时，同时展示 `selectorType/selectorValue` 与 exploration 参数
- UI 负责把 `selectorType + selectorValue` 映射成 `StartRunInput.selector`
  - `suite` -> `selector.suite`
  - `scenario` -> `selector.scenarioId`
  - `tag` -> `selector.tag`
  - `testcase` -> `selector.testcaseId`

## 3.3 错误报告与修复情况展示

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
- Harness session / agent 名称
- 选中的 agent
- 修复目标和作用范围
- changed files
- diff / patch
- verify 结果
- review 决策记录
- commit 记录

执行报告建议展示：

- run 模式（`regression / exploration / hybrid`）
- run 范围（scopeType / scopeValue）
- 当前执行阶段（`currentStage`）
- 总量统计（流程步骤数、点击数、接口数、失败接口数）
- exploration findings 摘要与 candidate tests 入口
- 阶段结果（success / degraded / failed / skipped）
- 阶段结果必须以进度视图呈现，明确高亮当前阶段，而不是只显示静态表格
- 活跃 run 页面中，执行报告与阶段结果需要跟随 SSE / 轮询自动刷新
- degraded 步骤与原因
- 最终失败原因（若存在）
- 报告与产物链接（trace、logs、diff、patch、verify）
- agent sessions 列表（agentName、kind、status、startedAt、endedAt、summary）
- session replay 入口，至少能查看 context refs、session steps、tool calls、prompt samples
- 流程链路摘要（每条链路步骤数、点击数、接口数、耗时）
- testcase 级执行明细入口（接口表、点击时间线、流程步骤时间线）
- 接口表建议至少展示 method、url、statusCode、responseSummary、durationMs、errorMessage

## 3.4 设置页（SettingsPage）

设置页定位：

- 独立页面，不与 Home 面板混排
- 统一承载“当前项目个人配置”
- 保存后立即生效，并反馈受影响模块

建议分组：

- `Storage`（sqlitePath、artifactRoot、diagnosticRoot、codeTaskRoot）
- `Workspace`（目标目录、gitRootStrategy）
- `Test Assets`（sharedRoot、generatedRoot、执行开关）
- `Diagnostics`（correlation keys、time window）
- `Trace / Logs`（provider、endpoint、limit）
- `AI / Code Repair`（model、审批默认策略、verify 命令）
- `Report / UI`（端口、语言）

交互要求：

- 进入页面先拉取当前配置快照（带 `version`）
- 页面需要展示“查看当前配置 + 保存配置”两个核心能力
- 每个配置项按 `key / value / description` 同行展示，`description` 紧邻配置 key
- 支持“先校验再保存”
- 保存时携带 `expectedVersion` 防并发覆盖
- 保存成功后展示 `reloadedModules` / `nextRunOnlyKeys`
- 若 `report.port` 更新，前端提示“重启本地服务后生效”，不自动跳转
- `storage.artifactRoot / diagnosticRoot / codeTaskRoot` 保存后对后续新写入即时生效，不要求迁移历史文件

## 3.5 多语言与文案规范（i18n）

第一阶段要求：

- 页面级 UI 元素必须支持中英文（`zh-CN` / `en-US`）
- 导航菜单只展示菜单名称，不展示描述文案
- 各页面模块标题与模块说明支持随 `ui.locale` 切换
- 每个配置项的 `description` 文案支持多语言
- 缺失翻译时回退到 `zh-CN` 并记录 `warnings`

## 4. 核心组件

- `EventTimeline`
- `ExecutionReportPanel`
- `FlowSummaryPanel`
- `ApiCallTable`
- `UiActionTimeline`
- `FlowStepTimeline`
- `DiagnosticsPanel`
- `ReviewPanel`
- `CommitPanel`
- `FailureReportCard`
- `CodeChangeSummary`
- `WorkspaceBar`
- `QuickRunPanel`
- `ActionInbox`
- `SettingsForm`
- `SettingsSection`
- `SettingsApplyResultBanner`

## 5. 推荐接口

- `GET /workspace`
- `POST /workspace`
- `GET /settings`
- `POST /settings/validate`
- `PUT /settings`
- `GET /runs`（支持 `cursor`、`limit`、`status`、`runMode`）
- `GET /runs/:runId`
- `GET /runs/:runId/sessions`
- `GET /runs/:runId/sessions/:sessionId/replay`
- `GET /runs/:runId/execution-report`
- `GET /runs/:runId/events`
- `GET /runs/:runId/findings`（后续可选；第一阶段先内嵌在 `RunDetail`）
- `GET /runs/:runId/failure-reports`
- `GET /runs/:runId/testcases/:testcaseId/failure-report`
- `GET /runs/:runId/testcases/:testcaseId/execution-profile`
- `GET /runs/:runId/testcases/:testcaseId/diagnostics`
- `GET /runs/:runId/testcases/:testcaseId/trace`
- `GET /runs/:runId/testcases/:testcaseId/logs`
- `GET /runs/:runId/testcases/:testcaseId/analysis`
- `GET /code-tasks/:taskId`
- `GET /code-tasks`（支持 `cursor`、`limit`、`status`、`runId`）
- `GET /code-tasks/:taskId/review`
- `GET /code-tasks/:taskId/commit`
- `POST /runs`
- `POST /runs/:runId/pause`
- `POST /runs/:runId/resume`
- `POST /runs/:runId/cancel`
- `POST /runs/:runId/testcases/:testcaseId/analysis/retry`
- `POST /code-tasks/:taskId/approve`
- `POST /code-tasks/:taskId/reject`
- `POST /code-tasks/:taskId/execute`
- `POST /code-tasks/:taskId/retry`
- `POST /code-tasks/:taskId/cancel`
- `POST /reviews`
- `POST /commits`

事件时间线读取协议：

- `GET /runs/:runId/events` 支持 `cursor`、`limit` 参数做增量拉取
- 响应建议返回 `items[] + nextCursor`，前端用于持续刷新时间线
- 活跃 run 页面默认每 `2-3s` 轮询一次
- run 进入终态后停止轮询
- `GET /runs/:runId/events/stream`（SSE）仅作为后续增强，不作为第一阶段主依赖

## 5.1 错误状态与性能约束

第一阶段必须补齐：

- 统一错误展示组件
- 对 `ActionResult.errorCode` 的文案映射
- run 失败、code task 失败、配置校验失败时的明确操作入口
- verify override review 的风险提示与确认动作

大数据量场景必须考虑：

- `ApiCallTable` 分页或虚拟滚动
- `EventTimeline` 增量加载
- 页面离开时停止轮询

## 6. 设计约束

- UI 不直接访问 SQLite
- UI 由状态机驱动，不自行推导业务状态
- 第一版优先保证可观测性和控制能力，而不是复杂交互
- UI 需要明确展示当前 `target workspace`
- 设置页保存必须走后端校验与生效流程，前端不可本地硬改运行配置
- 当前阶段 run/diagnostics/review/commit/settings 的操作与查看统一在 HTML 页面，不提供 CLI 业务操作界面
- Run 与 CodeTask 详情必须明确展示 `runMode / scope / agent / harness / verify override` 等关键审计信息
