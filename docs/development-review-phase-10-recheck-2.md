# Development Review: Phase 10 Recheck 2

## 1. Metadata

- Review target: Phase 10 Hardening recheck 2
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: closure check for [development-review-phase-10-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-1.md)
- Related phase: Phase 10
- Related previous reviews:
  - [development-review-phase-10.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10.md)
  - [development-review-phase-10-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 上轮关于固定端口冲突的问题已经部分修正，Playwright 配置现在支持端口覆写并允许复用已有服务；contract tests 也已经扩展到 testcase 级接口和一组 API/UI 字段对齐检查。但 Phase 10 仍未收口，因为 `pnpm test:e2e` 真实执行仍然失败，这次失败点从“端口占用”变成了“UI server 没有在 `5174` 可达”。此外，preview 层的自动化对齐仍然没有直接检查 `docs/ui-preview`。

## 3. Scope

- Reviewed modules:
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [apps/local-ui/e2e/workbench.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/workbench.spec.ts)
  - [apps/local-ui/vite.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/vite.config.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
- Reviewed docs/contracts:
  - [.kiro/steering/module-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md)
  - [api-contract-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md)
- Explicitly out of scope:
  - 新增产品功能
  - 长时压测

## 4. Findings

### High

- `pnpm test:e2e` still fails in a real run because the UI server never becomes reachable
  - Evidence:
    - Playwright 配置已经改成端口可覆写并允许复用已有服务，见 [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts#L3)。
    - e2e 用例仍然全部依赖 `http://localhost:5174` 作为 `baseURL`，见 [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts#L13) 和 [workbench.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/workbench.spec.ts#L16)。
    - 我实际执行 `pnpm test:e2e`，3 个用例都失败在 `page.goto(...)`，错误为 `net::ERR_CONNECTION_REFUSED at http://localhost:5174/...`。
  - Impact:
    - Phase 10 虽然已经有正式 e2e 套件，但当前仍不能通过真实执行验证。只要 UI webServer 没有被正确启动或等待到 ready，整条 hardening 交付链仍然是不成立的。
  - Suggested fix:
    - 先修复 Playwright webServer 启动链，确保 Vite 服务实际在 `baseURL` 上可达；
    - 如果需要，给 UI server 单独增加可执行健康检查，而不是只依赖 URL 探测；
    - 以 `pnpm test:e2e` 实际通过作为关闭条件，而不是只看配置变更。

### Medium

- Preview drift is still inferred indirectly rather than checked against `docs/ui-preview`
  - Evidence:
    - integration tests 已经加入 testcase 级接口覆盖和一组 API/UI 字段对齐检查，见 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L419) 和 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L477)。
    - 但当前自动化检查仍然没有直接读取或校验 `docs/ui-preview/*.html`，仓库搜索也没有发现针对 preview HTML 的测试或校验脚本。
  - Impact:
    - 这意味着“preview 层是否和 API / UI 保持一致”仍然主要依赖人工判断；如果 `docs/ui-preview` 再次漂移，当前 hardening 套件不会直接报警。
  - Suggested fix:
    - 至少补一组 preview smoke check，验证关键文案/字段在 `docs/ui-preview` 与真实 UI/API 契约之间保持一致；
    - 或者明确把 preview drift 检查降级为人工 review 项，并从 Phase 10 exit criteria 中移除自动化承诺。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm lint`
  - `pnpm test:e2e`
- Additional checks:
  - 审阅 Playwright 配置与 local-ui Vite 配置
  - 审阅增强后的 integration contract tests
- Result summary:
  - `pnpm -r typecheck` 通过
  - `pnpm build` 通过
  - `pnpm test` 通过
  - `pnpm lint` 通过
  - `pnpm test:e2e` 失败，失败原因是 UI server 在 `http://localhost:5174` 不可达

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `integration tests`
    - Result:
      - pass
    - Notes:
      - 已进一步增强。
  - Criterion:
    - `selected e2e coverage`
    - Result:
      - fail
    - Notes:
      - 套件存在，但真实执行仍失败。
  - Criterion:
    - `contract consistency checks`
    - Result:
      - pass with notes
    - Notes:
      - testcase 级接口和一组 API/UI 字段对齐已补上；但 preview HTML 仍未直接校验。
  - Criterion:
    - `migration regression checks`
    - Result:
      - pass
    - Notes:
      - 本轮未发现回退。
  - Criterion:
    - `critical flows are covered`
    - Result:
      - pass with notes
    - Notes:
      - integration 覆盖面足够，但 e2e 未能真实跑通。
  - Criterion:
    - `no contract drift between design, API, storage, and preview layers`
    - Result:
      - fail
    - Notes:
      - preview 层仍缺直接自动化校验。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 修复 `pnpm test:e2e` 的 UI server 启动/就绪问题
  - 决定是否要为 `docs/ui-preview` 增加直接自动化检查
- Deferred items:
  - 更深入的 cross-browser 覆盖仍可后续追加
- Risks carried into next phase:
  - 如果现在直接收口，最现实的风险仍是 e2e 命令不可用，以及 preview 漂移只能靠人工发现
