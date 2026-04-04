# Agent Harness 详细设计

## 1. 模块目标

`AgentHarness` 是系统里的 Agent runtime 容器，不负责具体业务目标本身，而负责把不同类型的 agent 放到受控、可观测、可回放的执行环境中。

当前它主要支撑两类 agent：

- `ExplorationAgent`
- `CodeRepairAgent`

注意：

- `CodexCliAgent` 与 `KiroCliAgent` 是 transport，不是完整 runtime
- `apps/cli` 里的 service 负责任务生命周期推进，不等于 agent runtime

---

## 2. 当前包边界

`packages/agent-harness` 现阶段采用“同包内分层”的结构，而不是独立拆成多个 package。

### 2.1 稳定子入口

推荐导入入口：

- `@zarb/agent-harness/runtime`
- `@zarb/agent-harness/exploration`
- `@zarb/agent-harness/code-repair`

### 2.2 顶层入口策略

`@zarb/agent-harness` 顶层入口当前仍保留，但只作为兼容 re-export 层。

约束：

- 新代码不要再从顶层混合入口拿所有能力
- 调用方应能明确表达自己依赖的是 runtime、exploration 还是 code-repair

---

## 3. Runtime 负责什么

`runtime/` 负责：

- session 生命周期
- tool 注册与调用
- policy enforcement
- context assembly
- 近似 token budget / budget snapshot 等共享长流程运行时工具
- observability / trace 适配
- diff / patch / verify 产物生成

`runtime/` 不负责：

- exploration 的浏览器策略
- code repair 的 prompt 语义
- review / commit 的业务决策
- run / code task 的状态机推进

这些职责分别归属：

- `exploration/`
- `code-repair/`
- `ReviewManager`
- `apps/cli` / `Orchestrator`

---

## 4. 核心对象

### 4.1 AgentProfile

`AgentProfile` 描述 agent 的角色和基础执行属性。

当前字段：

- `role`
- `name`
- `description`
- `toolNamespaces`
- `maxTurns`
- `reviewOnVerifyFailureAllowed`

当前 profile 是轻量版本，只承担运行时分类，不承载参考项目那种重型配置装配。

### 4.2 HarnessSessionManager

负责：

- session 创建
- step 记录
- prompt sample 记录
- tool call 记录
- approval / checkpoint 元数据持久化

要求：

- session 级事实必须以持久化记录为准
- prompt 与 tool 调用必须能回放

### 4.3 HarnessPolicy

当前 policy 覆盖：

- `sessionBudgetMs`
- `toolCallTimeoutMs`
- `allowedHosts`
- `allowedWriteScopes`
- `requireApprovalFor`
- `reviewOnVerifyFailureAllowed`
- `stopConditions`

其中：

- exploration 默认偏只读
- code repair 允许在受控 workspace 下落地修改

### 4.4 ToolRegistry

`ToolRegistry` 当前以 `ToolDescriptor` 为核心：

- `handler`
- `isReadOnly`
- `isConcurrencySafe`
- `summarizeResult`
- `modifyContext`

它负责：

- policy gate
- timeout
- 调用摘要
- 工具调用记录

### 4.5 ToolExecutionPlanner

Planner 基于 `ToolDescriptor` 做批次拆分：

- 并发安全的只读工具并发执行
- 非并发安全或写入工具串行执行
- tool result 可通过 `modifyContext` 回流到下一步上下文
- 并发读批次里的 `modifyContext` 会在整批完成后按调用声明顺序回放，而不是按完成先后即时写回

当前它已经足够支撑 memory selection 这类场景，但还不是完整的通用工具编排中心。

### 4.5.1 Shared Budget Helpers

`runtime/budget.ts` 现在开始承接两个 agent 都会用到的共享预算工具：

- 近似 token 估算
- budget exceeded 判断
- 通用 budget snapshot 组装

当前 `ExplorationAgent` 与 `CodeRepairAgent` 都已经开始复用这层，而不是各自维护完全独立的 token 估算和 snapshot 拼装逻辑。

### 4.6 AgentContextAssembler

当前主要服务于 code repair：

- 把 `CodeTaskRow`
- `AnalysisRow`
- verify 结果
- relevant memories

组装成稳定的 `CodeRepairContext`，供 prompt builder 和 runtime 使用。

### 4.7 ArtifactWriter

产物写入始终以系统计算结果为准，而不是 agent 自报。

当前负责：

- raw output
- diff
- patch
- verify output
- changed files
- code repair runtime summary

其中 `runtime-summary.json` 是当前 code repair 的结构化可观测工件，包含：

- final status / stop reason / budget snapshot
- 每轮 attempt 的 plan、retry strategy、verification verdict
- 每轮 attempt 的 task ledger 与 changed files

这个摘要的目标不是替代 session trace，而是给 `CodeTaskDetail` 和本地 UI 一个稳定、低成本的“当前 agent 是怎么想和怎么停下来的”视图。

相对地，run 侧的 session replay 现在开始直接读取 `agent-traces/<sessionId>/` 下的：

- `context-summary.json`
- `steps.jsonl`
- `tool-calls.jsonl`
- `prompt-samples.jsonl`

也就是说，当前系统已经同时具备：

- 面向 code repair 的 `runtime-summary.json`
- 面向通用 harness session 的 replay 视图

### 4.8 ReadOnlyPlanAgent

`ReadOnlyPlanAgent` 是 code repair 里的只读规划角色。

职责：

- 从 `CodeRepairContext` 提炼 critical files
- 生成最小修改策略摘要
- 生成执行 checklist

约束：

- 不执行写入
- 不决定最终成功与否
- 其输出作为 apply prompt 和 review trace 的结构化输入

### 4.9 VerificationAgent

`VerificationAgent` 是 code repair 里的独立验证复盘角色。

职责：

- 读取系统 verify 结果、changed files 和 plan
- 生成 adversarial checks
- 给出 `pass / retry / review` verdict
- 在失败时生成 retry prompt

约束：

- verdict 不直接覆盖 `CodeTaskStatus`
- `CodeTask` 的成功与否仍由系统 verify 决定
- 它负责的是“解释验证结果并给出下一步建议”，不是执行业务状态机

### 4.10 CodeRepairTaskLedger

`CodeRepairTaskLedger` 把 code repair 内部步骤显式化。

当前固定任务：

- `memory-selection`
- `plan`
- `apply`
- `verify`
- `retry-decision`

作用：

- 避免内部阶段只存在于 prompt 语义中
- 为 session trace 和后续自动重试提供稳定结构
- 让 verification 不再只是“失败后记一条日志”

---

## 5. Exploration 如何挂在 Harness 上

### 5.1 当前模块

exploration 领域已拆成：

- `action-utils`
- `prompt-builder`
- `finding-extractor`
- `browser-adapter`
- `brain`
- `auth-flow`
- `execution`
- `heuristics`
- `orchestration`
- `page-state`
- `recent-context`
- `types`

### 5.2 当前关系

`ExplorationAgent` 是 orchestration 外壳，实际依赖：

- `ExplorationBrain`
- `ExplorationAuthFlow`
- `ExplorationFindingExtractor`
- `PlaywrightExplorationBrowserAdapter`

此外，exploration 的 budget snapshot 现在已经直接复用 runtime 层的共享类型，而不是再定义第二份结构。

共享类型现在由 `exploration/types.ts` 统一提供：

- `PageProbe`
- `ExplorationStep`
- `ExplorationResult`
- `ExplorationBrainPlan`
- prompt context types

这层类型抽取之后，`exploration/*` 子模块已经不再反向 import `exploration-agent.ts`。

另外，主类文件对外保留的 prompt 构建出口已经改成兼容代理，真正的 prompt 组装只保留在 `prompt-builder.ts`，不再在主类中维护第二份实现。

同时，`exploration/heuristics.ts` 现在统一承载 page/auth/url 相关的纯规则：

- login page 判断
- no-script banner 判断
- auth network error 判断
- fallback planning heuristics
- allowed host 与 candidate URL 归一化

另外，`recent-context.ts`、`action-utils.ts`、`page-state.ts` 也已经从主类中抽出，分别负责：

- recent list 裁剪
- click/navigation 相关的 selector/url 归一化
- step trace page snapshot 组装

`orchestration.ts` 则开始承接 exploration 主循环中纯编排性质的规则：

- session policy 组装
- contextRefs 默认值组装
- loop state 初始化
- planning trigger 判断
- decision prompt context 组装
- preferred-action policy guard
- session step record 组装

`brain-runner.ts` 则开始承接 brain 前后的 trace 粘合层：

- planning pending trace
- decision pending / ok trace
- brain 输出到 loop state 的最小状态回写

`budget.ts` 则开始承接 exploration 的长流程上下文预算控制：

- approximate token budget 估算
- auto compact carry-over
- token budget exhausted stop
- budget snapshot 生成

`lifecycle.ts` 则开始承接 loop 尾部和 run 结束时的生命周期处理：

- session step append
- onStep / stepIndex advance
- runtime cleanup
- final summary / result return

`execution.ts` 则开始承接 exploration 主循环里可独立测试的执行分支：

- auth gate handling
- navigate pass
- navigate decision guard / reroute
- findings persistence / dedupe
- planned login handling
- interactive action execution
- action failure recover / replan
- post-action state capture

当前 exploration runtime 还额外具备一套轻量长流程控制：

- `ExplorationConfig.approxTokenBudget`
- `ExplorationConfig.enableAutoCompact`
- `ExplorationConfig.maxCompactions`
- compact 后把摘要注入后续 planning / decision prompt
- run 结束时返回 budget snapshot

### 5.3 当前限制

虽然已接入新模块，而且 `auth gate / navigate / findings / plan / decide / login / interactive action / step commit / finalization` 主链已经收口到模块实现，但 `ExplorationAgent` 主文件中仍保留：

- 顶层 `while` 循环
- `probe` fallback 兼容路径
- 最终的分支调度与收尾粘合层

因此当前设计判断是：

- 分层方向已正确
- 主类已经明显变薄，但还没有彻底收成极薄 orchestration shell

---

## 6. Code Repair 如何挂在 Harness 上

### 6.1 当前模块

`code-repair/` 当前包含：

- `CodeRepairAgent`
- `CodeRepairPromptBuilder`
- `CodeTaskMemory`
- `ReadOnlyPlanAgent`
- `VerificationAgent`
- `CodeRepairTaskLedger`

transport 单独位于：

- `CodexCliAgent`
- `KiroCliAgent`

### 6.2 当前执行模型

`CodeRepairAgent` 当前是一个有限预算的自治 loop：

```text
memory select
  -> context assemble
  -> ReadOnlyPlanAgent
  -> 生成 structured retry strategy
  -> plan prompt/sample
  -> apply prompt + transport.run
  -> verify prompt/sample
  -> 系统 verify
  -> VerificationAgent review
  -> 失败沉淀 verify-failure / retry-decision memory
  -> 若近似 token budget 紧张，则先 auto compact 前序失败上下文
  -> 下一轮优先注入 compacted carry-over memory，并屏蔽同任务旧的 verbose failure memory
  -> compact 后仍超预算，才停止下一轮 retry
  -> 若 verdict=retry 且预算未耗尽，则进入下一轮 apply
  -> 若连续失败且 verify 信号无变化，则提前触发 no-progress stop
  -> final stop hook 记录最终 stop summary 与 budget snapshot
```

### 6.3 设计原则

- transport 只负责执行
- runtime 负责上下文、prompt、memory、记录、只读计划、验证复盘和有限预算内的自动 retry
- runtime 负责把 compact carry-over 和 failure memory 转成结构化 retry strategy，而不是只把 memory 原文交给 transport
- 这个 retry strategy 当前已经会指出重复触碰文件、建议扩展的相邻目标，以及 helper-only 这类应避免的窄改动
- 它现在还会识别重复失败信号和 no-op 尝试，避免下一轮只是“换一种说法重试”
- `no progress` 也优先按失败信号而不是整段 verify 输出全文比较，从而过滤掉日志噪音
- apply prompt 当前已经把 `Critical Files`、`Checklist`、`Retry Strategy` 独立展开，减少 transport 只从长 summary 里自行提炼的负担
- verify 结果由系统统一生成
- review / commit 不在 runtime 内决定
- retry-decision 需要区分四类真实结果：继续自动 retry、因 no-progress 停止、因 attempt budget exhausted 停止、因 token budget exhausted 停止

---

## 7. 与业务服务的关系

`apps/cli` 中的服务仍然是业务编排层。

职责划分：

- `CodeTaskService`
  负责 `CodeTask` 状态推进、artifact 落盘、review 前后衔接
- `RunService`
  负责 run 生命周期和 exploration 调度
- `ReviewManager`
  负责 review / commit 语义
- `AgentHarness`
  负责 agent runtime 的执行容器

原则：

- harness 不接管业务状态机
- service 不接管 agent 的上下文拼装和内部思考

---

## 8. 当前设计约束

1. 所有具备工具权限的 agent 都必须通过 harness 运行
2. runtime 产物必须可回放、可审计
3. 顶层兼容入口不应再成为默认依赖方式
4. tool result 与系统产物必须区分清楚
5. code repair 的成功与否必须以系统 verify 为准
6. `ReadOnlyPlanAgent` 与 `VerificationAgent` 都是只读角色，不直接写工作区

---

## 9. 当前未完成项

以下内容属于后续增强，不应在设计口径里写成“已完成”：

- exploration 主类进一步收成极薄 shell，继续下沉顶层 loop 的最后一层调度粘合
- session replay 目前已覆盖 context refs、steps、tool calls、prompt samples，但还没有统一纳入 screenshot / network 回放视图
- code repair 的更强 auto compact 策略 / 更强 stop hooks
- 只读子 agent / forked subtask
- pause / resume checkpoint 恢复
- 完整多模型分工与更细粒度 profile 装配
