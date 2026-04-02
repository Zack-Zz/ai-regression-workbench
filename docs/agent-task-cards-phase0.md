# Agent 重构 Phase 0 任务卡

## 1. 用途

本文档是 [Agent 无人值守开发任务清单](./agent-unattended-backlog.md) 的执行版，聚焦 Phase 0：

- A1 建立目录边界
- A2 收缩 `agent-harness` 导出面
- A3 迁移 runtime 文件
- A4 更新调用方到新入口

这些任务卡可以直接复制给 coding agent 使用。

原则：

- 每张卡只解决一个问题
- 允许修改范围明确
- 有自动验证命令
- 不要求一次性完成整个重构

---

## 2. 执行顺序

严格顺序：

1. P0-A1
2. P0-A2
3. P0-A3
4. P0-A4

不要并行执行。Phase 0 的核心目标是稳定收缩边界，不是提速。

---

## 3. 任务卡

### P0-A1：建立 runtime / exploration / code-repair 目录边界

任务目标：

- 在 `packages/agent-harness` 内先建立明确的子目录边界
- 这一步只做结构准备，不做行为改造

允许修改：

- `packages/agent-harness/src/`
- `packages/agent-harness/test/`
- 必要时更新 `docs/agent-unattended-backlog.md` 中的执行状态说明

不要修改：

- `apps/*`
- `packages/storage/*`
- `packages/shared-types/*`
- `apps/cli/src/services/*`

建议创建：

- `packages/agent-harness/src/runtime/index.ts`
- `packages/agent-harness/src/exploration/index.ts`
- `packages/agent-harness/src/code-repair/index.ts`

建议实现：

1. 建立上述目录和占位 `index.ts`
2. 暂时只做 re-export 或空导出，不迁移具体实现
3. 顶层 `src/index.ts` 暂不删除旧导出
4. 加少量注释，说明 Phase 0 之后 runtime / exploration / code-repair 将分流

完成标准：

- 新目录存在
- 新 index 文件存在
- `@zarb/agent-harness` 仍能正常 typecheck

验证命令：

```bash
pnpm --filter @zarb/agent-harness typecheck
```

交付说明模板：

- 创建了哪些目录和文件
- 是否引入行为变化
- typecheck 是否通过

---

### P0-A2：收缩 `agent-harness` 顶层导出面，建立子入口

任务目标：

- 不再让所有 runtime、exploration、code-repair 能力都只通过顶层入口暴露
- 建立清晰的模块入口，但保留兼容

允许修改：

- `packages/agent-harness/src/index.ts`
- `packages/agent-harness/src/runtime/index.ts`
- `packages/agent-harness/src/exploration/index.ts`
- `packages/agent-harness/src/code-repair/index.ts`
- `packages/agent-harness/package.json`

不要修改：

- `apps/*`
- 任何业务逻辑文件

当前已知顶层混合导出包括：

- runtime：
  - `HarnessSessionManager`
  - `ToolRegistry`
  - `ArtifactWriter`
  - `ObservedHarness`
  - policies
- code repair transport：
  - `CodexCliAgent`
  - `KiroCliAgent`
- exploration：
  - `ExplorationAgent`
  - `PlaywrightToolProvider`

建议实现：

1. `runtime/index.ts` 导出：
   - `HarnessSessionManager`
   - `ToolRegistry`
   - `ArtifactWriter`
   - `ObservedHarness`
   - `HarnessPolicy`
   - observability types
2. `exploration/index.ts` 导出：
   - `ExplorationAgent`
   - `PlaywrightToolProvider`
   - exploration types
3. `code-repair/index.ts` 导出：
   - `CodexCliAgent`
   - `KiroCliAgent`
4. 顶层 `src/index.ts` 保留兼容 re-export，但按分组重写，并加注释说明“顶层导出仅为兼容，后续调用方应迁移到子入口”
5. 如果需要，可在 `package.json` 的 `exports` 中为子入口预留导出

完成标准：

- 子入口存在且可导入
- 顶层入口仍兼容
- 没有行为改动

验证命令：

```bash
pnpm --filter @zarb/agent-harness typecheck
pnpm --filter @zarb/agent-harness build
```

交付说明模板：

- 新增了哪些子入口
- 顶层兼容策略是什么
- 是否更新了 `exports`

---

### P0-A3：迁移通用 runtime 文件到 `runtime/`

任务目标：

- 把通用 runtime 能力从 exploration 语义中剥离出来

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
- `packages/storage/*`
- `packages/shared-types/*`
- `packages/agent-harness/src/exploration-agent.ts`
- `packages/agent-harness/src/playwright-tool-provider.ts`

建议实现：

1. 将以下文件物理迁移到 `src/runtime/`：
   - `session-manager.ts`
   - `tool-registry.ts`
   - `harness-policy.ts`
   - `observability.ts`
   - `observed-harness.ts`
   - `artifact-writer.ts`
2. 更新内部 import 路径
3. 顶层 `src/index.ts` 改为从 `runtime/*` re-export
4. 更新测试 import：
   - `packages/agent-harness/test/agent-harness.test.ts`
   - `packages/agent-harness/test/observed-harness.test.ts`
5. 禁止在 runtime 层新引入任何 `Exploration`、`Playwright`、`Finding` 词汇或依赖

完成标准：

- runtime 文件已迁移到 `runtime/`
- tests import 已修正
- `agent-harness` build/test/typecheck 全通过

验证命令：

```bash
pnpm --filter @zarb/agent-harness typecheck
pnpm --filter @zarb/agent-harness build
pnpm --filter @zarb/agent-harness test
```

交付说明模板：

- 迁移了哪些文件
- 更新了哪些测试 import
- 是否发现 runtime 对 exploration 的反向依赖

---

### P0-A4：更新 CLI 调用方到子入口

任务目标：

- 让 `apps/cli` 显式依赖 runtime / exploration / code-repair 子入口
- 不再全部从 `@zarb/agent-harness` 顶层混合入口导入

允许修改：

- `apps/cli/src/harness-factory.ts`
- `apps/cli/src/services/run-service.ts`
- `apps/cli/src/services/code-task-service.ts`
- `apps/cli/src/server.ts`
- `apps/cli/test/integration.test.ts`
- 必要时 `apps/cli/package.json`

不要修改：

- `packages/storage/*`
- `packages/shared-types/*`
- `apps/local-ui/*`
- `apps/orchestrator/*`

当前已知受影响 import 点：

- `apps/cli/src/harness-factory.ts`
- `apps/cli/src/services/run-service.ts`
- `apps/cli/src/services/code-task-service.ts`
- `apps/cli/src/server.ts`
- `apps/cli/test/integration.test.ts`

建议迁移方向：

1. `harness-factory.ts`
   - runtime 相关 import 改到 `@zarb/agent-harness/runtime`
2. `run-service.ts`
   - exploration 相关 import 改到 `@zarb/agent-harness/exploration`
3. `code-task-service.ts`
   - runtime 相关 import 改到 `@zarb/agent-harness/runtime`
   - code repair transport 改到 `@zarb/agent-harness/code-repair`
4. `server.ts`
   - `CodexCliAgent` / `KiroCliAgent` 改到 `@zarb/agent-harness/code-repair`
5. `integration.test.ts`
   - 按新的入口 mock
   - 避免继续 mock 顶层混合入口

完成标准：

- CLI 代码不再依赖混合顶层入口来获取所有能力
- 集成测试 mock 路径同步更新
- `apps/cli` build/typecheck/test 通过

验证命令：

```bash
pnpm --filter @zarb/cli typecheck
pnpm --filter @zarb/cli build
pnpm test
```

交付说明模板：

- 改了哪些 import 路径
- 是否还保留顶层入口兼容依赖
- 哪些测试 mock 做了同步调整

---

## 4. 给 coding agent 的统一约束

把任务卡交给 coding agent 时，建议附加下面这段约束：

```md
约束：
- 只完成当前任务卡，不提前做下一张卡
- 不做额外架构扩展
- 优先保持兼容，不一次性删除旧入口
- 所有路径修改后，必须同步修正测试 import
- 完成后必须运行任务卡里的验证命令
- 如果验证失败，先修当前任务引入的问题，不要扩散改动范围
```

---

## 5. 推荐交付格式

要求 coding agent 在完成每张卡后按下面格式回报：

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

## 6. 下一批任务

Phase 0 完成后，下一批最适合继续收敛成任务卡的是：

- B1 `ExplorationPromptBuilder`
- B2 `ExplorationBrain`
- C1 `AgentProfile`
- C2 `CodeRepairPromptBuilder`

这四张卡会直接决定后面重构的速度和稳定性。
