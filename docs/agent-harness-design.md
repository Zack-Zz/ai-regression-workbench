# Agent Harness 详细设计

## 1. 目标

`AgentHarness` 是包裹 Agent 的运行时外壳，不负责业务决策本身，而负责让 Agent 在真实环境里安全、稳定、可回放地运行。

第一阶段目标：

- 统一托管 `ExplorationAgent` 与 `CodeAgent`
- 管理上下文、工具、权限、审批、重试、checkpoint、trace
- 让 Agent 能被暂停、恢复、取消、审计

## 2. 边界

`Harness` 负责：

- 上下文拼装
- Tool registry
- 权限策略与 approval gate
- session 生命周期
- checkpoint / replay / eval 入口
- tool call 日志、trace、预算消耗

`Harness` 不负责：

- 业务状态机推进
- failure analysis prompt 细节
- review / commit 业务决策
- 直接定义 testcase、CodeTask 的业务语义

这些能力分别属于：

- `Orchestrator`
- `AIEngine`
- `ReviewManager`
- 领域模型 / App Services

## 3. 核心对象

### 3.1 AgentSession

表示一次被 Harness 托管的 Agent 执行会话。

建议字段：

- `sessionId`
- `runId`
- `taskId?`
- `agentName`
- `kind: 'exploration' | 'code-repair'`
- `status`
- `policyJson`
- `checkpointId?`
- `tracePath`
- `startedAt`
- `endedAt?`
- `summary?`

### 3.2 HarnessPolicy

建议覆盖：

- `sessionBudgetMs`
- `toolCallTimeoutMs`
- `stopConditions?`
- `allowedHosts`
- `allowedWriteScopes`
- `requireApprovalFor`
- `reviewOnVerifyFailureAllowed`

其中 `stopConditions` 建议至少支持：

- `maxFindings?: number`
- `stopWhenFocusAreasCovered?: boolean`
- `stopWhenNoNewFindingsForSteps?: number`

### 3.3 ToolCallRecord

建议字段：

- `sessionId`
- `stepIndex`
- `toolName`
- `inputSummary`
- `resultSummary`
- `durationMs`
- `status`
- `approvalId?`

## 4. Tool Registry

第一阶段建议工具按能力域分组：

- `playwright.*`
  页面打开、点击、输入、抓 DOM、截图、trace、network 摘要
- `fs.*`
  受限文件读写
- `git.*`
  diff、status、branch、commit 前检查
- `shell.*`
  受限 verify 命令
- `diagnostics.*`
  trace / logs 查询

约束：

- Agent 不直接拿到 Node.js 原生能力
- 所有外部能力都必须通过 Tool Registry 暴露
- 工具调用统一经过 policy + logging + timeout

## 5. 审批与权限

运行时审批和业务审批分开：

- 运行时审批
  由 Harness 控制，例如外部 URL、写业务代码、执行高风险 shell
- 业务审批
  由 `Orchestrator / ReviewManager` 控制，例如 approve CodeTask、accept review、commit

默认审批策略：

- `exploration` 默认只读
- 写测试代码需要在允许 scope 内
- 写业务代码默认需要更高权限和显式审批
- `git commit` 不由 Harness 直接做业务决策

## 6. 与 Agent 的关系

### 6.1 ExplorationAgent

角色：

- 决定探测目标、下一步探针和停止条件
- 调用 `playwright.*`、`diagnostics.*` 等工具
- 输出 finding 和候选测试线索

停止条件要求：

- 先满足硬预算约束：`sessionBudgetMs / maxSteps / maxPages`
- 再结合软停止策略：`stopConditions`
- 若 regression/hybrid 已提供失败线索，应优先覆盖失败相关页面、接口和 `focusAreas`
- 当当前 step 未产生新的 finding，且连续达到 `stopWhenNoNewFindingsForSteps` 时可提前停止

### 6.2 CodeAgent

角色：

- 生成 plan
- 在允许 scope 内改代码
- 运行 verify

要求：

- 不以 agent 自报结果为唯一事实来源
- 变更结果以 Harness 统一生成的 diff / patch / verify 为准

## 7. Checkpoint / Replay / Eval

第一阶段至少要保留：

- session 上下文摘要
- step 级 tool call 记录
- approval 记录
- 关键产物引用

用途：

- 失败恢复
- 结果回放
- prompt / policy 调优
- 后续评测

## 8. 持久化建议

建议落盘：

- `agent_sessions` 表
- `agent-traces/<sessionId>/context-summary.json`
- `agent-traces/<sessionId>/steps.jsonl`
- `agent-traces/<sessionId>/tool-calls.jsonl`

对于 CodeTask：

- `code_tasks.harness_session_id`
  记录最终执行所关联的 session

## 9. 设计约束

- 所有具备工具权限的 Agent 都必须通过 Harness 运行
- Harness 必须支持 pause / resume / cancel
- Harness 必须把 tool call、approval、checkpoint 持久化
- Harness 失败不能破坏已有业务产物
- Harness 不应变成新的业务编排器，业务状态机仍由 Orchestrator 主导

## 10. Pause / Resume 协议

- Orchestrator 发起 `pauseRun` 或 `pauseCodeTask` 时，Harness 进入 `pause-requested`
- Harness 不应粗暴中断当前 tool call；应等待当前 step 在安全点结束
- 当前 step 结束后，Harness 必须：
  - 持久化 checkpoint
  - 写入最后一个 `tool-call` / `step` 结果
  - 回传 `pausedAtStage`
- Orchestrator 收到确认后把 Run/CodeTask 置为 `PAUSED`
- `resumeRun(runId)` / `resumeSession(sessionId)` 的语义都是“从最近 checkpoint 继续”，恢复目标由系统根据 `pausedAtStage` 自动决定
