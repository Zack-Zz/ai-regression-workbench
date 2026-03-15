# Development Review Phase 9

## 1. Metadata

- Review target: Phase 9 Observability and Doctor
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: `packages/agent-harness` observability wrapper, `apps/cli` doctor capability
- Related phase: Phase 9
- Related previous reviews:
  - `development-review-phase-8-recheck-1.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - `ObservedHarness` 和 `DoctorService` 已经有基础实现，但当前还缺少生产装配和完整的 CLI / schema 一致性语义，Phase 9 不能判定为完成。

## 3. Scope

- Reviewed modules:
  - `packages/agent-harness/src/observed-harness.ts`
  - `packages/agent-harness/src/observability.ts`
  - `packages/agent-harness/test/observed-harness.test.ts`
  - `apps/cli/src/services/doctor-service.ts`
  - `apps/cli/src/handlers/index.ts`
  - `apps/cli/src/server.ts`
  - `apps/cli/test/doctor.test.ts`
- Reviewed docs/contracts:
  - `docs/observability-design.md`
  - `docs/packaging-design.md`
  - `docs/app-services-design.md`
  - `docs/design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 10 hardening
  - UI 侧 doctor 展示

## 4. Findings

### High

- `ObservedHarness` exists, but there is no production integration point using it
  - Evidence:
    - Phase 9 deliverable 明确要求 `ObservedHarness integration point`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md#L194](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md#L194)。
    - 设计要求实际装配应发生在依赖组装层，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/observability-design.md#L41](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/observability-design.md#L41)。
    - 当前 `ObservedHarness` 只在包导出和测试中出现，没有任何生产代码实例化它，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/index.ts#L16](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/index.ts#L16) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/test/observed-harness.test.ts#L35](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/test/observed-harness.test.ts#L35)。
  - Impact:
    - 现在只有“可被使用的装饰器”，没有“实际接入点”。Phase 9 的 observability 交付还停留在库级能力，不是系统集成能力。
  - Suggested fix:
    - 在 orchestrator 或应用组装层增加显式装配路径，例如按配置将 `HarnessSessionManager` 包装成 `ObservedHarness`，并补集成测试验证可选降级行为。

- `doctor` is still not exposed as the documented CLI command
  - Evidence:
    - 文档明确把 `zarb doctor` 作为 CLI 当前最小命令集的一部分，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L16](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L16)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2981](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2981)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/packaging-design.md#L197](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/packaging-design.md#L197)。
    - 当前实现只有 `DoctorService`、HTTP `/doctor` 和导出，没有任何 CLI 参数解析、bin 入口或 `doctor()` 命令分发，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L220](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L220)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/index.ts#L1](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/index.ts#L1)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json#L1](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json#L1)。
  - Impact:
    - Phase 9 的 doctor 能力目前只能作为内部服务或 API 调用，未形成文档承诺的本地工具命令入口。
  - Suggested fix:
    - 增加 CLI 可执行入口和 `doctor` 子命令，至少支持本地打印检查结果和合适的退出码。

### Medium

- `sqlite.schema` check still misses the “unexpected migration” side of schema consistency
  - Evidence:
    - Phase 9 exit criteria强调的是 “schema version consistency, not just pending migrations”，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md#L201](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md#L201)。
    - 当前 `DoctorService` 只检查 `EXPECTED_MIGRATIONS` 是否缺失，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/doctor-service.ts#L84](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/doctor-service.ts#L84)。如果数据库里多出未知 migration version，它仍会返回 `ok`。
    - 现有测试也只覆盖“缺失 migration”场景，没有覆盖“存在未知 migration”场景，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/doctor.test.ts#L54](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/doctor.test.ts#L54)。
  - Impact:
    - 一个 schema 已漂移但“没有缺失预期 migration”的数据库会被误判为健康。
  - Suggested fix:
    - 在 `sqlite.schema` 检查里同时校验“缺失 expected”与“存在 unexpected”，并补对应测试。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - 搜索 `ObservedHarness` 的生产装配点
  - 搜索 CLI `doctor` 命令入口
  - 交叉核对 `doctor` 检查项与 Phase 9 / packaging 设计
- Result summary:
  - 所有基线命令都通过；当前问题是 Phase 9 的装配和命令入口没有完整闭环，不是工程基线失败。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `observability remains optional`
    - Result:
      - pass with notes
    - Notes:
      - `ObservedHarness` 本身是可选且能安全降级，但目前还未真正接入生产路径。
  - Criterion:
    - `doctor checks schema version consistency, not just pending migrations`
    - Result:
      - fail
    - Notes:
      - 只检查了“缺 expected migration”，没有检查“多 unexpected migration”。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 把 `ObservedHarness` 真正接到生产装配路径
  - 提供 CLI `doctor` 命令入口
  - 补齐 `sqlite.schema` 的 unexpected migration 检查与测试
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果直接进入 Phase 10，observability 和 doctor 仍然更像“内部组件”而不是完整交付能力。
