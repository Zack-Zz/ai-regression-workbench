# Agent 重构全量任务卡

> 执行状态（2026-04-03）
>
> 已一次性推进完成的主线能力：
> - `P0-A1 ~ P0-A4`
> - `P1-B1 ~ P1-B5`
> - `P1-C1 ~ P1-C6`
> - `P2-D1 ~ P2-D4`
> - `P3-E1 ~ P3-E4`
> - `P4-F1`
> - `P4-F2 ~ P4-F3`

## 1. 用途

本文档把以下两份文档进一步收敛成完整的、可连续执行的任务卡：

- [Agent 智能化重构方案](./agent-intelligence-refactor-plan.md)
- [Agent 无人值守开发任务清单](./agent-unattended-backlog.md)

目标是：

1. 覆盖全部任务，而不是只覆盖 Phase 0
2. 让后续执行不再依赖“继续拆任务”
3. 提供明确的串行顺序，适合一次性持续推进

如果只看一份执行文档，优先看本文档。

---

## 2. 一次性执行原则

这里的“一次性执行完”在工程上应理解为：

- 任务链条已经拆完整
- 不再需要中途补设计拆分
- 可以按顺序持续开发直到收尾

但仍然必须遵守两个现实约束：

1. 每个阶段结束后都要跑验证，失败先修复再继续
2. 不把多个高风险重构混成一个提交

因此，推荐方式不是“一个超大提交”，而是：

- 一条完整执行链
- 多个小步提交
- 每步可验证、可继续

---

## 3. 总执行顺序

严格串行主线：

1. P0-A1
2. P0-A2
3. P0-A3
4. P0-A4
5. P1-B1
6. P1-B2
7. P1-B3
8. P1-B4
9. P1-B5
10. P1-C1
11. P1-C2
12. P1-C3
13. P1-C4
14. P1-C5
15. P1-C6
16. P2-D1
17. P2-D2
18. P2-D3
19. P2-D4
20. P3-E1
21. P3-E2
22. P3-E3
23. P3-E4
24. P4-F1
25. P4-F2
26. P4-F3

推荐提交分组：

- Commit 1: P0-A1 ~ P0-A4
- Commit 2: P1-B1 ~ P1-B5
- Commit 3: P1-C1 ~ P1-C6
- Commit 4: P2-D1 ~ P2-D4
- Commit 5: P3-E1 ~ P3-E4
- Commit 6: P4-F1 ~ P4-F3

---

## 4. 通用执行约束

所有任务卡默认附带以下约束：

```md
执行约束：
- 只完成当前任务卡，不提前做下一张卡
- 优先兼容，不一次性删除旧入口
- 每次改动后同步修正受影响测试
- 如果验证失败，先修当前任务引入的问题
- 未经任务卡明确允许，不修改无关 package
```

通用验证命令池：

```bash
pnpm --filter @zarb/agent-harness typecheck
pnpm --filter @zarb/agent-harness build
pnpm --filter @zarb/agent-harness test
pnpm --filter @zarb/cli typecheck
pnpm --filter @zarb/cli build
pnpm test
pnpm -r typecheck
pnpm -r build
```

---

## 5. Phase 0：边界解耦

### P0-A1 建立 runtime / exploration / code-repair 目录边界

目标：

- 为后续重构建立明确目录边界

允许修改：

- `packages/agent-harness/src/`
- `packages/agent-harness/test/`

不要修改：

- `apps/*`
- `packages/storage/*`
- `packages/shared-types/*`

操作：

1. 创建目录：
   - `packages/agent-harness/src/runtime/`
   - `packages/agent-harness/src/exploration/`
   - `packages/agent-harness/src/code-repair/`
2. 在三个目录下创建占位 `index.ts`
3. 不迁移实现文件，只建立结构

完成标准：

- 新目录和 index 文件存在
- 现有 build/typecheck 不受影响

验证：

```bash
pnpm --filter @zarb/agent-harness typecheck
```

---

### P0-A2 收缩顶层导出面，建立子入口

目标：

- 把 runtime / exploration / code-repair 的导出面分开

允许修改：

- `packages/agent-harness/src/index.ts`
- `packages/agent-harness/src/runtime/index.ts`
- `packages/agent-harness/src/exploration/index.ts`
- `packages/agent-harness/src/code-repair/index.ts`
- `packages/agent-harness/package.json`

操作：

1. `runtime/index.ts` 导出 runtime primitives
2. `exploration/index.ts` 导出 exploration 相关实现
3. `code-repair/index.ts` 导出 code-repair transports
4. 顶层 `index.ts` 保留兼容 re-export，但按分组重写
5. 如果需要，为子入口添加 `exports`

完成标准：

- 子入口可用
- 顶层兼容保留

验证：

```bash
pnpm --filter @zarb/agent-harness typecheck
pnpm --filter @zarb/agent-harness build
```

---

### P0-A3 迁移 runtime 文件到 `runtime/`

目标：

- 让通用 runtime 脱离 exploration 语义

允许修改：

- `packages/agent-harness/src/session-manager.ts`
- `packages/agent-harness/src/tool-registry.ts`
- `packages/agent-harness/src/harness-policy.ts`
- `packages/agent-harness/src/observability.ts`
- `packages/agent-harness/src/observed-harness.ts`
- `packages/agent-harness/src/artifact-writer.ts`
- `packages/agent-harness/src/runtime/*`
- `packages/agent-harness/src/index.ts`
- `packages/agent-harness/test/*`

不要修改：

- `apps/*`
- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/playwright-tool-provider.ts`

操作：

1. 将通用 runtime 文件迁入 `src/runtime/`
2. 修正 import
3. 修正测试 import
4. 保持顶层兼容导出

完成标准：

- runtime 文件物理迁移完成
- tests 能通过

验证：

```bash
pnpm --filter @zarb/agent-harness typecheck
pnpm --filter @zarb/agent-harness build
pnpm --filter @zarb/agent-harness test
```

---

### P0-A4 更新 CLI 调用方到子入口

目标：

- CLI 不再只依赖混合顶层入口

允许修改：

- `apps/cli/src/harness-factory.ts`
- `apps/cli/src/services/run-service.ts`
- `apps/cli/src/services/code-task-service.ts`
- `apps/cli/src/server.ts`
- `apps/cli/test/integration.test.ts`

操作：

1. `harness-factory.ts` 改用 runtime 子入口
2. `run-service.ts` 改用 exploration 子入口
3. `code-task-service.ts` 改用 runtime + code-repair 子入口
4. `server.ts` 改用 code-repair 子入口
5. 更新 integration test mock 路径

完成标准：

- CLI import 分层清晰
- CLI build/test 正常

验证：

```bash
pnpm --filter @zarb/cli typecheck
pnpm --filter @zarb/cli build
pnpm test
```

---

## 6. Phase 1：exploration 拆层

### P1-B1 抽出 `ExplorationPromptBuilder`

目标：

- 让 prompt 构建脱离 `ExplorationAgent` 主类

允许修改：

- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/exploration/prompt-builder.ts`
- `packages/agent-harness/test/exploration-agent.test.ts`

操作：

1. 迁移：
   - `buildExplorationDecisionPrompt`
   - `buildExplorationPlanPrompt`
   - prompt context summary 相关函数
2. `ExplorationAgent` 改为调用 prompt builder
3. 测试迁移或新增独立测试

完成标准：

- 主类不再承载大段 prompt builder 函数

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P1-B2 抽出 `ExplorationBrain`

目标：

- 将 plan / decide / policy guard 决策逻辑独立

允许修改：

- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/exploration/brain.ts`
- `packages/agent-harness/test/exploration-agent.test.ts`

操作：

1. 抽离：
   - `planExplorationPhase`
   - `decideNextStep`
   - 主要 policy guard 决策
2. `ExplorationAgent` 只保留 orchestration

完成标准：

- `ExplorationBrain` 可独立测试

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P1-B3 抽出 `ExplorationFindingExtractor`

目标：

- 将 finding 提取和去重逻辑独立

允许修改：

- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/exploration/finding-extractor.ts`
- `packages/agent-harness/test/exploration-agent.test.ts`

操作：

1. 抽离 finding 提取
2. 抽离 dedupe key 逻辑

完成标准：

- finding extractor 独立存在

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P1-B4 抽出 `ExplorationAuthFlow`

目标：

- 将登录、captcha、auth gate 恢复从主类中抽离

允许修改：

- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/exploration/auth-flow.ts`
- `packages/agent-harness/test/exploration-agent.test.ts`

操作：

1. 迁移 `runAiLogin`
2. 迁移 captcha / slider 逻辑
3. 迁移 auth gate recovery 逻辑

完成标准：

- 主类不再直接承载完整 auth 细节

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P1-B5 抽出 `ExplorationBrowserAdapter`

目标：

- exploration 不直接依赖宽接口 browser provider

允许修改：

- `packages/agent-harness/src/playwright-tool-provider.ts`
- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/exploration/browser-adapter.ts`

操作：

1. 定义 exploration 需要的窄接口
2. 将 Playwright provider 包装成 adapter
3. `ExplorationAgent` 只依赖 adapter

完成标准：

- exploration 对 browser backend 的依赖面缩小

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

## 7. Phase 1：CodeRepair runtime 建立

### P1-C1 新增 `AgentProfile`

目标：

- 为所有 agent 建立统一 profile

允许修改：

- `packages/agent-harness/src/runtime/agent-profile.ts`
- 必要的导出文件

操作：

1. 定义 `AgentRole`
2. 定义 `AgentProfile`
3. 提供 exploration / code-repair 的基础 profile 常量

完成标准：

- runtime 层有统一 profile 模型

验证：

```bash
pnpm --filter @zarb/agent-harness typecheck
```

---

### P1-C2 新增 `CodeRepairPromptBuilder`

目标：

- 建立 code repair 分阶段 prompt

允许修改：

- `packages/agent-harness/src/code-repair/prompt-builder.ts`
- `packages/agent-harness/prompts/code-repair-plan/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-apply/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-verify/default@v1.txt`
- `packages/agent-harness/prompts/code-repair-retry/default@v1.txt`

操作：

1. 定义四类 prompt builder
2. 为每类 prompt 配类型
3. 为每类 prompt 配结构化输出 schema

完成标准：

- code repair prompt 全部模板化

验证：

```bash
pnpm --filter @zarb/agent-harness typecheck
```

---

### P1-C3 新增 `AgentContextAssembler`

目标：

- 用统一组件组装 code repair 上下文

允许修改：

- `packages/agent-harness/src/runtime/agent-context-assembler.ts`
- 相关测试

操作：

1. 输入支持：
   - CodeTaskRow
   - FailureAnalysis
   - verify 输出
   - constraints/scopePaths
2. 输出：
   - context object
   - summary string

完成标准：

- context assembler 可独立测试

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P1-C4 把 `CodexCliAgent` / `KiroCliAgent` 降级为 transport

目标：

- 明确它们只是 transport，不是完整 agent runtime

允许修改：

- `packages/agent-harness/src/codex-cli-agent.ts`
- `packages/agent-harness/src/kiro-cli-agent.ts`
- 导出文件
- 受影响 import

操作：

1. 保留兼容类名或新增 transport 别名
2. 扩充输入结构
3. 修正注释和语义

完成标准：

- 命名与职责更准确
- 不破坏现有调用方

验证：

```bash
pnpm --filter @zarb/agent-harness typecheck
pnpm --filter @zarb/agent-harness build
```

---

### P1-C5 新增 `CodeRepairAgent`

目标：

- 建立 `plan -> apply -> verify -> retry-decision` runtime

允许修改：

- `packages/agent-harness/src/code-repair/code-repair-agent.ts`
- `packages/agent-harness/src/code-repair/*`
- 相关测试

操作：

1. 定义阶段状态
2. 接入 `AgentProfile`
3. 接入 `AgentContextAssembler`
4. 接入 prompt builder
5. 接入 transport
6. 每阶段记录 session step / prompt sample

完成标准：

- 存在可运行的 code repair runtime

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P1-C6 `CodeTaskService` 切换到 `CodeRepairAgent`

目标：

- 让 app service 不再自己编排 CLI prompt execution

允许修改：

- `apps/cli/src/services/code-task-service.ts`
- `apps/cli/test/integration.test.ts`

操作：

1. `runExecution()` 调用 `CodeRepairAgent`
2. 保持现有 task 状态机兼容
3. 保持 artifact 生成和最终状态写入兼容

完成标准：

- CodeTask 执行路径切换到新 runtime

验证：

```bash
pnpm --filter @zarb/cli typecheck
pnpm --filter @zarb/cli build
pnpm test
```

---

## 8. Phase 2：Task memory

### P2-D1 定义 `CodeTaskMemoryEntry` 数据模型

目标：

- 建立 task memory 数据结构

允许修改：

- `packages/shared-types/src/*`
- `packages/storage/src/*`
- `scripts/sql/*`
- 相关测试

操作：

1. 定义 DTO / row / repo 接口
2. 如需落表，新增 migration
3. 暴露查询接口

完成标准：

- shared-types / storage 一致

验证：

```bash
pnpm -r typecheck
pnpm test
```

---

### P2-D2 新增 `CodeTaskMemory` 模块

目标：

- 提供 memory 记录与选择接口

允许修改：

- `packages/agent-harness/src/code-repair/code-task-memory.ts`
- 相关测试

操作：

1. 实现 `recordFailure`
2. 实现 `recordReview`
3. 实现 `selectRelevantMemories`

完成标准：

- 不依赖 LLM 也可工作

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P2-D3 在 `CodeRepairAgent` 中接入 memory 写入

目标：

- 将失败、verify、review 结果沉淀为 memory

允许修改：

- `packages/agent-harness/src/code-repair/code-repair-agent.ts`
- 相关测试

操作：

1. apply 失败写 memory
2. verify 失败写 memory
3. retry-decision 读取 memory

完成标准：

- 同任务的后续尝试可以读取前序结果

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P2-D4 在 retry prompt 注入 relevant memories

目标：

- 避免 retry 失忆

允许修改：

- `packages/agent-harness/src/code-repair/prompt-builder.ts`
- `packages/agent-harness/src/code-repair/code-repair-agent.ts`
- 相关测试

操作：

1. 把 selected memories 注入 retry prompt
2. 补充 prompt builder 测试

完成标准：

- retry prompt 可观察到相关 memory 注入

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

## 9. Phase 3：Tool orchestration 升级

### P3-E1 引入 `ToolDescriptor`

目标：

- 从简单 handler 注册升级到结构化工具描述

允许修改：

- `packages/agent-harness/src/runtime/tool-registry.ts`
- 相关测试

操作：

1. 支持：
   - `isReadOnly`
   - `isConcurrencySafe`
   - `summarizeResult`
   - `modifyContext`
2. 保留兼容注册方式或迁移全部调用

完成标准：

- tool registry 支持 richer metadata

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P3-E2 新增 `ToolExecutionPlanner`

目标：

- 支持只读并发、写入串行的 tool execution

允许修改：

- `packages/agent-harness/src/runtime/tool-execution-planner.ts`
- 相关测试

操作：

1. 按工具属性分批
2. 执行后汇总 context 更新

完成标准：

- planner 可独立测试

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P3-E3 exploration 切换到新 orchestration

目标：

- 让 exploration 的 recent tool results 不再主要靠手工拼接

允许修改：

- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/playwright-tool-provider.ts`
- `packages/agent-harness/src/exploration/*`

操作：

1. exploration 通过 `ToolExecutionPlanner` 驱动工具调用
2. tool summaries 自动生成并回流上下文

完成标准：

- exploration 工具执行模型统一

验证：

```bash
pnpm --filter @zarb/agent-harness test
```

---

### P3-E4 code-repair 切换到新 orchestration

目标：

- 让 code-repair 与 exploration 使用相同的工具执行模型

允许修改：

- `packages/agent-harness/src/code-repair/*`
- 相关测试

操作：

1. 将 code-repair 的只读操作接入 planner
2. 将 tool summaries 回流到下一轮上下文

完成标准：

- code-repair 工具执行与上下文演化统一

验证：

```bash
pnpm --filter @zarb/agent-harness test
pnpm test
```

---

## 10. Phase 4：迁移、清理、回归

### P4-F1 清理兼容层和旧导出

目标：

- 删除过渡期重复路径和无用导出

允许修改：

- 各 `index.ts`
- 旧 import 调用点
- `package.json` exports

操作：

1. 清理仅用于过渡的 re-export
2. 更新所有调用方到稳定入口

完成标准：

- 不再依赖旧入口

验证：

```bash
pnpm -r typecheck
pnpm -r build
```

---

### P4-F2 补齐回归测试

目标：

- 给新结构补足回归保护

允许修改：

- `packages/*/test/*`
- `apps/*/test/*`

建议新增测试：

- runtime 层 smoke tests
- exploration brain / auth / prompt builder tests
- code-repair runtime tests
- task memory tests
- tool execution planner tests

完成标准：

- 覆盖关键新模块
- 不低于现有 coverage 要求

验证：

```bash
pnpm test
```

---

### P4-F3 同步设计文档

目标：

- 让文档与最终结构一致

允许修改：

- `docs/agent-harness-design.md`
- `docs/exploration-prompt-design.md`
- `docs/code-task-design.md`
- `docs/agent-intelligence-refactor-plan.md`
- `docs/agent-unattended-backlog.md`
- `docs/agent-task-cards-phase0.md`

操作：

1. 更新目录结构
2. 更新导出路径
3. 更新职责边界
4. 标记已完成阶段

完成标准：

- 文档与代码一致

验证：

- 人工检查

---

## 11. 推荐交付格式

每张卡完成后建议用下面格式回报：

```md
完成项：
- ...

修改文件：
- ...

验证：
- `...` 通过
- `...` 通过

兼容性影响：
- ...

剩余风险：
- ...
```

---

## 12. 最终说明

到这里，任务拆分已经补全了。

现在后续不再缺：

- 设计文档
- backlog
- Phase 0 任务卡
- 全量任务卡

也就是说，从任务管理角度，已经满足你要求的“把所有任务一次性制作完并告诉你”。
