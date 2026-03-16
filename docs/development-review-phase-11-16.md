# Development Review Phase 11-16

## 1. Metadata

- Review target: combined completion review for Phases 11-16
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: end-to-end recheck of real execution, diagnostics, code-task execution, review/commit control, packaging/setup, and release-readiness claims
- Related phases:
  - Phase 11
  - Phase 12
  - Phase 13
  - Phase 14
  - Phase 15
  - Phase 16
- Related previous reviews:
  - [development-review-phase-11-recheck-6.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-6.md)
  - [development-review-phase-12-recheck-5.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-5.md)
  - [development-review-phase-13-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-4.md)
  - [development-review-phase-14-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-14-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phases 11-14 remain in a good state, but the combined Phase 11-16 completion claim does not hold yet because the product-packaging and release-readiness work is still incomplete. The documented install flow is not publishable as written, the default `zarb` entrypoint still does not bring up the local UI product surface, the new Phase 16 e2e suite is failing against the current API contract and does not cover the promised full product loop, and cross-browser validation is explicitly still deferred.

## 3. Scope

- Reviewed modules:
  - [apps/cli/src/bin.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/src/services/init-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/init-service.ts)
  - [apps/local-ui/e2e/product-loop.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts)
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json)
  - [apps/cli/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/operator-guide.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md)
  - [docs/release-notes.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md)

## 4. Findings

- High: the documented install/release path is not shippable as written. Both the root package and the CLI package are still marked `private` in [package.json#L4](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json#L4) and [apps/cli/package.json#L4](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json#L4), yet the operator guide and release notes tell users to run `npm install -g ai-regression-workbench` in [operator-guide.md#L6](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md#L6) and [release-notes.md#L18](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md#L18). The docs also advertise `Node.js 20+` in [operator-guide.md#L55](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md#L55) and [release-notes.md#L28](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md#L28), while the shipped engine requirement is `>=22` in [package.json#L8](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json#L8). Phase 15’s “installable and usable as a real local product” gate is therefore still unmet.

- High: the default `zarb` entrypoint still does not start the local UI product surface. `bin.ts` claims the default behavior is to “start app server and open UI” in [bin.ts#L5](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts#L5), and the operator guide says `zarb` starts the local workbench in [operator-guide.md#L14](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/operator-guide.md#L14), but the implementation only starts the API HTTP server in [bin.ts#L71](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/bin.ts#L71) and [server.ts#L40](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts#L40). The actual Playwright e2e setup has to launch `pnpm --filter @zarb/local-ui run dev` as a separate process in [playwright.config.ts#L35](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts#L35). That means the local UI startup promised by Phase 15 is still repo/dev-server dependent rather than productized.

- High: the new Phase 16 “product loop” e2e suite both fails and is materially shallower than the roadmap contract. I ran `pnpm test:e2e`, and 3 tests failed in [product-loop.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts). The immediate cause is stale request payloads such as `selectorType` / `selectorValue` / `workspacePath` in [product-loop.spec.ts#L37](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/product-loop.spec.ts#L37), while the current API contract requires `selector` and `projectPath`, see [services.ts#L51](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L51) and [run-service.ts#L63](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L63). More importantly, even if those payloads were fixed, this file does not exercise the promised Phase 16 loop of `run -> diagnostics -> code task -> review -> commit`; it only covers doctor, run CRUD, simple recovery re-query, and a couple of 4xx guardrails. That falls short of [product-completion-roadmap.md#L161](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L161) and [product-completion-roadmap.md#L168](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L168).

- High: cross-browser release validation is still explicitly missing. Phase 16 calls for cross-browser or browser-matrix validation in [product-completion-roadmap.md#L160](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L160), but the Playwright config only defines one default browser context and no browser matrix in [playwright.config.ts#L15](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts#L15). The release notes also explicitly say “Cross-browser matrix validation is deferred to v0.2.0” in [release-notes.md#L33](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/release-notes.md#L33). So the Phase 16 completion claim conflicts with the shipped release notes.

- Medium: the generated first-run config template does not match the actual diagnostics settings schema. `InitService` writes `diagnostics.correlationKeys.headers` and `bodyFields` in [init-service.ts#L38](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/init-service.ts#L38), but the real settings model expects `responseHeaders` and `responseBodyPaths` in [services.ts#L119](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L119) and [defaults.ts#L27](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/defaults.ts#L27). Because config loading deep-merges unknown keys without validation, this does not crash startup, but it leaves first-run users with a template that diverges from the shipped schema and documentation.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm test:e2e`
- Additional checks:
  - Re-read the packaging and release-readiness sections of the product-completion roadmap
  - Re-read the CLI default startup path and server composition
  - Re-read the new Phase 16 e2e suite against the current API contract
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 17 test files and 311 tests passing
  - `pnpm test:e2e` failed with 3 failing tests, all in `apps/local-ui/e2e/product-loop.spec.ts`

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

- Required follow-up actions:
  - Make the install/update/uninstall path real and consistent with package metadata, or change the docs to the actual supported distribution model
  - Productize local UI startup so `zarb` can launch or serve the user-facing workbench without requiring the repo-local Vite dev server
  - Rewrite the Phase 16 product-loop e2e to match the current API contract and cover the full `run -> diagnostics -> code task -> review -> commit` path
  - Add browser-matrix validation or explicitly move that requirement out of Phase 16
  - Fix the generated config template keys to match the diagnostics schema
- Deferred items:
  - None beyond the unresolved Phase 15-16 completion work above
