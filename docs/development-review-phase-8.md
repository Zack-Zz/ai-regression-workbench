# Development Review Phase 8

## 1. Metadata

- Review target: Phase 8 Local UI and Preview Alignment
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: `apps/local-ui`, `docs/ui-preview`, Phase 8 design alignment
- Related phase: Phase 8
- Related previous reviews:
  - `development-review-phase-7-recheck-2.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - UI 包本身可以单独构建，但当前实现和 Phase 8 设计还有多处可见行为差距，preview 与真实 UI 也没有完全对齐。

## 3. Scope

- Reviewed modules:
  - `apps/local-ui/src/components`
  - `apps/local-ui/src/pages`
  - `apps/local-ui/src/api.ts`
  - `apps/local-ui/src/i18n.ts`
- Reviewed docs/contracts:
  - `docs/local-ui-design.md`
  - `docs/ui-preview/*.html`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 9 observability / doctor
  - CLI/API 层正确性本身

## 4. Findings

### High

- QuickRunPanel is missing required Phase 8 inputs and preflight context
  - Evidence:
    - 设计要求 `QuickRunPanel` 在 `exploration / hybrid` 下支持 `focusAreas`，并在提交前展示 `target workspace`、共享测试目录状态和预计权限级别，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L49](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L49)。
    - 当前实现只支持 `runMode`、`selectorType`、`selectorValue`、`startUrls`、`allowedHosts`、`maxSteps`、`maxPages`，没有 `focusAreas`，也没有任何 workspace/shared-assets/permission 信息，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/components/QuickRunPanel.tsx#L12](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/components/QuickRunPanel.tsx#L12)。
    - preview 首页仍把这些能力作为可见工作流展示，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/index.html#L47](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/index.html#L47)。
  - Impact:
    - Phase 8 的 `runMode / selectorType` 可视化只做了一半，exploration / hybrid 的关键配置和执行前上下文仍然不可见。
  - Suggested fix:
    - 补齐 `focusAreas` 输入，并接入 workspace/shared-assets 状态读取，在 Quick Run 区域显示目标目录、共享目录状态和权限级别提示。

- SettingsPage omits multiple required config groups and result semantics
  - Evidence:
    - 设计要求设置页至少覆盖 `Storage`、`Workspace`、`Test Assets`、`Diagnostics`、`Trace / Logs`、`AI / CodeAgent`、`Report / UI`，并在保存后展示 `reloadedModules / nextRunOnlyKeys`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L116](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L116) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L126](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L126)。
    - 当前实现只渲染了 `Storage`、`Workspace`、`AI`、`Report` 四组，缺失 `Test Assets`、`Diagnostics`、`Trace / Logs`、`CodeAgent` 配置项；保存成功后也只显示通用成功消息和 `restartRequired`，没有把 `nextRunOnlyKeys` 或 `reloadedModules` 展示出来，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/pages/SettingsPage.tsx#L77](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/pages/SettingsPage.tsx#L77)。
    - preview 设置页已经把这些结果做成显式区块，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/settings.html#L48](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/settings.html#L48) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/settings.html#L83](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/settings.html#L83)。
  - Impact:
    - 用户无法在 UI 中完整管理个人配置，也看不到设计要求的“哪些模块立即重载、哪些字段仅下次运行生效”。
  - Suggested fix:
    - 补全缺失分组和字段，并把 `SettingsApplyResult` 的 `reloadedModules / nextRunOnlyKeys / requiresRestart` 全量展示出来。

- FailureReportPage still hides trace/log diagnostics required by the UI design
  - Evidence:
    - 设计要求错误报告页展示 `TraceSummary` 和 `LogSummary`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L71](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L71)。
    - 当前页面只拉取 `failure-report`、`analysis`、`execution-profile`，没有调用 `getTrace()` 或 `getLogs()`，也没有渲染 trace/log 摘要，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/pages/FailureReportPage.tsx#L14](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/pages/FailureReportPage.tsx#L14)。
    - API client 实际已经提供了 `getTrace()` / `getLogs()`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/api.ts#L43](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/api.ts#L43)。
  - Impact:
    - 失败页无法显示关键诊断证据，用户仍需要跳出 UI 才能理解 trace/log 侧的异常。
  - Suggested fix:
    - 在失败页并行加载 `trace` 和 `logs`，补 TraceSummary / LogSummary 卡片，至少显示 rawLink、错误摘要和高亮信息。

### Medium

- Review / Commit workflow in the app is still behind the documented preview
  - Evidence:
    - preview 明确展示了独立的 `Review / Commit` 页面、`expectedTaskVersion` 和 verify override 风险提示，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/review-commit.html#L29](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/ui-preview/review-commit.html#L29)。
    - 当前应用没有对应路由，`App` 里只有 `CodeTaskDetailPage`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/App.tsx#L14](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/App.tsx#L14)；提交动作也没有传 `expectedTaskVersion`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/pages/CodeTaskDetailPage.tsx#L109](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/src/pages/CodeTaskDetailPage.tsx#L109)。
    - 设计约束还要求 Run / CodeTask 详情明确展示 `verify override` 等审计信息，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L225](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md#L225)。
  - Impact:
    - review versioning 和 verify override 只做到了部分可见，review/commit 的真实工作流与 preview 不一致。
  - Suggested fix:
    - 至少把 `expectedTaskVersion` 和 verify override 风险提示补进现有 CodeTask 页面；如果继续保留 preview 的独立页方案，就同步补路由和页面。

- Root build/test workflow still does not cover `local-ui`
  - Evidence:
    - 根构建脚本仍显式排除了 `@zarb/local-ui`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json#L15](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json#L15)。
    - `apps/local-ui` 当前也没有任何测试目录，`find apps/local-ui/test` 返回空。
  - Impact:
    - Phase 8 之后 UI 可以在本地单独构建，但不会被根级 build/test 持续覆盖，后续回归风险较高。
  - Suggested fix:
    - 把 `@zarb/local-ui` 纳入根构建，至少补一个 UI smoke test 或 route-level render test。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm --filter @zarb/local-ui build`
- Additional checks:
  - 对照 `docs/local-ui-design.md` 和 `docs/ui-preview/*.html` 逐页检查
  - 检查 `src/` 与 `test/` 目录隔离
- Result summary:
  - 根级命令和 `local-ui` 单独构建都通过；当前问题集中在 UI 能力缺口和 preview 对齐不足。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `UI behavior matches local-ui design`
    - Result:
      - fail
    - Notes:
      - Quick Run、Settings、Failure Report、Review/Commit 仍有明显能力缺口。
  - Criterion:
    - `preview HTML is updated for visible workflow changes`
    - Result:
      - fail
    - Notes:
      - preview 展示的 review/commit 与 settings 结果，比真实 UI 更完整，当前是 app 落后于 preview。
  - Criterion:
    - `runMode, selectorType, findings embedding, review versioning, and settings restart semantics are visible`
    - Result:
      - fail
    - Notes:
      - `runMode / selectorType / findings / restartRequired` 基本可见，但 review versioning 和 settings 应用结果仍不完整。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: no
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - `apps/local-ui` 当前没有测试；其余已存在测试的模块未发现 `src/**/*.test.*`。

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 补齐 Quick Run 的 `focusAreas` 和预提交上下文展示
  - 补齐 SettingsPage 的配置分组与保存结果信息
  - 在 Failure Report 页展示 trace/log 摘要
  - 收口 review/commit 工作流与 preview 的差异
  - 把 `local-ui` 纳入根构建/测试覆盖
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果现在直接进入 Phase 9，UI 将继续作为“部分可用 demo”，而不是与设计一致的主工作台。
