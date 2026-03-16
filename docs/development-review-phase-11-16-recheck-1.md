# Development Review Phase 11-16 Recheck 1

## 1. Metadata

- Review target: combined completion review for Phases 11-16 recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-16.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16.md)
- Related phases:
  - Phase 11
  - Phase 12
  - Phase 13
  - Phase 14
  - Phase 15
  - Phase 16
- Related previous reviews:
  - [development-review-phase-11-16.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16.md)
  - [development-review-phase-11-recheck-6.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-6.md)
  - [development-review-phase-12-recheck-5.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-5.md)
  - [development-review-phase-13-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-4.md)
  - [development-review-phase-14-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-14-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Several review items from the first combined review are now closed: the docs no longer pretend the CLI is npm-published, the documented Node requirement now matches the package metadata, the browser matrix is wired into Playwright config, and the init template now uses the current diagnostics key names. However, the combined Phase 11-16 completion claim still does not hold because Phase 15 remains repo/dev-server dependent, and the new Phase 16 e2e suite still fails while also falling short of the documented full-product-loop contract.

## 3. Scope

- Reviewed modules:
  - [apps/cli/src/bin.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts)
  - [apps/local-ui/e2e/product-loop.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts)
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [apps/cli/src/handlers/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
  - [apps/cli/src/services/init-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/init-service.ts)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/operator-guide.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md)
  - [docs/release-notes.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md)

## 4. Findings

- High: Phase 15 is still not complete because the supported startup/install flow remains repo-only. The updated operator guide now explicitly tells users to `git clone`, `pnpm install`, `pnpm build`, and `cd apps/cli && npm link` in [operator-guide.md#L5](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md#L5), and the default CLI path explicitly tells users to launch the UI separately with `pnpm --filter @zarb/local-ui run dev` in [bin.ts#L74](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts#L74). That closes the earlier docs mismatch, but it still does not satisfy the Phase 15 exit criterion that `zarb`, `zarb init`, `zarb doctor`, and local UI startup work without repo-only assumptions in [product-completion-roadmap.md#L149](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L149). The review issue changed form, but the product-completion gate remains blocked.

- High: the Phase 16 e2e branch still fails, and the failing tests show the new product-loop spec still is not aligned with the actual API shape. I ran `pnpm test:e2e`, which failed with 6 test failures across Chromium, Firefox, and WebKit, all in [product-loop.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts). The immediate bug is that the spec still reads `/runs` creation as `data.runId` in [product-loop.spec.ts#L40](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts#L40), while the API returns `data.run.runId`, as shown by [handlers/index.ts#L30](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L30) and the existing contract test in [integration.test.ts#L69](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L69). Beyond that concrete bug, the spec still does not execute the documented full loop of `run -> diagnostics -> code task -> review -> commit`; it exercises doctor, run CRUD, diagnostics endpoint availability, code-task list/guardrails, and settings, but not a real repaired-task review/commit path. That still falls short of [product-completion-roadmap.md#L161](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L161) and [product-completion-roadmap.md#L168](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L168).

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm test:e2e`
- Additional checks:
  - Re-read the revised operator guide and release notes
  - Re-read the revised Playwright config and init template
  - Re-checked `/runs` response shape against the new product-loop spec
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 18 test files and 316 tests passing
  - `pnpm test:e2e` failed with 6 failing tests across 3 browsers

## 6. Phase Gate

- Completion gate by phase:
  - Phase 11:
    - pass
  - Phase 12:
    - pass
  - Phase 13:
    - pass
  - Phase 14:
    - pass
  - Phase 15:
    - fail
  - Phase 16:
    - fail

## 7. Follow-ups / Notes

- Closed since the previous review:
  - install docs no longer incorrectly claim npm publication
  - Node version docs now match the package engine requirement
  - Playwright browser matrix is configured
  - init template diagnostics keys now match the schema
- Required follow-up actions:
  - Decide whether Phase 15 really includes a productized local UI startup; if yes, implement it instead of documenting a repo-local Vite dev server dependency
  - Fix `product-loop.spec.ts` to use the actual `/runs` response shape
  - Extend Phase 16 e2e so it covers a real `run -> diagnostics -> code task -> review -> commit` loop against a representative target workspace
- Deferred items:
  - None beyond the unresolved Phase 15-16 completion work above
