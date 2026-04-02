# Agent 无人值守开发任务清单

## 1. 目标

本文档把 [Agent 智能化重构方案](./agent-intelligence-refactor-plan.md) 转成可以直接执行的开发 backlog，目标是：

1. 任务拆分到单个 coding agent 可以连续完成的粒度
2. 每个任务都具备明确输入、输出、验收标准和验证命令
3. 尽量减少人工中途判断，适合无人值守推进
4. 显式标出串行依赖与可并行任务

这里的“无人值守”不意味着完全不需要人看最终结果，而是指：

- 开发过程中不依赖产品/架构反复决策
- 任务边界明确
- 每个任务完成后可以靠 typecheck/test/结构检查自证

Phase 0 可直接执行的任务卡见：

- [Agent 重构 Phase 0 任务卡](./agent-task-cards-phase0.md)
- [Agent 重构全量任务卡](./agent-task-cards-full.md)

---

## 2. 开发方式建议

### 2.1 总体策略

这轮改造不建议“大重写”。建议采用：

1. 先解耦目录和依赖方向
2. 再引入新 runtime
3. 再迁移调用方
4. 最后删除旧路径和冗余导出

这样可以保证：

- 每一步都可编译
- 每一步都可回退
- exploration 现有行为不会一次性被打断

### 2.2 推荐分支策略

建议按 epic 或 phase 分支开发，不要把所有任务压到一个超大分支里。

推荐分支命名：

- `refactor/agent-runtime-phase0-decouple`
- `refactor/agent-runtime-phase1-code-repair-runtime`
- `refactor/agent-runtime-phase2-task-memory`
- `refactor/agent-runtime-phase3-tool-orchestration`

### 2.3 推荐验证方式

每个任务至少做以下验证中的一部分：

- `pnpm -r typecheck`
- `pnpm test`
- `pnpm --filter <pkg> test`
- `pnpm --filter <pkg> build`

当前 workspace 的关键事实：

- workspace 由 `apps/*` 与 `packages/*` 组成
- 根构建命令是 `pnpm -r build`
- 根类型检查命令是 `pnpm -r typecheck`
- 测试由 `vitest` 驱动，覆盖 `packages/*/test/**/*.test.ts` 和 `apps/*/test/**/*.test.ts`

相关文件：

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `vitest.config.ts`

### 2.4 新增 package 的固定做法

如果采用拆 package 方案，新增 package 时统一按以下步骤：

1. 新建 `packages/<name>/package.json`
2. 新建 `packages/<name>/tsconfig.json`
3. 新建 `packages/<name>/tsconfig.test.json`
4. 更新根 `tsconfig.json` references
5. 更新依赖它的 app/package 的 `package.json`
6. 新增最小 smoke test

建议新 package 名称：

- `@zarb/agent-runtime`
- `@zarb/exploration-agent`

如果不拆 package，则按目录重构任务执行，但仍保留同样的验收标准。

---

## 3. 无人值守任务设计原则

以下规则适用于本文档的所有任务：

1. 单任务只允许一个明确目标，不混合“重构 + 新功能 + UI”。
2. 单任务尽量只有一个主写入域，避免跨太多 package。
3. 每个任务都有显式 DoD，完成标准不能是“看起来差不多”。
4. 每个任务必须有至少一个自动验证动作。
5. 涉及 schema / storage / public exports 的任务，必须附带兼容性检查。

任务状态建议：

- `pending`
- `in_progress`
- `blocked`
- `done`

---

## 4. Backlog 总览

本 backlog 分成 6 个 epic：

- Epic A：目录解耦与边界收缩
- Epic B：exploration 内部拆层
- Epic C：CodeRepair runtime 建立
- Epic D：Task memory 建立
- Epic E：Tool orchestration 升级
- Epic F：迁移、清理与回归验证

依赖顺序：

```txt
Epic A
  -> Epic B
  -> Epic C
Epic C
  -> Epic D
  -> Epic E
Epic B + C + D + E
  -> Epic F
```

---

## 5. Epic A：目录解耦与边界收缩

### A1. 建立目标目录结构

目标：

- 为 runtime / exploration / code-repair 建立明确目录边界

推荐写入：

- `packages/agent-harness/src/runtime/`
- `packages/agent-harness/src/exploration/`
- `packages/agent-harness/src/code-repair/`

如果直接拆 package，则改为：

- `packages/agent-runtime/src/`
- `packages/exploration-agent/src/`

输入：

- 现有 `packages/agent-harness/src/*`

输出：

- 新目录存在
- 新 index 文件存在
- 旧文件尚未删除

DoD：

- 新目录结构建好
- 还没有行为改动
- 编译不报错

验证：

- `pnpm --filter @zarb/agent-harness typecheck`

依赖：

- 无

可并行：

- 否

### A2. 收缩 `agent-harness` 公共导出面

目标：

- 让 runtime 导出和 exploration 导出不再混在一个入口里

主改文件：

- `packages/agent-harness/src/index.ts`
- 新增 `packages/agent-harness/src/runtime/index.ts`
- 新增 `packages/agent-harness/src/exploration/index.ts`
- 新增 `packages/agent-harness/src/code-repair/index.ts`

输出：

- 顶层 index 只导出兼容层，或只导出 runtime
- exploration/code-repair 从子入口导出

DoD：

- 从 public API 上能区分 runtime 与 exploration
- 现有 import 不全部一次性切断，必要时保留兼容 re-export 并加 TODO 注释

验证：

- `pnpm --filter @zarb/agent-harness typecheck`

依赖：

- A1

可并行：

- 否

### A3. 将通用 runtime 文件迁移到 `runtime/`

目标：

- 把通用能力从 exploration 语义中剥离出来

主改文件：

- `packages/agent-harness/src/session-manager.ts`
- `packages/agent-harness/src/tool-registry.ts`
- `packages/agent-harness/src/harness-policy.ts`
- `packages/agent-harness/src/observability.ts`
- `packages/agent-harness/src/observed-harness.ts`
- `packages/agent-harness/src/artifact-writer.ts`

输出：

- 以上文件迁移到 `runtime/`
- import 路径调整完成

DoD：

- runtime 层文件中不出现 `Exploration`、`Playwright`、`Finding` 类型命名
- 所有测试通过

验证：

- `pnpm --filter @zarb/agent-harness test`

依赖：

- A2

可并行：

- 否

### A4. 更新调用方到新入口

目标：

- 让 app 层显式依赖正确子模块

主改文件：

- `apps/cli/src/harness-factory.ts`
- `apps/cli/src/services/run-service.ts`
- `apps/cli/src/services/code-task-service.ts`

输出：

- import 不再全部来自 `@zarb/agent-harness` 顶层混合入口

DoD：

- app 层能区分自己依赖的是 runtime 还是 exploration

验证：

- `pnpm --filter @zarb/cli typecheck`
- `pnpm --filter @zarb/cli build`

依赖：

- A2
- A3

可并行：

- 否

---

## 6. Epic B：exploration 内部拆层

### B1. 抽出 `ExplorationPromptBuilder`

目标：

- 让 prompt 构建从 `ExplorationAgent` 主类中独立出来

主改文件：

- 新增 `packages/agent-harness/src/exploration/prompt-builder.ts`
- 调整 `packages/agent-harness/src/exploration-agent.ts`

需要迁移的逻辑：

- `buildExplorationDecisionPrompt`
- `buildExplorationPlanPrompt`
- prompt context summary 相关逻辑

DoD：

- `ExplorationAgent` 不再定义大段 prompt builder 函数
- prompt 相关测试迁移完成

验证：

- `pnpm --filter @zarb/agent-harness test -- exploration-agent`

依赖：

- A3

可并行：

- 可与 B3 并行

### B2. 抽出 `ExplorationBrain`

目标：

- 将 planner / executor / policy guard 决策逻辑独立成 brain 组件

主改文件：

- 新增 `packages/agent-harness/src/exploration/brain.ts`
- 调整 `packages/agent-harness/src/exploration-agent.ts`

需要迁移的逻辑：

- `planExplorationPhase`
- `decideNextStep`
- policy guard 的相关判断

DoD：

- `ExplorationAgent` 主要负责 orchestration
- Brain 层单独可测试

验证：

- `pnpm --filter @zarb/agent-harness test -- exploration-agent`

依赖：

- B1

可并行：

- 否

### B3. 抽出 `ExplorationFindingExtractor`

目标：

- 把 finding 提取和去重从主流程中拆出去

主改文件：

- 新增 `packages/agent-harness/src/exploration/finding-extractor.ts`
- 调整 `packages/agent-harness/src/exploration-agent.ts`

DoD：

- finding 提取逻辑独立
- 去重 key 逻辑独立

验证：

- `pnpm --filter @zarb/agent-harness test -- exploration-agent`

依赖：

- A3

可并行：

- 可与 B1 并行

### B4. 抽出 `ExplorationAuthFlow`

目标：

- 将登录、验证码、auth gate 恢复从主类中拆出

主改文件：

- 新增 `packages/agent-harness/src/exploration/auth-flow.ts`
- 调整 `packages/agent-harness/src/exploration-agent.ts`

需要迁移的逻辑：

- `runAiLogin`
- captcha / slider 相关流程
- auth gate recovery 相关流程

DoD：

- `ExplorationAgent` 不再直接承载登录全流程细节
- auth-flow 可以单独注入依赖并测试

验证：

- `pnpm --filter @zarb/agent-harness test -- exploration-agent`

依赖：

- B2

可并行：

- 否

### B5. 抽出 `ExplorationBrowserAdapter`

目标：

- 让 exploration 不再直接依赖宽接口 Playwright provider

主改文件：

- 新增 `packages/agent-harness/src/exploration/browser-adapter.ts`
- 调整 `playwright-tool-provider.ts`
- 调整 `exploration-agent.ts`

DoD：

- `ExplorationAgent` 通过更窄接口访问浏览器能力
- 后续替换 browser backend 的成本下降

验证：

- `pnpm --filter @zarb/agent-harness test`

依赖：

- B4

可并行：

- 否

---

## 7. Epic C：CodeRepair runtime 建立

### C1. 新增 `AgentProfile`

目标：

- 给 exploration / code-repair / verify 建立统一 profile 定义

主改文件：

- 新增 `packages/agent-harness/src/runtime/agent-profile.ts`

DoD：

- 有 `role`、`allowedTools`、`allowedWriteScopes`、`requireApprovalFor`、`maxTurns` 等字段
- exploration 与 code-repair 都可引用

验证：

- `pnpm --filter @zarb/agent-harness typecheck`

依赖：

- A3

可并行：

- 可与 C2 并行

### C2. 新增 `CodeRepairPromptBuilder`

目标：

- 为 code repair 建立分阶段 prompt

主改文件：

- 新增 `packages/agent-harness/src/code-repair/prompt-builder.ts`
- 新增 prompts：
  - `code-repair-plan/default@v1.txt`
  - `code-repair-apply/default@v1.txt`
  - `code-repair-verify/default@v1.txt`
  - `code-repair-retry/default@v1.txt`

DoD：

- 四类 prompt 均模板化
- 每类 prompt 都有输入类型和输出 schema 定义

验证：

- `pnpm --filter @zarb/agent-harness typecheck`
- 补充 prompt builder 单测

依赖：

- A3

可并行：

- 可与 C1 并行

### C3. 新增 `AgentContextAssembler`

目标：

- 用统一组件组装 code repair 上下文

主改文件：

- 新增 `packages/agent-harness/src/runtime/agent-context-assembler.ts`

首批输入来源：

- `FailureAnalysis`
- `CodeTaskRow`
- `verificationCommands`
- scope/constraints
- 上一轮 review / verify 输出

DoD：

- 输出结构化 context object
- 输出 budget-safe summary string

验证：

- 新增单测覆盖空上下文和完整上下文场景

依赖：

- C1
- C2

可并行：

- 否

### C4. 把 `CodexCliAgent` 降级为 transport

目标：

- 明确它不再代表 “完整 code agent”

主改文件：

- `packages/agent-harness/src/codex-cli-agent.ts`
- `packages/agent-harness/src/kiro-cli-agent.ts`

建议改名：

- `codex-cli-transport.ts`
- `kiro-cli-transport.ts`

DoD：

- transport 输入结构化
- 命名不再暗示它本身就是 runtime
- 保留兼容导出或迁移所有 import

验证：

- `pnpm --filter @zarb/agent-harness typecheck`

依赖：

- A2

可并行：

- 可与 C3 并行

### C5. 新增 `CodeRepairAgent`

目标：

- 建立 `plan -> apply -> verify -> retry-decision` 多阶段 runtime

主改文件：

- 新增 `packages/agent-harness/src/code-repair/code-repair-agent.ts`

DoD：

- 存在明确阶段状态
- 每阶段都能落 step / prompt sample / summary
- 可调用 transport 执行 apply
- verify 失败后会进入 retry-decision，而不是直接结束

验证：

- 新增 `code-repair-agent.test.ts`
- `pnpm --filter @zarb/agent-harness test`

依赖：

- C1
- C2
- C3
- C4

可并行：

- 否

### C6. `CodeTaskService` 切换到 `CodeRepairAgent`

目标：

- 让 app service 不再直接 orchestrate CLI prompt execution

主改文件：

- `apps/cli/src/services/code-task-service.ts`

DoD：

- `runExecution()` 改为调用 `CodeRepairAgent.run()`
- task 状态推进仍兼容现有状态机
- artifact 产出逻辑不退化

验证：

- `pnpm --filter @zarb/cli typecheck`
- `pnpm test`

依赖：

- C5

可并行：

- 否

---

## 8. Epic D：Task memory 建立

### D1. 定义 `CodeTaskMemoryEntry` 结构

目标：

- 建立 task memory 的最小数据模型

主改文件：

- `packages/shared-types/src/*`
- `packages/storage/src/*`
- 必要时增加 migration

DoD：

- DTO、repo、表结构一致
- memory entry 至少支持 `taskId`、`attempt`、`kind`、`summary`

验证：

- `pnpm -r typecheck`
- storage 相关单测通过

依赖：

- C5

可并行：

- 否

### D2. 新增 `CodeTaskMemory` 模块

目标：

- 建立 memory 的写入和选择能力

主改文件：

- 新增 `packages/agent-harness/src/code-repair/code-task-memory.ts`

DoD：

- 支持 `recordFailure`
- 支持 `recordReview`
- 支持 `selectRelevantMemories`

初版可以用 deterministic 规则，不强制 LLM

验证：

- 新增单测

依赖：

- D1

可并行：

- 否

### D3. 在 `CodeRepairAgent` 中接入 memory 写入

目标：

- 将 plan/apply/verify/review 结果沉淀为 task memory

主改文件：

- `packages/agent-harness/src/code-repair/code-repair-agent.ts`

DoD：

- apply 失败写 memory
- verify 失败写 memory
- retry-decision 阶段能读 memory

验证：

- `pnpm --filter @zarb/agent-harness test`

依赖：

- D2

可并行：

- 否

### D4. 在 retry prompt 中注入 relevant memories

目标：

- 避免 retry “失忆重来”

主改文件：

- `code-repair/prompt-builder.ts`
- `code-repair-agent.ts`

DoD：

- retry prompt 中明确出现 selected memories
- 相关单测断言注入成功

验证：

- `pnpm --filter @zarb/agent-harness test`

依赖：

- D3

可并行：

- 否

---

## 9. Epic E：Tool orchestration 升级

### E1. 引入 `ToolDescriptor`

目标：

- 从 “name + handler” 升级到结构化工具描述

主改文件：

- `packages/agent-harness/src/runtime/tool-registry.ts`

新增能力：

- `isReadOnly`
- `isConcurrencySafe`
- `summarizeResult`
- `modifyContext`

DoD：

- 旧接口仍可兼容一段时间，或一次性迁移所有注册点

验证：

- `pnpm --filter @zarb/agent-harness test`

依赖：

- A3

可并行：

- 可与 E2 并行

### E2. 新增 `ToolExecutionPlanner`

目标：

- 支持只读工具并发、写工具串行

主改文件：

- 新增 `packages/agent-harness/src/runtime/tool-execution-planner.ts`

DoD：

- planner 可接收一组 tool calls
- 能分批执行
- 返回更新后的 context

验证：

- 新增独立测试

依赖：

- A3

可并行：

- 可与 E1 并行

### E3. 将 exploration 切换到新 orchestration

目标：

- 让 exploration 不再手工维护大量 `recentToolResults` 拼接

主改文件：

- `exploration-agent.ts`
- `playwright-tool-provider.ts`

DoD：

- tool result summary 可自动生成
- exploration context 中 recent tool results 来源统一

验证：

- `pnpm --filter @zarb/agent-harness test -- exploration-agent`

依赖：

- B5
- E1
- E2

可并行：

- 否

### E4. 将 code-repair 切换到新 orchestration

目标：

- 让 code-repair 使用与 exploration 一致的工具执行模型

主改文件：

- `code-repair-agent.ts`

DoD：

- code repair 的只读工具可批量执行
- summary 能进入下一轮上下文

验证：

- `pnpm --filter @zarb/agent-harness test`

依赖：

- C5
- E1
- E2

可并行：

- 否

---

## 10. Epic F：迁移、清理与回归验证

### F1. 清理兼容层和旧导出

目标：

- 删除仅用于过渡的重复入口和废弃 re-export

主改文件：

- 各 `index.ts`
- 旧 import 调用点

DoD：

- 不再依赖旧路径
- 无 dead export

验证：

- `pnpm -r typecheck`

依赖：

- A4
- B5
- C6
- E4

可并行：

- 否

### F2. 补齐回归测试

目标：

- 为新结构补充回归保护

建议新增测试：

- runtime 层导出和 session 行为测试
- exploration brain / auth / prompt builder 测试
- code-repair plan/apply/verify/retry 测试
- task memory selection 测试
- tool execution planner 并发语义测试

DoD：

- 新增测试覆盖关键新模块
- 不低于现有 coverage 阈值

验证：

- `pnpm test`

依赖：

- F1

可并行：

- 可与 F3 局部并行

### F3. 文档同步

目标：

- 让设计文档、开发文档与实际结构一致

主改文件：

- `docs/agent-harness-design.md`
- `docs/exploration-prompt-design.md`
- `docs/code-task-design.md`
- `docs/agent-intelligence-refactor-plan.md`

DoD：

- 文档中的目录、导出、职责边界与代码一致

验证：

- 人工检查即可

依赖：

- F1

可并行：

- 可与 F2 并行

---

## 11. 推荐执行顺序

### 串行主线

1. A1
2. A2
3. A3
4. A4
5. B1
6. B2
7. B4
8. B5
9. C1
10. C2
11. C3
12. C4
13. C5
14. C6
15. D1
16. D2
17. D3
18. D4
19. E1
20. E2
21. E3
22. E4
23. F1
24. F2
25. F3

### 可并行批次

批次 P1：

- B1
- B3

批次 P2：

- C1
- C2

批次 P3：

- E1
- E2

批次 P4：

- F2
- F3

---

## 12. 适合无人值守执行的任务模板

每个子任务建议使用如下模板交给 coding agent：

```md
任务：<Task ID + 标题>

目标：
- ...

允许修改：
- <精确文件或目录>

不要修改：
- <明确排除项>

输入上下文：
- 阅读 <文档/文件>

完成标准：
- ...

验证：
- 运行 <命令>
- 若失败，先修复本任务引入的问题，再继续

产出：
- 代码
- 测试
- 简短变更说明
```

这个模板的关键点是 “写入边界明确”。否则无人值守开发最容易失控的地方就是任务范围膨胀。

---

## 13. 首批最值得启动的 5 个无人值守任务

如果只启动第一批，建议顺序如下：

1. A2：收缩 `agent-harness` 公共导出面
2. B1：抽出 `ExplorationPromptBuilder`
3. C1：新增 `AgentProfile`
4. C2：新增 `CodeRepairPromptBuilder`
5. C4：把 `CodexCliAgent` 降级为 transport

原因：

- 这 5 个任务都相对边界清晰
- 不直接触碰最复杂的主流程编排
- 做完后整个系统的后续演化空间会明显变大

---

## 14. 不适合无人值守的一类任务

以下任务不建议一开始就交给无人值守 agent 连续推进：

1. 一次性拆 package + 改所有 imports + 改所有测试
2. 同时重写 exploration 和 code repair 主流程
3. 一次性修改 storage schema、DTO、UI 展示、API 返回
4. 引入真正的多 agent 并行写代码

这些任务的问题不是做不到，而是失败半径太大。一旦中间某步判断失误，回滚成本高。

---

## 15. 最终执行建议

建议采用下面的推进方式：

1. 先按 Epic A 完成边界解耦。
2. 然后用 Epic B 把 exploration 从“大类”拆成组件。
3. 再用 Epic C 建立 code repair runtime。
4. 然后补上 Epic D 和 Epic E，让 runtime 真正有记忆和工具编排能力。
5. 最后做 Epic F 的清理和文档同步。

如果严格按这份 backlog 执行，这轮重构是可以基本无人值守推进的。真正需要人工判断的时刻，主要只会出现在：

- 是否拆成独立 package 还是先内部拆目录
- task memory 第一版是否要落表
- code repair 阶段是否立即引入结构化 CLI 输出

除此之外，绝大多数任务都已经可以直接开始实现。
# 执行状态更新（2026-04-03）

- `Epic A` 已完成
- `Epic B/C/D/E` 已完成核心落地并通过整仓验证
- `Epic F` 已完成回归测试与文档同步
