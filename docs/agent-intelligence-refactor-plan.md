# Agent 智能化重构方案

> 执行状态（2026-04-03）
>
> 已落地：
> - Phase 0 边界解耦
> - Phase 1 运行时骨架：`AgentProfile`、`AgentContextAssembler`、`CodeRepairPromptBuilder`、`CodeRepairAgent`
> - Phase 2 task memory：`code_task_memories` migration + repository + selection
> - Phase 3 tool orchestration 基础件：`ToolDescriptor`、`ToolExecutionPlanner`
> - exploration 侧已补 `browser-adapter`、`finding-extractor`、`prompt-builder`、`brain`、`auth-flow` 独立模块
> - 过渡期 root runtime wrapper 已删除，测试和调用方已切到稳定分层入口

## 1. 目标

基于对以下两个代码库的对比：

- 当前项目：`/Users/zhouze/Documents/git-projects/ai-regression-workbench`
- 参考项目：`/Users/zhouze/Documents/git-projects/claude-code-main`

本方案聚焦回答三个问题：

1. 当前项目为什么会显得 “Agent 不够智能”
2. `claude-code-main` 的哪些设计值得借鉴
3. 当前项目应该如何分阶段重构，才能把 Agent 从 “单次调用执行器” 提升为 “具备上下文管理、计划、反馈、自恢复能力的运行时”

本文档不建议照搬 `claude-code-main` 的整个 runtime。它的体量很大，包含 UI、远程运行、插件、权限系统、compact、telemetry 等大量配套机制。当前项目更适合抽取其中对 “Agent 智能感” 最关键的能力，按最小闭环逐步迁移。

配套执行清单见：

- [Agent 无人值守开发任务清单](./agent-unattended-backlog.md)
- [Agent 重构全量任务卡](./agent-task-cards-full.md)

---

## 2. 当前项目现状与核心短板

### 2.1 已经做得不错的部分

当前项目的 exploration 链路并不差，已经具备一个轻量 `Brain v1`：

- 有 planner / executor / policy guard 的分层
- 有 prompt 模板化、版本化和 prompt sample 落盘
- 有 `recentSteps`、`recentFindings`、`recentToolResults`、`recentNetworkHighlights`
- 有登录态处理、auth gate 识别、replan、fallback plan

相关代码：

- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/session-manager.ts`
- `docs/exploration-prompt-design.md`

这说明问题不是 “项目完全没有 Agent 设计”，而是设计主要集中在 exploration 这一条链上，没有推广到 code repair / multi-agent / long-running runtime。

### 2.2 真正显得“呆”的地方在 CodeTask / CodeAgent

当前 CodeTask 执行链路本质上还是：

1. 准备一个 `goal`
2. 把 `goal` 原样丢给 `codex exec`
3. 等 CLI 结束
4. 再由系统统一做 verify / diff / patch

对应实现：

- `apps/cli/src/services/code-task-service.ts`
- `packages/agent-harness/src/codex-cli-agent.ts`

当前关键问题：

1. `CodeTaskService.runExecution()` 只把 `row.goal` 作为 prompt 传给外部 agent，没有把 `scopePaths`、`constraints`、`verificationCommands`、失败上下文、历史尝试、相关文件摘要、最近 diff 等运行时上下文拼成结构化 prompt。
2. `CodexCliAgent` 只是一个 CLI transport wrapper，不是一个真正的 `CodeRepairAgent runtime`。它不具备 plan/apply/verify/retry/replan 的内部回路。
3. `ToolRegistry` 现在只有 “注册 + policy + timeout + logging” 三件事，没有并发批处理、上下文修改器、结果回流、工具级 state machine。
4. 当前项目没有 run/task 级长期记忆。一次修复失败之后，下一次尝试没有稳定吸收 “上次为什么失败、哪些文件碰过、哪些 verify 命令失败过、哪些方案被否掉了”。
5. 当前项目没有 Agent profile / role abstraction。exploration 和 code repair 都挂在 harness 下，但没有统一的 agent 定义层。
6. 当前项目的智能主要来自 prompt，而不是来自 runtime。prompt 一旦不够，Agent 就直接显得机械。

### 2.3 当前架构的根本限制

当前项目更像：

- `Harness + 一次性 LLM 决策`
- `Harness + 一次性 CLI 执行`

而不是：

- `持续循环的 agent runtime`
- `工具执行与上下文演化共同驱动的 agent`

因此它的问题不是模型本身不够强，而是：

- 上下文给得不够好
- 反馈闭环太短
- 记忆无法沉淀
- 没有角色化与多阶段决策
- 没有把工具执行结果自动纳入下一轮思考

---

## 3. 参考项目里最值得借鉴的设计

以下设计来自 `claude-code-main`，这些能力直接决定了 Agent 为什么显得更“聪明”。

### 3.1 Agent 不是硬编码分支，而是可配置的定义对象

参考逻辑：

- `tools/AgentTool/loadAgentsDir.ts`

其核心做法不是把所有 agent 行为散落在 if/else 中，而是定义统一的 `AgentDefinition`，支持：

- `tools` / `disallowedTools`
- `skills`
- `mcpServers`
- `hooks`
- `model`
- `effort`
- `permissionMode`
- `maxTurns`
- `memory`
- `background`
- `isolation`

这带来两个直接收益：

1. Agent 的差异被显式建模，不再只是 prompt 不同
2. runtime 可以根据 agent profile 动态决定工具池、上下文、权限和执行策略

对当前项目的启发：

- 需要把 `ExplorationAgent`、`CodeRepairAgent`、`PlanAgent`、`VerifyAgent` 抽象成同一类 “可配置 agent profile”
- 不应继续让 `CodeTaskService` 直接绑定 `CodexCliAgent | KiroCliAgent`

### 3.2 Agent 运行时支持 agent 专属能力装配

参考逻辑：

- `tools/AgentTool/runAgent.ts`

尤其值得借鉴的是：

- agent 启动时装配专属 MCP servers
- 将 agent-specific tools 与父级 tools 合并
- agent 结束时清理新增资源

这背后的思想是：Agent 的能力集合是运行时拼装出来的，不是全局固定的。

对当前项目的启发：

- exploration、code repair、verify 不应该共享同一套固定工具
- 当前项目可以先不引入 MCP，但应该先支持 `AgentProfile -> ToolSet` 的运行时映射

### 3.3 整个系统围绕“持续循环”而不是“一次调用”组织

参考逻辑：

- `QueryEngine.ts`
- `query.ts`

这里最关键的不是某个 prompt，而是整个 query loop：

- 每一轮都可以重新装配上下文
- 每一轮都会接收工具结果、附件、记忆、技能发现结果
- 每一轮结束会把新状态继续带入下一轮

这让 agent 的行为更像 “持续思考 + 持续更新世界模型”，而不是 “一次生成一个答案”。

对当前项目的启发：

- `CodeRepairAgent` 必须从 “单次 CLI 执行” 改成 “多阶段循环”
- 最少也要拆成：`plan -> apply -> verify -> retry-decision`

### 3.4 工具调用不是简单串行，而是带上下文修改语义的 orchestration

参考逻辑：

- `services/tools/toolOrchestration.ts`

这个模块最有价值的设计点有两个：

1. 区分 concurrency-safe 与 non-concurrency-safe 工具
2. 工具不仅返回结果，还可以返回 `contextModifier`

这意味着：

- 读类工具可以并发跑
- 写类工具串行跑
- tool result 不只是日志，还可以真正改变下一轮 agent 的上下文

对当前项目的启发：

- `ToolRegistry` 不能只做 logging
- 需要升级为 `ToolRegistry + ToolExecutionPlanner + ContextModifier`

### 3.5 有 session memory，而且它是自动触发的

参考逻辑：

- `services/SessionMemory/sessionMemory.ts`

这里最值得借鉴的点不是 “把内容写进 markdown 文件”，而是它定义了：

- 何时触发记忆抽取
- 基于 token / tool call 阈值触发
- 用 forked agent 在后台提炼长期可复用信息

对当前项目的启发：

- 当前项目需要 task/run 级记忆，不要求一开始就做成通用聊天记忆
- 最适合先落地的是 `CodeTaskMemory`

建议先记录：

- 上一轮失败原因
- 上一轮验证失败命令
- 已尝试的修复方案
- 已触碰文件
- reviewer 拒绝原因

### 3.6 记忆不是全量灌入，而是先做 relevance selection

参考逻辑：

- `memdir/findRelevantMemories.ts`

参考项目没有粗暴把所有 memory 文件都塞给主模型，而是：

1. 扫描 memory header
2. 让 side model 选择当前 query 真正相关的 memory
3. 再把相关记忆注入主上下文

对当前项目的启发：

- 不要把所有历史尝试都塞给 CodeRepairAgent
- 要做 `task-memory selection`，只把当前失败最相关的 3~5 条历史信息带入

### 3.7 支持 forked agent，并且为其做了 cache-safe 参数设计

参考逻辑：

- `utils/forkedAgent.ts`

这里的高价值不是 “多开几个 agent”，而是：

- fork agent 继承父上下文
- 共享 cache-safe 参数
- 独立使用统计与 transcript
- 子 agent 不污染主循环的可变状态

对当前项目的启发：

- 当前项目后续可以引入 “只读型并行子任务”
- 最先适合 fork 的不是改代码，而是：
  - 搜索相关文件
  - 归纳失败上下文
  - 生成 verify 建议

### 3.8 有单独的只读 Plan Agent

参考逻辑：

- `tools/AgentTool/built-in/planAgent.ts`

参考项目把规划与实现明确分离：

- Plan agent 只读
- 不能改文件
- 必须输出步骤和关键文件

对当前项目的启发：

- CodeRepair 不应该一上来就进入 apply
- 最少要有一个 `plan` 阶段，而且 plan 阶段要使用只读工具集

### 3.9 工具结果会被再次压缩为对人和对模型都友好的摘要

参考逻辑：

- `services/toolUseSummary/toolUseSummaryGenerator.ts`
- `query.ts`

参考项目在一批工具执行完后，会异步生成一条简短的 “工具结果摘要”，然后在后续继续使用。

对当前项目的启发：

- 当前项目已经有 `recentToolResults`，但主要靠人工 push string
- 后续应该自动化：tool result -> normalized summary -> recent context

---

## 4. 不建议直接照搬的部分

以下部分不建议当前项目直接复制：

1. 完整的 REPL / SDK / UI 消息体系
2. 远程 agent / remote isolation / CCR
3. 复杂的 plugin / MCP registry 管理
4. 全量 compact / snip / transcript 恢复机制
5. 过早引入 team/swarm UI 能力

理由很简单：这些不是你当前 Agent “看起来不够智能” 的主因。主因是 runtime 组织能力不够，而不是外围平台能力不足。

---

## 5. 面向当前项目的重构目标

建议把目标定义为：

> 把当前项目的 Agent 从 “单次 prompt / 单次 CLI 调用” 升级为 “多阶段、可记忆、可恢复、工具结果自动回流的 agent runtime”。

具体落地成六个目标：

1. 为 Agent 建立统一 profile 定义层
2. 为 code repair 建立真正的 runtime，而不是只包一层 CLI
3. 引入 task-level memory 与 relevant-memory selection
4. 把 tool result 自动回流到 agent context
5. 把 plan / apply / verify / retry-decision 明确拆阶段
6. 为未来 fork / multi-agent 留接口，但第一阶段不强依赖真实多进程

### 5.1 额外目标：将 Agent runtime 与 exploration 领域实现解耦

这一点需要单独强调。

当前项目的问题不只是 Agent 不够智能，还有一个结构性问题：

> `agent-harness` 同时承载了通用 Agent runtime 和 exploration 专属实现，包边界已经混合。

文档设计里，Harness 的定位其实是清晰的：

- 负责 session、tool registry、policy、approval、checkpoint、trace
- 不负责业务状态机和领域语义

但实际代码里，`packages/agent-harness/src/index.ts` 同时导出了：

- `HarnessSessionManager`
- `ToolRegistry`
- `ArtifactWriter`
- `CodexCliAgent`
- `ExplorationAgent`
- `PlaywrightToolProvider`

这意味着当前的 `agent-harness` 不是纯 runtime 层，而是：

- 一部分 runtime
- 一部分 exploration domain
- 一部分 code repair transport

这会带来三个问题：

1. 通用 Agent 能力无法独立演进，因为任何改动都容易被 exploration 细节绑住。
2. exploration 的复杂性会反向污染 Agent runtime 的抽象，导致后续 code repair / verify agent 只能复制 exploration 的组织方式。
3. 包名与职责不一致，长期会让调用方误以为 “所有 agent 设计都必须跟 exploration 耦合在一起”。

因此，除了提升智能度，重构还应新增一个明确目标：

- 把 “通用 Agent runtime” 从 `exploration` 逻辑里剥离出来
- 让 exploration 变成运行在 runtime 之上的一个 agent/domain package

这不是可选优化，而是后续引入 `CodeRepairAgent`、`VerifyAgent`、`PlanAgent` 的前置条件。

---

## 6. 建议新增的核心模块

### 6.1 `AgentProfile`

建议新增文件：

- `packages/agent-harness/src/agent-profile.ts`

建议定义：

```ts
export type AgentRole =
  | 'exploration'
  | 'code-plan'
  | 'code-apply'
  | 'code-verify'
  | 'code-retry-decision';

export interface AgentProfile {
  role: AgentRole;
  displayName: string;
  scene: 'explorationDecision' | 'explorationLogin' | 'codeRepairPlan' | 'codeRepairApply' | 'codeRepairVerify' | 'codeRepairRetry';
  maxTurns: number;
  allowedTools: string[];
  disallowedTools?: string[];
  allowedWriteScopes?: string[];
  requireApprovalFor?: string[];
  memoryScope?: 'run' | 'task' | 'project';
  planningOnly?: boolean;
}
```

设计目的：

- 把 “这是哪种 agent、能做什么、能写哪里、最多跑几轮、要不要记忆” 统一建模
- 让 exploration 与 code repair 使用同一套 runtime 入口

### 6.2 `AgentContextAssembler`

建议新增文件：

- `packages/agent-harness/src/agent-context-assembler.ts`

职责：

- 把 DB / artifact / git / diagnostics / memory 里的信息拼成预算内上下文
- 输出：
  - `contextPayload`
  - `contextSummary`
  - `attachments`
  - `selectedMemories`

建议输入来源：

- `FailureAnalysis`
- `CodeTaskDraft`
- `CodeTaskRow`
- 上一轮 `Review`
- 上一轮 verify 输出
- 当前工作区 `git diff --stat` / changed files
- task memory 中与当前任务最相关的条目

### 6.3 `CodeTaskMemory`

建议新增文件：

- `packages/agent-harness/src/code-task-memory.ts`

第一阶段不必很复杂，建议先做 deterministic 版本：

```ts
export interface CodeTaskMemoryEntry {
  id: string;
  taskId: string;
  attempt: number;
  kind: 'plan' | 'apply' | 'verify' | 'review' | 'failure';
  summary: string;
  files?: string[];
  commands?: string[];
  tags?: string[];
  createdAt: string;
}
```

初期策略：

- 每次 apply 失败、verify 失败、review reject 时写一条 memory
- 下次 retry 时按 `taskId + tags + files overlap` 选出最相关的几条

后续可升级为 LLM relevance selection。

### 6.4 `CodeRepairAgent`

建议新增文件：

- `packages/agent-harness/src/code-repair-agent.ts`

这个模块应成为 CodeTask 真正的智能 runtime，而不再让 `CodeTaskService` 直接调 `CodexCliAgent.run(prompt)`.

建议主流程：

```ts
plan()
-> apply()
-> verify()
-> decideRetryOrFinish()
```

建议接口：

```ts
export interface CodeRepairRunInput {
  taskId: string;
  runId: string;
  workspacePath: string;
  scopePaths: string[];
  constraints: string[];
  verificationCommands: string[];
  failureAnalysisId?: string;
}

export interface CodeRepairRunResult {
  status: 'succeeded' | 'failed' | 'needs-review' | 'needs-retry-plan';
  sessionId: string;
  attemptSummary: string;
  changedFiles: string[];
  verifyPassed: boolean;
}
```

### 6.5 `CodeRepairPromptBuilder`

建议新增文件：

- `packages/agent-harness/src/code-repair-prompt-builder.ts`
- `packages/agent-harness/prompts/code-repair-plan/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-apply/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-verify/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-retry/default@v1.txt`

设计原则：

- 不把所有东西塞进一个大 prompt
- 按阶段拆 prompt
- 每阶段都有严格输入和输出 schema

建议输出 schema：

- `code-repair-plan`：目标文件、修改策略、风险点、verify 策略
- `code-repair-verify`：失败归因、是否建议 retry、建议新增上下文
- `code-repair-retry`：继续尝试 / 等待人工 / 拆分子任务

### 6.6 `ToolExecutionPlanner`

建议新增文件：

- `packages/agent-harness/src/tool-execution-planner.ts`

用于配合 `ToolRegistry` 升级：

- 识别 read-only / mutating 工具
- 允许只读工具并发
- 将工具结果自动转为 `recentToolResults`
- 支持 `contextModifier`

建议 `ToolRegistry` 补充字段：

```ts
export interface ToolDescriptor<TInput = unknown, TOutput = unknown> {
  name: string;
  handler: (input: TInput) => Promise<TOutput>;
  isReadOnly?: boolean;
  isConcurrencySafe?: (input: TInput) => boolean;
  summarizeResult?: (output: TOutput) => string;
  modifyContext?: (output: TOutput, ctx: AgentRuntimeContext) => AgentRuntimeContext;
}
```

### 6.7 `ExplorationDomain` 从 runtime 中拆出

建议不要再把 exploration 继续堆进 `agent-harness` 包内部。

推荐两种方案，优先方案 A。

#### 方案 A：拆成独立 package

建议新增：

- `packages/agent-runtime/`
- `packages/exploration-agent/`

职责划分：

`packages/agent-runtime/`

- `session-manager.ts`
- `tool-registry.ts`
- `tool-execution-planner.ts`
- `harness-policy.ts`
- `observability.ts`
- `observed-harness.ts`
- `agent-profile.ts`
- 通用 prompt sample / tool-call trace / approval trace

`packages/exploration-agent/`

- `exploration-agent.ts`
- `playwright-tool-provider.ts`
- `exploration-prompt-builder.ts`
- `exploration-finding-extractor.ts`
- `exploration-auth-flow.ts`
- exploration prompts

#### 方案 B：先在 `agent-harness` 内部分层

如果暂时不想拆 package，也至少要先拆目录：

```txt
packages/agent-harness/src/
  runtime/
    session-manager.ts
    tool-registry.ts
    tool-execution-planner.ts
    harness-policy.ts
    observability.ts
  exploration/
    exploration-agent.ts
    playwright-tool-provider.ts
    prompt-builder.ts
    auth-flow.ts
    finding-extractor.ts
  code-repair/
    codex-cli-transport.ts
    kiro-cli-transport.ts
    code-repair-agent.ts
```

这个方案虽然不如拆包彻底，但至少能先把依赖方向理顺。

#### exploration 拆分后的依赖方向

正确方向应当是：

```txt
orchestrator / app services
  -> exploration-agent
  -> code-repair-agent
  -> agent-runtime
```

而不应是：

```txt
app services
  -> agent-harness(里面混着 exploration)
```

#### `ExplorationAgent` 应拆分的内部职责

当前 `ExplorationAgent` 内部塞得太满，建议拆成以下组件：

1. `ExplorationBrain`
- planner / executor / policy guard
- 只负责“下一步做什么”

2. `ExplorationPromptBuilder`
- 构造 `exploration-plan` / `exploration-decision` / `exploration-login` prompt
- 输出 `prompt` 和 `promptContextSummary`

3. `ExplorationAuthFlow`
- 登录检测
- auth gate 恢复
- AI login / credential apply / captcha 处理

4. `ExplorationFindingExtractor`
- 从 page state 提取 finding
- finding 去重

5. `ExplorationBrowserAdapter`
- 对 `PlaywrightToolProvider` 的更窄封装
- 只暴露 exploration 真正需要的页面能力

6. `ExplorationAgent`
- 只负责编排上述组件
- 自身不再承载所有细节

拆完之后，`ExplorationAgent` 才算是 “agent 逻辑”，而不是 “exploration 全家桶”。

---

## 7. 建议改造的现有模块

### 7.1 `apps/cli/src/services/code-task-service.ts`

当前问题：

- 这里承担了太多 agent runtime 责任
- 但真正做的事情只是 “状态流转 + 调 CLI + 落产物”

建议改造：

1. 让它只负责业务状态机与持久化
2. 把 agent runtime 下放给 `CodeRepairAgent`

建议改造后流程：

```ts
CodeTaskService.executeCodeTask()
  -> CodeRepairAgent.run()
  -> ArtifactWriter.generateArtifacts()
  -> 更新任务状态
```

不要继续在这里直接拼 prompt、直接调 `CodexCliAgent.run(row.goal)`。

### 7.2 `packages/agent-harness/src/codex-cli-agent.ts`

当前问题：

- 只是 transport wrapper
- 输入只有 `workspacePath + prompt`
- 输出只有 `rawOutput + exitCode`

建议改造：

1. 把它降级为 `CodexCliTransport`
2. 支持结构化输入：

```ts
export interface CodexExecInput {
  workspacePath: string;
  prompt: string;
  outputSchemaPath?: string;
  resultOutputPath?: string;
  timeoutMs?: number;
}
```

3. 支持后续使用 `--json` / `-o` / `--output-schema`
4. 让 runtime 消费结构化结果，而不是只消费 stdout 文本

### 7.3 `packages/agent-harness/src/tool-registry.ts`

当前问题：

- 过于静态
- 没有 context modifier
- 没有 batched orchestration

建议改造：

1. 把 `register(name, handler)` 改成注册 `ToolDescriptor`
2. 增加 `isReadOnly` / `isConcurrencySafe` / `summarizeResult` / `modifyContext`
3. 新增 `runBatch()`，支持：
   - 读操作并发
   - 写操作串行
   - 结果摘要自动回流

### 7.3.1 `packages/agent-harness/src/index.ts`

当前这个入口文件本身就在放大耦合。

问题不在于导出太多，而在于把不同层级的东西放进了一个 public surface：

- runtime primitives
- exploration implementation
- code agent transport

建议改造方向：

1. 如果拆包：
- `packages/agent-runtime/src/index.ts` 只导出 runtime primitives
- `packages/exploration-agent/src/index.ts` 导出 `ExplorationAgent` 及其浏览器相关组件
- `packages/code-repair-agent/src/index.ts` 导出 code repair runtime / transports

2. 如果暂不拆包：
- `src/index.ts` 只导出 runtime 通用能力
- exploration 改成 `src/exploration/index.ts`
- code repair 改成 `src/code-repair/index.ts`

原则是：

> 调用方必须能一眼看出来，自己依赖的是 runtime，还是 exploration，还是 code repair。

不能继续让 `agent-harness` 作为一个“大杂烩入口”存在。

### 7.4 `packages/agent-harness/src/session-manager.ts`

当前基础不错，但还缺两类信息：

1. phase 级记录
2. summary 级记录

建议新增：

- `phase`: `plan|apply|verify|retry-decision`
- `summaryKind`: `tool-summary|attempt-summary|memory-summary`

目的：

- 让 UI 和回放系统不仅看见 step，还能看见 “本阶段干了什么”

### 7.5 `apps/ai-engine/src/ai-engine.ts`

当前 `createCodeTaskDraft()` 只生成：

- `goal`
- `target`
- `scopePaths`
- `constraints`
- `verificationCommands`

这对 runtime 不够。

建议扩展 draft 输出：

```ts
{
  goal: string;
  target: 'app' | 'test';
  scopePaths: string[];
  constraints: string[];
  verificationCommands: string[];
  candidateFiles: string[];
  fixHypothesis: string;
  riskLevel: 'low' | 'medium' | 'high';
  shouldPlanFirst: boolean;
}
```

这些字段后续会直接进入 `CodeRepairAgent` 的 context builder。

---

## 8. 推荐的重构顺序

### Phase 0：先做分层解耦

目标：

- 在不改变现有行为的前提下，把 runtime / exploration / code repair 的边界拆清楚

具体动作：

1. 重构目录结构或拆 package
2. 收缩 `index.ts` 的公共导出面
3. 将 `ExplorationAgent` 的 prompt builder / auth flow / finding extractor 从主类中拆出
4. 让 app services 明确依赖 exploration package，而不是依赖混合包

交付标准：

- runtime 层不再出现 `Exploration`、`Playwright`、`Finding` 这类领域命名
- exploration 依赖 runtime，但 runtime 不依赖 exploration
- CodeRepairAgent 可以在不复用 exploration 类的前提下接入相同 runtime

### Phase 1：把 CodeTask 从“单次 CLI 调用”升级到“多阶段 agent runtime”

目标：

- 不做真实多 agent
- 在完成 Phase 0 解耦后，先做单 runtime 多阶段

具体动作：

1. 新增 `AgentProfile`
2. 新增 `CodeRepairAgent`
3. 新增 `CodeRepairPromptBuilder`
4. `CodeTaskService` 改为调用 `CodeRepairAgent.run()`
5. `CodexCliAgent` 改成 transport adapter

交付标准：

- CodeTask 的 apply 前一定先有 plan
- verify 失败后一定进入 retry-decision，而不是直接结束
- 每阶段都有 prompt sample 和 summary

### Phase 2：引入 Task Memory

目标：

- 让同一个 task 的多轮尝试能吸收历史

具体动作：

1. 新增 `CodeTaskMemory`
2. 在失败 / review reject / verify fail 时写 memory
3. retry 时做相关记忆选择并注入 context

交付标准：

- 第二次 retry 的 prompt 能明确包含第一轮失败摘要
- 同一个错误不会被重复尝试三次以上

### Phase 3：升级 ToolRegistry 为真正的 tool orchestration

目标：

- 不再人工维护 `recentToolResults`
- tool result 自动参与下一轮思考

具体动作：

1. `ToolDescriptor` 化
2. 支持 `contextModifier`
3. 支持读工具并发
4. 自动生成 tool summary

交付标准：

- CodeRepairAgent / ExplorationAgent 共用统一工具执行模型
- 下一轮 prompt 的 recent context 不再依赖手工拼接字符串

### Phase 4：引入只读型子任务并行

目标：

- 先提升调研和归因效率，不急着多 agent 改代码

建议先并行的子任务：

- file search worker
- verify failure analyzer
- related diff summarizer

交付标准：

- 主 agent 可以拿到多个只读子任务的结构化结果
- 不产生并发写代码冲突

---

## 9. 可以直接参考的代码逻辑清单

以下是最值得逐段参考的代码路径。

### 9.1 统一 Agent 定义与装配

参考：

- `/Users/zhouze/Documents/git-projects/claude-code-main/tools/AgentTool/loadAgentsDir.ts`
- `/Users/zhouze/Documents/git-projects/claude-code-main/tools/AgentTool/runAgent.ts`

建议借鉴点：

- AgentDefinition 的字段设计
- agent-specific tools / MCP 装配
- agent 级别的模型、权限、memory、maxTurns

### 9.2 工具批处理与上下文修改

参考：

- `/Users/zhouze/Documents/git-projects/claude-code-main/services/tools/toolOrchestration.ts`

建议借鉴点：

- concurrency-safe 分批
- contextModifier
- 工具执行与上下文状态联动

### 9.3 记忆抽取与记忆选择

参考：

- `/Users/zhouze/Documents/git-projects/claude-code-main/services/SessionMemory/sessionMemory.ts`
- `/Users/zhouze/Documents/git-projects/claude-code-main/memdir/findRelevantMemories.ts`
- `/Users/zhouze/Documents/git-projects/claude-code-main/tools/AgentTool/agentMemory.ts`

建议借鉴点：

- 何时写记忆
- 如何选择相关记忆
- memory scope 的分层设计

### 9.4 fork / 子 agent 的 cache-safe 设计

参考：

- `/Users/zhouze/Documents/git-projects/claude-code-main/utils/forkedAgent.ts`

建议借鉴点：

- 子任务上下文继承
- cache-safe params
- 与主循环的状态隔离

### 9.5 只读 planning agent

参考：

- `/Users/zhouze/Documents/git-projects/claude-code-main/tools/AgentTool/built-in/planAgent.ts`

建议借鉴点：

- 规划与实现分离
- planning-only tool restrictions
- 输出关键文件与步骤

### 9.6 tool summary 自动生成

参考：

- `/Users/zhouze/Documents/git-projects/claude-code-main/services/toolUseSummary/toolUseSummaryGenerator.ts`

建议借鉴点：

- 工具结果压缩成高价值摘要
- 不把原始 tool output 直接污染主上下文

---

## 10. 当前项目建议修改的文件清单

### 第一优先级

- `packages/agent-harness/src/index.ts`
- `apps/cli/src/services/code-task-service.ts`
- `packages/agent-harness/src/codex-cli-agent.ts`
- `packages/agent-harness/src/tool-registry.ts`
- `packages/agent-harness/src/session-manager.ts`
- `apps/ai-engine/src/ai-engine.ts`
- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/playwright-tool-provider.ts`

### 建议新增

- `packages/agent-runtime/src/index.ts` 或 `packages/agent-harness/src/runtime/index.ts`
- `packages/exploration-agent/src/index.ts` 或 `packages/agent-harness/src/exploration/index.ts`
- `packages/agent-harness/src/agent-profile.ts`
- `packages/agent-harness/src/agent-context-assembler.ts`
- `packages/agent-harness/src/code-repair-agent.ts`
- `packages/agent-harness/src/code-repair-prompt-builder.ts`
- `packages/agent-harness/src/code-task-memory.ts`
- `packages/agent-harness/src/tool-execution-planner.ts`
- `packages/agent-harness/src/exploration-auth-flow.ts`
- `packages/agent-harness/src/exploration-finding-extractor.ts`
- `packages/agent-harness/src/exploration-prompt-builder.ts`

### 建议新增 prompt 模板

- `packages/agent-harness/prompts/code-repair-plan/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-apply/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-verify/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-retry/default@v1.txt`

---

## 11. 最终建议

最重要的判断是：

> 你当前项目的 Agent 不够智能，不是因为模型差，而是因为 runtime 太薄。

最应该优先重构的不是 exploration，而是 code repair 这条链：

- 先把 `CodeTaskService -> CodexCliAgent.run(goal)` 这一跳拆掉
- 建立 `CodeRepairAgent` 多阶段运行时
- 引入 task memory 和 context assembler
- 再升级 tool orchestration

如果只做 prompt 优化，不做 runtime 重构，Agent 的“智能感”提升会很有限，而且很容易回退。

如果按本文档的顺序推进，第一阶段就能明显改善三个体验：

1. 修复任务不再像“一次性投喂”
2. verify 失败后不再像“失忆重来”
3. Agent 的行动会更像“先理解，再计划，再修改，再验证，再决定下一步”

这才是用户真正感知到的 “智能”。
