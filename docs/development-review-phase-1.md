# Phase 1 开发 Review 记录

> 评审日期：2026-03-14
> 评审范围：Phase 1 shared contracts + config
> 当前结论：未通过，存在设计契约缺口和一个配置实现 bug

## 1. 结论

Phase 1 的基础类型与配置加载器已经起出来，基线命令也能通过，但当前实现还没有满足本阶段的完整退出条件。

本轮 review 发现 1 个高优先级问题和 2 个中优先级问题，需要先修复，再进入下一阶段。

## 2. Findings

### 2.1 High

- `loadSettingsFromFile()` 返回的配置对象会和 `DEFAULT_SETTINGS` 共享嵌套引用
  - 当前实现只对顶层做浅拷贝，未覆盖到的嵌套对象仍直接复用默认配置对象。
  - 这会导致运行时一旦修改返回值，就可能反向污染全局默认配置。
  - 相关文件：
    - `packages/config/src/loader.ts`
    - `packages/config/src/defaults.ts`
  - 风险：
    - 后续 `ConfigManager`、`SettingsService`、观察者广播都可能基于被污染的默认值继续工作，产生难以定位的跨请求副作用。

### 2.2 Medium

- Phase 1 承诺的 `ConfigManager / SettingsService` 关键能力还未实现
  - 当前 `packages/config` 仅暴露 `loadSettingsFromFile / buildSnapshot / resolveExplorationConfig` 三个 helper，没有 `getSettings / validateSettings / updateSettings` 这一层，也没有观察者广播入口。
  - 相关文件：
    - `packages/config/src/index.ts`
    - `docs/design.md`
    - `.kiro/steering/module-roadmap.md`
  - 风险：
    - Phase 1 的“config manager”交付物仍缺失，后续 Phase 2/4/5 需要的配置读取、更新、生效语义还无可复用实现。

- `CodeTask` 终态集合定义错误，遗漏了 `FAILED`
  - 设计文档把 `FAILED` 明确列为异常终态，但当前 `CODE_TASK_TERMINAL_STATUSES` 只包含 `COMMITTED / REJECTED / CANCELLED`。
  - 相关文件：
    - `packages/shared-types/src/enums.ts`
    - `docs/design.md`
  - 风险：
    - 后续 orchestrator / review / retry 逻辑如果依赖这个集合判断任务是否结束，会把失败任务当成“仍可推进”的中间态。

## 3. 验证结果

本轮实际执行结果如下：

- `pnpm -r typecheck`
  - 结果：通过
- `pnpm lint`
  - 结果：通过
- `pnpm build`
  - 结果：通过
- `pnpm test`
  - 结果：通过
  - 备注：当前仅有 `packages/config/src/loader.test.ts`

另外做了一个最小复现验证：

- 使用 `loadSettingsFromFile()` 读取一个不存在的配置文件后，修改返回值中的 `ai.model`
- 结果会直接污染 `DEFAULT_SETTINGS.ai.model`
- 说明当前 loader 确实存在共享引用问题

## 4. 修复建议

- 调整 loader 的默认值复制策略，确保返回对象与 `DEFAULT_SETTINGS` 深度隔离。
- 在 `packages/config` 中补出 Phase 1 设计要求的 `ConfigManager / SettingsService` 最小实现，至少覆盖：
  - `getSettings`
  - `validateSettings`
  - `updateSettings`
  - snapshot version 管理
  - 配置观察者注册/广播入口
- 修正 `CODE_TASK_TERMINAL_STATUSES`，将 `FAILED` 纳入终态集合。
- 为上述行为补测试，尤其是：
  - 默认配置不可被调用方修改污染
  - snapshot version 递增/并发保护
  - 配置校验失败路径
  - `FAILED` 被判定为终态

## 5. 后续要求

建议在修复后，至少重新执行以下校验：

- `pnpm -r typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
