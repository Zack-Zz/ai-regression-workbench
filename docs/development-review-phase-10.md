# Development Review: Phase 10

## 1. Metadata

- Review target: Phase 10 Hardening
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: hardening deliverables, regression protection depth, Phase 10 exit criteria
- Related phase: Phase 10
- Related previous reviews:
  - [development-review-phase-9-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-9-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 基线命令全部通过，但 Phase 10 承诺的 hardening 交付还没有完全闭环。当前主要新增的是一组 Node 层 integration tests；`selected e2e coverage`、真正的跨层 `contract consistency checks`、以及更严格的 `migration regression checks` 还没有达到路线图要求。

## 3. Scope

- Reviewed modules:
  - `apps/cli/test/integration.test.ts`
  - `apps/cli/test/api.test.ts`
  - `apps/local-ui/test/i18n.test.ts`
  - `vitest.config.ts`
- Reviewed docs/contracts:
  - [.kiro/steering/module-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md)
  - [api-contract-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md)
- Explicitly out of scope:
  - 新功能实现正确性之外的性能压测
  - 未来阶段的 SSE、真实 AI provider 集成

## 4. Findings

### High

- Selected e2e coverage is still missing
  - Evidence:
    - Phase 10 明确把 `selected e2e coverage` 作为交付物，见 [module-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md#L212)。
    - 当前测试入口仍然只有 Node 环境下的 vitest，见 [vitest.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/vitest.config.ts#L4)。
    - `apps/` 下实际测试文件只有 `ai-engine`、`cli`、`orchestrator` 的单元/集成测试，以及一个本地化测试 [i18n.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/test/i18n.test.ts#L1)；没有任何 `e2e` 目录或浏览器工作流测试。
  - Impact:
    - Phase 10 无法证明“realistic flows”已经在真实 UI/browser 路径上被锁住，前端路由、轮询、表单交互、review/commit 可见工作流仍然可能出现未被覆盖的回归。
  - Suggested fix:
    - 至少补一组 Playwright 级别的选定 e2e，用真实浏览器覆盖 `Quick Run -> Run Detail`、`CodeTask Review/Commit`、`Settings save/reload feedback` 这类关键路径。

### High

- Contract consistency checks only prove “some endpoints are not 404”, not “no contract drift”
  - Evidence:
    - Phase 10 退出条件要求 `no contract drift between design, API, storage, and preview layers`，见 [module-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md#L219)。
    - 当前集成测试的 contract 段落标题写的是 “all documented endpoints respond correctly”，但实现只对一小部分接口做了 `status !== 404` 断言，见 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L2) 和 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L235)。
    - 契约文档还定义了 testcase 级的 `failure-report / execution-profile / diagnostics / trace / logs / analysis` 等接口与稳定错误码/状态码语义，见 [api-contract-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L50) 和 [api-contract-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L103)。
  - Impact:
    - 现在的测试会给出“contract consistency 已完成”的错觉，但实际上既没有覆盖全部文档接口，也没有验证响应体形状、错误码、状态码，当然更没有检查 preview/storage 层漂移。
  - Suggested fix:
    - 把这部分拆成明确的 contract tests：
      - 覆盖文档列出的全部 HTTP 路由；
      - 校验关键成功/失败响应结构与 `errorCode`/HTTP status；
      - 至少增加一组 preview/API 字段对齐检查，避免“只测接口存在，不测对外契约”。

### Medium

- Migration regression checks are too shallow and one test title is stronger than its actual assertion
  - Evidence:
    - 当前 migration 回归只验证了重复执行不抛错、7 张表存在，以及 `_migrations.version` 是非空字符串，见 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L340)。
    - 名为 `_migrations records match scripts/sql directory` 的测试，实际上并没有对比 `scripts/sql` 目录，只检查了字符串非空，见 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L353)。
  - Impact:
    - 漏跑 migration、额外脏 migration、关键列或索引漂移，都可能在现有“回归检查”下漏过去；测试名还会误导后续维护者以为已经做了目录一致性校验。
  - Suggested fix:
    - 直接比对 `scripts/sql/*.sql` 与 `_migrations` 记录；
    - 增加关键表/列/索引断言，而不只是表名存在；
    - 让测试名和真实断言保持一致，避免假阳性。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - 审阅 Phase 10 路线图与 exit criteria
  - 审阅 `apps/cli/test/integration.test.ts`、`apps/cli/test/api.test.ts`
  - 检查 `apps/` 下现有测试文件分布，确认是否存在 e2e 资产
- Result summary:
  - 三个基线命令都通过。
  - 当前结论为 `fail`，原因是 hardening 的覆盖深度仍不足，不是工程基线失败。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `integration tests`
    - Result:
      - pass
    - Notes:
      - 已新增 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L1)。
  - Criterion:
    - `selected e2e coverage`
    - Result:
      - fail
    - Notes:
      - 当前未见真实浏览器/e2e 测试资产。
  - Criterion:
    - `contract consistency checks`
    - Result:
      - fail
    - Notes:
      - 目前只验证了部分接口“不是 404”，没有达到“no contract drift”。
  - Criterion:
    - `migration regression checks`
    - Result:
      - fail
    - Notes:
      - 当前断言过浅，且目录一致性并未真正校验。
  - Criterion:
    - `critical flows are covered`
    - Result:
      - pass with notes
    - Notes:
      - 服务层关键流有覆盖，但 UI/browser 关键流仍未覆盖。
  - Criterion:
    - `no contract drift between design, API, storage, and preview layers`
    - Result:
      - fail
    - Notes:
      - 目前缺少自动化跨层漂移检查。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 补充至少一组 Playwright e2e 关键路径测试
  - 将 API contract checks 扩成全路由、全响应语义校验
  - 强化 migration regression，真实比对 `scripts/sql` 与 `_migrations`
- Deferred items:
  - 更深入的性能/长时间稳定性测试可以留到后续 hardening 批次
- Risks carried into next phase:
  - 当前如果直接把 Phase 10 当作完成态，后续最容易出问题的是 UI 可见流程回归、接口契约漂移、以及 migration 漏同步
