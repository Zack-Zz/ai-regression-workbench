# Agent 智能化与运行时分层设计

## 1. 文档目标

本文档只描述当前项目里与 Agent 智能化直接相关的最新设计，不再保留历史执行阶段、任务卡状态或“已完成 Phase X”一类过程性标记。

适用范围：

- `packages/agent-harness`
- `apps/cli/src/services/code-task-service.ts`
- `docs/agent-harness-design.md`
- `docs/code-task-design.md`
- `docs/exploration-design.md`

本文档关注三个问题：

1. 当前 Agent runtime 的真实边界是什么
2. exploration 与 code repair 分别已经落到了什么程度
3. 后续如果继续提升“智能感”，应该沿什么方向演进

---

## 2. 当前设计结论

当前项目已经从“一个混合入口里的 agent 集合”演进到“同包内分层 runtime + exploration + code-repair”的结构，并且 code repair 已经进入有限预算的多轮 runtime。

当前成立的设计结论：

- `agent-harness` 已按 `runtime / exploration / code-repair` 三层拆分
- `runtime` 负责会话、工具、策略、上下文装配、可观测和产物生成
- `exploration` 是浏览器探索领域实现，包含 prompt、brain、auth、finding 抽取、browser adapter
- `code-repair` 是受控修复运行时，负责 memory 选择、只读计划、prompt 组装、transport 执行、验证复盘和失败沉淀
- `code-repair` 现在已经有显式 `ReadOnlyPlanAgent`、`VerificationAgent` 和 task ledger，而不是只靠主 runtime 内部约定阶段
- `runtime` 里已经开始出现跨 agent 共享的长流程基础件，例如近似 token budget / budget snapshot 工具
- `code-repair` 的 budget snapshot 现在也显式带上 `maxCompactions`，开始和 exploration 对齐预算视图
- `CodeTaskDetail` 已可直接查看 `runtime-summary.json`，`RunDetailPage` 已可直接查看 harness session replay
- 顶层 `@zarb/agent-harness` 入口仍保留兼容 re-export，但新代码应优先使用子入口

当前不应被高估的部分：

- `CodeRepairAgent` 已经具备有限预算内的 `plan -> apply -> verify -> retry -> reapply` 循环，也已经具备近似 token budget、auto compact 和 final stop hooks，但还不是带 side agent 的完整长程自治 runtime
- `ExplorationAgent` 已经把 plan / decide / login / navigation / action / lifecycle 主链收口到 `brain / auth-flow / execution / orchestration / lifecycle / budget` 模块；主类里剩余的主要是顶层 loop、fallback probe 兼容路径和最后的分支调度，还没有完全迁空
- tool orchestration 已有 descriptor 和 batch planner，但还不是完整的通用工具生态
- forked read-only subtasks、更强的 auto compact 策略、更强的 turn-end hooks 这些 runtime 机制目前仍停留在设计参考层

---

## 3. 代码结构

当前推荐入口：

- `@zarb/agent-harness/runtime`
- `@zarb/agent-harness/exploration`
- `@zarb/agent-harness/code-repair`

当前目录结构：

```text
packages/agent-harness/src/
  runtime/
    agent-context-assembler.ts
    agent-profile.ts
    artifact-writer.ts
    budget.ts
    harness-policy.ts
    observability.ts
    observed-harness.ts
    session-manager.ts
    tool-execution-planner.ts
    tool-registry.ts
  exploration/
    action-utils.ts
    auth-flow.ts
    budget.ts
    brain-runner.ts
    brain.ts
    browser-adapter.ts
    execution.ts
    finding-extractor.ts
    heuristics.ts
    lifecycle.ts
    orchestration.ts
    page-state.ts
    prompt-builder.ts
    recent-context.ts
    types.ts
  code-repair/
    code-repair-agent.ts
    code-task-memory.ts
    plan-agent.ts
    prompt-builder.ts
    task-ledger.ts
    verification-agent.ts
  exploration-agent.ts
  codex-cli-agent.ts
  kiro-cli-agent.ts
  playwright-tool-provider.ts
```

边界约束：

- `runtime` 不承载 exploration 或 code-repair 的领域语义
- `exploration` 依赖 `runtime`，但不反向定义 runtime 规则
- `code-repair` 依赖 `runtime` 和 transport，不直接主导业务状态机
- `apps/cli` 负责任务生命周期推进，不承担 Agent 内部思考逻辑

---

## 4. Runtime 设计

### 4.1 AgentProfile

`runtime/agent-profile.ts` 用统一 profile 描述不同 agent 角色。

当前已定义：

- `EXPLORATION_AGENT_PROFILE`
- `CODE_REPAIR_AGENT_PROFILE`
- `PLAN_AGENT_PROFILE`
- `VERIFICATION_AGENT_PROFILE`

它们目前主要承担：

- 角色标识
- 名称与描述
- tool namespace 归属
- turn 上限
- verify 失败后是否允许 review override

当前 `AgentProfile` 是轻量版本，还没有扩展到参考项目那种 `skills / hooks / permissions / isolation / model routing` 级别。

### 4.2 AgentContextAssembler

`runtime/agent-context-assembler.ts` 负责把 `CodeTaskRow`、`AnalysisRow`、verify 结果、相关 memory 组装成结构化 `CodeRepairContext`。

这一步的作用是把原来“只把 goal 丢给 CLI”的链路升级为“带 task 语义的 prompt 上下文”。

当前已覆盖：

- `goal`
- `workspacePath`
- `scopePaths`
- `constraints`
- `verificationCommands`
- `attempt`
- 失败分析摘要
- relevant memories

### 4.3 Session / Policy / Artifact

`runtime` 目前负责：

- `HarnessSessionManager`
- `ArtifactWriter`
- `HarnessPolicy`
- `ObservedHarness` 与 observability 类型

这层仍是系统里通用的 runtime 基础件，不应该再混入 exploration 或 code repair 的业务判断。

### 4.4 ToolRegistry 与 ToolExecutionPlanner

当前 `ToolRegistry` 已从“只注册 handler”升级为“注册 `ToolDescriptor`”：

- `isReadOnly`
- `isConcurrencySafe`
- `summarizeResult`
- `modifyContext`

`ToolExecutionPlanner` 会按并发安全性把调用分批：

- 并发安全的只读工具并发执行
- 写入或非并发安全工具串行执行
- 同一并发读批次的 `modifyContext` 在批次完成后按声明顺序回放，避免因为完成先后不同导致上下文漂移

这已经足够支撑 memory selection 这类读型工具，但还不是完整的通用工具编排层。

### 4.5 Shared Budget Runtime

`runtime/budget.ts` 现在开始承接跨 agent 共享的预算基础件：

- approximate token estimation
- budget exceeded 判断
- 通用 budget snapshot 组装

这意味着 exploration 和 code-repair 已经不再各自维护完全独立的 token 估算 / snapshot 拼装逻辑，而是开始共享同一套 runtime 底盘。

---

## 5. Exploration 设计

### 5.1 当前分层

exploration 领域已经拆出以下模块：

- `action-utils.ts`
- `execution.ts`
- `prompt-builder.ts`
- `finding-extractor.ts`
- `browser-adapter.ts`
- `brain.ts`
- `auth-flow.ts`
- `heuristics.ts`
- `orchestration.ts`
- `page-state.ts`
- `recent-context.ts`
- `types.ts`

这些模块现在已经被 `ExplorationAgent` 实际使用，而不是只停留在目录层面。

同时，exploration 共享领域类型也已经集中到了 `exploration/types.ts`：

- `PageProbe`
- `ExplorationStep`
- `ExplorationResult`
- `ExplorationBrainPlan`
- prompt context types

这意味着 `brain / prompt-builder / browser-adapter / finding-extractor / playwright-tool-provider` 不再反向 import `exploration-agent.ts` 来拿共享类型，主类文件不再充当 exploration 的隐式类型中心。

同时，`exploration-agent.ts` 对外保留的 `buildExplorationDecisionPrompt / buildExplorationPlanPrompt` 已经收成兼容薄代理，实际 prompt 组装只保留在 `prompt-builder.ts`。

另外，page/auth/url 相关的共享启发式现在也已经集中到了 `exploration/heuristics.ts`，包括：

- login page 判断
- no-script banner 判断
- auth network error 判断
- URL 归一化与 allowed host 过滤
- fallback planning heuristics

除此之外，exploration 主循环里原本散落在主类文件中的纯辅助逻辑也已经开始下沉为 support 模块：

- `recent-context.ts`
- `action-utils.ts`
- `page-state.ts`

这几块负责 recent list 裁剪、action/url 归一化和 step trace page snapshot 组装，让 `ExplorationAgent` 进一步逼近“只保留 orchestration”的形态。

同时，session/bootstrap 和 planning trigger 这类纯编排规则现在也已经开始下沉到 `exploration/orchestration.ts`，包括：

- exploration session policy 组装
- contextRefs 默认值组装
- loop state 初始化
- planning trigger / planning reason 判断
- decision prompt context 组装
- preferred-action policy guard
- session step record 组装

另外，`exploration/brain-runner.ts` 现在开始承接 `brain.plan/decide` 调用前后的 trace 粘合层，当前已覆盖：

- planning pending trace
- decision pending / ok trace
- brain 输出到 loop state 的最小状态回写

另外，`exploration/budget.ts` 现在开始承接 exploration 的长流程上下文预算控制，当前已覆盖：

- approximate token budget 估算
- auto compact carry-over
- token budget exhausted stop
- budget snapshot 生成

其中 snapshot 结构本身已经复用 runtime 层的共享 budget 类型，而不是 exploration 自己再维护第二份形状。

另外，`exploration/lifecycle.ts` 现在开始承接 loop 尾部和 run 结束时的生命周期处理，当前已覆盖：

- session step append
- onStep / stepIndex advance
- runtime cleanup
- final summary / result return

另外，`exploration/execution.ts` 现在开始承接 exploration 主循环里的副作用执行分支，当前已覆盖：

- auth gate handling
- navigate pass
- navigate decision guard / reroute
- findings persistence / dedupe
- planned login handling
- interactive click/fill execution
- action failure 后的 recover / replan
- post-action state capture

### 5.2 当前真实状态

exploration 的目标已经从“纯单步 executor”升级为：

- planner
- executor
- policy guard
- auth recovery
- findings capture

当前已经具备：

- `exploration-plan` / `exploration-decision` prompt 分离
- auth gate 识别、登录恢复与 auth gate 分支回写
- slider captcha 基础自动处理
- recent context 回流
- finding 抽取与持久化
- 近似 token budget 控制、一次 auto compact 和 compact carry-over 注入
- run 结束时返回 budget snapshot
- auth gate、navigation、navigate guard/reroute 与 findings 这几段副作用链已经从主类迁到 `execution.ts`
- decision context、preferred-action guard 和 session step record 这几段编排逻辑已经迁到 `orchestration.ts`
- plan/decide 前后的 trace 粘合层已经迁到 `brain-runner.ts`
- token budget / compact / budget snapshot 这几段长流程控制逻辑已经迁到 `budget.ts`
- step commit、runtime cleanup 和 final result 这几段生命周期逻辑已经迁到 `lifecycle.ts`
- 共享 exploration 类型中心化，子模块对主类文件的反向依赖已消除
- 共享 exploration heuristics 中心化，`brain / prompt-builder / main agent` 不再各自维护一套 page/auth/url 规则

### 5.3 仍未彻底完成的地方

虽然 exploration 主链已经明显模块化，但 `ExplorationAgent` 主类里仍保留顶层循环和最终的分支调度这类最后的 orchestration 粘合层。

因此当前判断应是：

- “模块化已接入”成立
- “主类已经明显变薄”成立
- “主类已经彻底迁空到极薄 shell”不成立

后续如果继续整理 exploration，优先做的不是再加功能，而是删除重复实现，收紧主类职责。

---

## 6. Code Repair 设计

### 6.1 当前执行链

当前 `CodeTaskService -> CodeRepairAgent -> CodexCliAgent/KiroCliAgent` 的链路已经替代了原先的“直接把 goal 丢给 CLI”模式。

当前执行顺序是：

```text
select relevant memories
  -> ReadOnlyPlanAgent
  -> assemble code repair context
  -> build/read-only plan prompt
  -> 生成 plan summary / critical files / checklist 并记录 prompt sample
  -> build apply prompt
  -> transport.run()
  -> build verify prompt 并记录 prompt sample
  -> 系统侧 generateArtifacts / run verify
  -> VerificationAgent 做 adversarial review / retry decision
  -> 失败时写入 verify-failure / retry-decision memory
```

### 6.2 当前已落地能力

当前 `CodeRepairAgent` 已具备：

- task-aware context assembly
- read-only planning summary、critical files、execution checklist
- read-only retry strategy
- staged prompt builder
- relevant memory selection（结合 goal、scope paths、verification commands、testcase）
- transport 执行封装
- explicit task ledger
- apply failure / verify failure / retry decision / review feedback 沉淀
- prompt sample 与 step 记录
- verify 失败后的预算内自动 retry
- 近似 token budget 控制
- token budget 紧张时的 auto compact
- 连续失败且 verify 输出无变化时的 no-progress 提前停止
- final stop hooks 与 budget snapshot

### 6.3 当前明确未落地能力

以下能力还不应写成“已完成”：

- 更强的 auto compact 策略，而不只是把前序失败压缩成 retry memory
- 根据 retry decision 做更强的策略重规划，而不只是再次执行同一主链
- plan / verify / retry 使用独立模型或只读子 agent

所以当前更准确的定位是：

`CodeRepairAgent` 是一个 bounded autonomous loop，不是 full autonomous loop。

---

## 7. Task Memory 设计

`code_task_memories` 已经成为正式持久化对象。

当前落地内容：

- migration
- repository
- memory entry model
- relevance selection
- failure / review feedback 落库

当前 memory 类型：

- `apply-failure`
- `verify-failure`
- `review-feedback`
- `retry-decision`

注意：

- `retry-decision` 现在会在 transport 失败或 verify 失败后落库
- 当前主执行链已经会在同一 `CodeTask` 内消费 retry decision，并在预算内自动开启下一轮 apply
- 预算耗尽后仍会停在 `FAILED`，不会无限重试
- token budget 接近耗尽时会先做一次 auto compact，再决定是否继续下一轮 retry
- compact 后的下一轮会优先注入 compacted carry-over memory，并屏蔽同任务旧的冗长失败 memory
- `ReadOnlyPlanAgent` 会继续把 compact summary 解析成更具体的 retry strategy，例如：
  - 哪些文件在失败尝试里被重复触碰
  - 下一轮应该往哪些相邻 scope/test 扩
  - 是否应避免再次走 helper-only 这类窄改动
- apply prompt 现在会把 `Critical Files`、`Checklist`、`Retry Strategy` 作为独立 section 注入，而不是只依赖 plan summary
- 当连续失败但 verify 信号没有变化时，会比预算耗尽更早停止，避免无效重试

补充约束：

- `retry-decision` 不只是“建议重试”，还需要反映最终自动化决策
- 当前会区分：
  - 自动批准下一轮 retry
  - 因 no progress 停止自动 retry
  - 因 attempt budget exhausted 停止自动 retry
  - 因 token budget exhausted 停止自动 retry

因此 memory 层属于“存储、选择、失败沉淀和有限闭环消费已就位”。

---

## 8. 来自 Claude Code 的新增参考

这轮新增参考里，最值得迁移的不是 prompt 文案，而是运行时机制：

1. 把 `Plan` 和 `Verify` 变成独立角色
2. 把内部步骤变成显式 task ledger，而不是 prompt 里的隐含阶段
3. 把长流程 Agent 做成显式状态机，而不是一个大 `execute()`
4. 在并发读工具里延后 `contextModifier` 回流，保证上下文稳定
5. 为长流程准备 token budget、auto compact、memory relevance selection
6. 为未来只读子 agent 准备 cache-safe fork 和 stop hooks

当前项目与这些参考的关系：

- 已落地：
  - `ReadOnlyPlanAgent`
  - `VerificationAgent`
  - `CodeRepairTaskLedger`
  - code repair 显式 retry loop / 状态推进
  - 并发读批次后的稳定 context 回流
  - 近似 token budget
  - auto compact
  - final stop hooks
- 仍待后续实现：
  - 更强的 auto compact 策略
  - relevance selection 从启发式升级为 header-first + side selection
  - forked read-only subtasks
  - 更强的 turn-end hooks
---

## 9. 当前推荐的设计口径

后续所有文档都应统一采用以下表述：

### 8.1 关于 runtime 分层

不要再说“`agent-harness` 是一个统一入口即可”。

应改为：

- `agent-harness` 是一个同包内分层 runtime
- 顶层入口只作为兼容层存在
- 新调用方应显式导入 `runtime / exploration / code-repair`

### 8.2 关于 exploration

不要再说“exploration 仍是单体主类”。

应改为：

- exploration 已拆出多个独立模块
- `ExplorationAgent` 现在保留的是顶层 loop、fallback probe 兼容层和最终调度粘合，而不是再维护一套完整的 `brain/auth/execution` 重复实现

### 8.3 关于 code repair

不要再说“现在已经是完整的自治 code repair agent”。

应改为：

- 已从单次 CLI 调用升级为 bounded autonomous runtime
- 已具备 context assembly、memory injection、read-only planning、retry strategy、verification review、task ledger、prompt staging、有限预算自动 retry、近似 token budget、auto compact、final stop hooks
- 已把 loop 结构化结果落成 `runtime-summary.json`，并暴露到 `CodeTaskDetail.runtimeSummary` 供 UI / review / trace 直接查看
- 已把 harness session replay 暴露到 `RunDetailPage`，供 run 级排障直接查看 context / steps / tool calls / prompt samples
- 仍缺 side agent 和更强的策略重规划
---

## 10. 后续演进方向

如果继续增强 Agent 智能感，建议只沿以下方向推进：

1. 清理 `ExplorationAgent` 内残留的重复实现，真正让主类只负责 orchestration
2. 继续强化 `CodeRepairAgent` 的状态机，提升 auto compact 的策略质量并补更强 stop hooks
3. 提升 retry decision 的策略质量，让下一轮 apply 真正根据失败模式重规划
4. 引入更强的 turn-end hooks，并继续提升 compact 后的上下文恢复质量
5. 视需要引入只读并行子任务，但先限定在搜索、摘要和 verify 建议，不直接写代码

不建议当前继续扩张的方向：

- 把 runtime 做成重型插件系统
- 过早引入复杂多 agent 写入协作
- 在没有稳定 verify loop 前先做更复杂的自动提交链路
---

## 11. 文档关系

配套阅读：

- [Agent Harness 详细设计](./agent-harness-design.md)
- [CodeTask 与 Review 详细设计](./code-task-design.md)
- [CodeTask 自动化设计文档](./codetask-automation-design.md)
- [Exploration 模块设计文档](./exploration-design.md)

不再保留：

- 阶段性任务卡
- 无人值守拆卡 backlog
- “某一批 phase 已全部完成”的进度型文档
