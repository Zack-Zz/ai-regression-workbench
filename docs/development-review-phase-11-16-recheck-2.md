# Development Review Phase 11-16 Recheck 2

## 1. Metadata

- Review target: combined completion review for Phases 11-16 recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-16-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16-recheck-1.md)
- Related phases:
  - Phase 11
  - Phase 12
  - Phase 13
  - Phase 14
  - Phase 15
  - Phase 16
- Related previous reviews:
  - [development-review-phase-11-16.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16.md)
  - [development-review-phase-11-16-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The recheck closes the previous `product-loop.spec.ts` response-shape bug, and the browser-matrix e2e suite now passes. The bundled UI is also being served from the CLI server. However, the combined Phase 11-16 completion claim still does not hold because Phase 15 remains a repo-local install/link workflow, and the Phase 16 “full product loop” test is still not a real end-to-end product loop: it seeds a succeeded code task through a test-only endpoint instead of exercising the actual run-to-task pipeline against a representative external workspace.

## 3. Scope

- Reviewed modules:
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/src/bin.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts)
  - [apps/local-ui/e2e/product-loop.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts)
  - [scripts/e2e-server.mjs](/Users/zhouze/Documents/git-projects/ai-regression-workbench/scripts/e2e-server.mjs)
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json)
  - [apps/cli/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/operator-guide.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md)
  - [docs/release-notes.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md)

## 4. Findings

- High: Phase 16 still does not verify the documented real product loop. The new test passes, but it does so by creating a `SUCCEEDED` code task through the test-only `/e2e-seed/code-task` endpoint in [e2e-server.mjs#L34](/Users/zhouze/Documents/git-projects/ai-regression-workbench/scripts/e2e-server.mjs#L34) and then calling review/commit against that seeded record in [product-loop.spec.ts#L92](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts#L92). That bypasses the actual `run -> diagnostics -> code task` chain entirely and does not satisfy the Phase 16 deliverable for “real target-workspace e2e for run -> diagnostics -> code task -> review -> commit” in [product-completion-roadmap.md#L161](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L161) or the exit criterion requiring the full loop to pass against a representative external sample workspace in [product-completion-roadmap.md#L168](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L168).

- High: Phase 15 still remains repo-only from an installation/distribution standpoint. The CLI server now serves bundled UI assets from [server.ts#L41](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts#L41), which closes the earlier “separate UI dev server” issue. But the supported install path is still `git clone`, `pnpm build`, and `npm link` in [operator-guide.md#L5](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md#L5), while both the root package and CLI package remain private in [package.json#L4](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json#L4) and [apps/cli/package.json#L4](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json#L4). That means the product still does not meet the Phase 15 exit criterion that a clean machine can install and initialize it using the documented flow without repo-only assumptions, see [product-completion-roadmap.md#L148](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L148) and [product-completion-roadmap.md#L149](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L149).

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm test:e2e`
- Additional checks:
  - Re-ran `pnpm test:e2e` after build completion to avoid stale `dist` artifacts
  - Re-read the new bundled-UI server path
  - Re-read the new product-loop spec against the test harness server
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 18 test files and 316 tests passing
  - `pnpm test:e2e` passed with 33 tests across Chromium, Firefox, and WebKit

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
  - bundled local UI is now served from the CLI server
  - browser-matrix Playwright coverage now passes
  - the `product-loop.spec.ts` response-shape bug is fixed
- Required follow-up actions:
  - Replace the seeded Phase 16 code-task shortcut with a real run-to-task path against a representative external workspace
  - Decide whether Phase 15 requires a real distributable package; if yes, publish/package it or otherwise remove the repo-only assumption from the installation flow
- Deferred items:
  - None beyond the unresolved Phase 15-16 completion work above
