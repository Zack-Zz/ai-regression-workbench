# Development Review Phase 11-16 Recheck 3

## 1. Metadata

- Review target: combined completion review for Phases 11-16 recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-16-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16-recheck-2.md)
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
  - [development-review-phase-11-16-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-16-recheck-2.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The previous product-completion findings are now closed: Phase 15’s supported distribution model is explicitly defined as source install plus `npm link`, the CLI server serves bundled UI assets, and the revised browser-matrix e2e suite passes. However, the new bundled static-file server introduced a security regression: crafted `../` paths can escape `apps/local-ui/dist` and read other files under the repo tree that match the allowed extensions.

## 3. Scope

- Reviewed modules:
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/src/bin.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts)
  - [apps/local-ui/e2e/product-loop.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts)
  - [scripts/e2e-server.mjs](/Users/zhouze/Documents/git-projects/ai-regression-workbench/scripts/e2e-server.mjs)
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [apps/cli/test/preview-drift.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/preview-drift.test.ts)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/operator-guide.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md)
  - [docs/release-notes.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md)

## 4. Findings

- High: the new bundled-UI static server is vulnerable to path traversal. `serveStatic()` takes `req.url` verbatim in [server.ts#L46](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts#L46), then resolves the candidate file with `join(uiDist, url)` in [server.ts#L53](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts#L53) and serves it if `existsSync(filePath)` is true. There is no normalization guard that forces the resolved path to stay under `uiDist`. I verified with a local path-resolution check that `join(uiDist, '/../../cli/dist/server.js')` resolves to the existing file `/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/dist/server.js`, not to a path under `apps/local-ui/dist`. That means a request such as `/../../cli/dist/server.js` can escape the bundled UI directory and read other `.js`, `.css`, `.html`, `.svg`, or `.ico` files from elsewhere in the repo. This is a new security blocker under the Phase 16 requirement to cover security-sensitive actions and guardrails, see [product-completion-roadmap.md#L168](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L168) and [product-completion-roadmap.md#L187](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L187).

- Medium: there is no regression coverage for static-file path containment. The current tests cover preview drift in [preview-drift.test.ts#L17](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/preview-drift.test.ts#L17) and browser-level happy paths in `apps/local-ui/e2e`, but I did not find any server-side test that asserts `../` requests are rejected or normalized back into `index.html`. That leaves the new static-serving attack surface unguarded.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm test:e2e`
- Additional checks:
  - Re-read the updated Phase 15 and Phase 16 roadmap text
  - Re-read the new bundled static-serving implementation
  - Verified with a local path-resolution check that `join(uiDist, '/../../cli/dist/server.js')` escapes `uiDist` and points at an existing file
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
    - pass
  - Phase 16:
    - fail

## 7. Follow-ups / Notes

- Closed since the previous review:
  - source-install plus `npm link` is now the documented Phase 15 distribution model
  - bundled local UI is served from the CLI server
  - browser-matrix Playwright coverage passes
  - the revised product-loop spec passes against the updated documented Phase 16 boundary
- Required follow-up actions:
  - Constrain static asset resolution to stay under `apps/local-ui/dist` after normalization
  - Add regression coverage proving traversal-style URLs cannot read files outside the bundled UI directory
- Deferred items:
  - None beyond the remaining static-serving security issue
