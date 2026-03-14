# Phase 1 开发 Review 复核记录 01

> 评审日期：2026-03-14
> 评审范围：Phase 1 修复后复核
> 当前结论：未完全通过，仍有 1 个版本语义问题

## 1. 结论

上轮 Phase 1 review 中提出的以下问题已确认修复：

- `loadSettingsFromFile()` 不再污染 `DEFAULT_SETTINGS`
- `CODE_TASK_TERMINAL_STATUSES` 已纳入 `FAILED`
- `packages/config` 已补出 `ConfigManager`

但 `SettingsSnapshot.version` 目前仍然只在内存中递增，未跨进程/重建实例保持，因此 `expectedVersion` 的并发保护语义还没有真正成立。

## 2. Findings

### 2.1 Medium

- `ConfigManager` 的版本号在重新创建实例后会重置为 `1`
  - 当前构造函数总是以 `buildSnapshot(configPath, 1, ...)` 初始化快照。
  - `updateSettings()` 虽然会把内存版本加一，但没有把 version 持久化到文件或其他可恢复位置。
  - 结果是：同一配置文件在“重启进程 / 新建 manager”后，`SettingsSnapshot.version` 会丢失。
  - 相关文件：
    - `packages/config/src/config-manager.ts`
  - 风险：
    - `UpdateSettingsInput.expectedVersion` 无法跨重启提供有效并发保护。
    - 这和设计里“维护配置版本号，避免并发覆盖”的要求仍不一致。

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

另外做了一个最小复现：

1. 创建 `ConfigManager(file)`
2. 调用一次 `updateSettings()`，版本升到 `2`
3. 重新创建新的 `ConfigManager(file)`
4. 读取快照，版本重新变回 `1`

说明当前 version 仍未持久化。

## 4. 修复建议

- 为 `SettingsSnapshot.version` 增加可恢复的持久化来源，不要只保存在内存里。
- 为“更新后重建实例仍保留 version”补测试，确保 `expectedVersion` 语义跨进程仍成立。

