# Development Review: Phase 10 Recheck 3

## 1. Metadata

- Review target: Phase 10 Hardening recheck 3
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: closure check for [development-review-phase-10-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-2.md)
- Related phase: Phase 10
- Related previous reviews:
  - [development-review-phase-10.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10.md)
  - [development-review-phase-10-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-1.md)
  - [development-review-phase-10-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-2.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 上轮剩余的 preview drift 问题已经闭环，仓库现在有了直接针对 `docs/ui-preview` 的 smoke test，且基础命令全部通过。Phase 10 当前只剩 1 个阻塞问题：`pnpm test:e2e` 仍然失败，3 个 Playwright 用例都在 `page.goto(...)` 阶段连不上 `http://localhost:5174`。

## 3. Scope

- Reviewed modules:
  - [apps/cli/test/preview-drift.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/preview-drift.test.ts)
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [apps/local-ui/vite.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/vite.config.ts)
  - [apps/local-ui/e2e/workbench.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/workbench.spec.ts)
- Reviewed docs/contracts:
  - [.kiro/steering/module-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md)
- Explicitly out of scope:
  - 新增产品功能
  - 长时压测

## 4. Findings

### High

- `pnpm test:e2e` still fails because the local UI never becomes reachable at the configured `baseURL`
  - Evidence:
    - Playwright 仍然把 `baseURL` 指向 `http://localhost:5174`，见 [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts#L12)。
    - e2e 用例全部直接从该地址开始访问，见 [workbench.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/workbench.spec.ts#L16)。
    - `apps/local-ui` 的 dev server 端口已改为读取 `VITE_PORT`，见 [vite.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/vite.config.ts#L4)；但我实际执行 `pnpm test:e2e` 时，3 个用例仍全部报 `net::ERR_CONNECTION_REFUSED at http://localhost:5174/...`。
  - Impact:
    - 这意味着 Phase 10 的 `selected e2e coverage` 虽然有测试文件和启动配置，但交付仍未完成，因为正式命令无法通过真实执行证明关键 UI 流程被锁住。
  - Suggested fix:
    - 继续排查 Playwright webServer 的 UI 启动链，确保 Vite 进程实际启动并保持存活；
    - 必要时把 UI webServer 拆成单独可验证的启动命令，或增加更明确的 readiness probe；
    - 以 `pnpm test:e2e` 通过作为最终关闭条件。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm lint`
  - `pnpm test:e2e`
- Additional checks:
  - 审阅新增的 preview drift smoke test
  - 审阅 Playwright 与 Vite 端口传递链
- Result summary:
  - `pnpm -r typecheck` 通过
  - `pnpm build` 通过
  - `pnpm test` 通过
  - `pnpm lint` 通过
  - `pnpm test:e2e` 失败，失败原因仍是 `http://localhost:5174` 不可达

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `integration tests`
    - Result:
      - pass
    - Notes:
      - 已稳定通过。
  - Criterion:
    - `selected e2e coverage`
    - Result:
      - fail
    - Notes:
      - e2e 套件仍未跑通。
  - Criterion:
    - `contract consistency checks`
    - Result:
      - pass
    - Notes:
      - testcase 级接口与 preview drift smoke check 都已补齐。
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
      - integration 覆盖充分，但 e2e 真实执行仍未通过。
  - Criterion:
    - `no contract drift between design, API, storage, and preview layers`
    - Result:
      - pass
    - Notes:
      - 当前已有 contract tests 与 preview drift smoke checks。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 修复 `pnpm test:e2e` 的 UI server 启动/就绪问题
- Deferred items:
  - cross-browser 扩展可后续再做
- Risks carried into next phase:
  - 当前唯一显著风险是 e2e 套件不可用，导致本地 UI 真实流程回归仍可能漏检
