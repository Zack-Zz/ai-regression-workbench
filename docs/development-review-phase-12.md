# Development Review Phase 12

## 1. Metadata

- Review target: Phase 12 Real Diagnostics Integration
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: `apps/trace-bridge`, `apps/log-bridge`, CLI diagnostics integration, Phase 12 execution-path review
- Related phase: Phase 12
- Related previous reviews:
  - [development-review-phase-11-recheck-6.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-6.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phase 12 adds real trace/log provider adapters and unit tests for the bridge modules, but the product integration is still incomplete. The main problems are: diagnostics fetching is not wired into any run or endpoint path, config updates do not refresh provider settings after startup, and trace/log summary files are not persisted under the documented diagnostics storage layout.

## 3. Scope

- Reviewed modules:
  - [apps/trace-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/trace-bridge/src/index.ts)
  - [apps/log-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts)
  - [apps/cli/src/services/diagnostics-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
  - [packages/config/src/config-manager.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)
  - [docs/storage-mapping-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/storage-mapping-design.md)

## 4. Findings

### High

- Real diagnostics fetching is implemented but never invoked anywhere in the product flow
  - Evidence:
    - The only implementation of diagnostics fetching is [apps/cli/src/services/diagnostics-service.ts#L184](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts#L184).
    - `getTrace()` and `getLogs()` only read already-persisted `diagnostic_fetches` rows; they never trigger a provider fetch on demand, see [apps/cli/src/services/diagnostics-service.ts#L138](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts#L138) and [apps/cli/src/services/diagnostics-service.ts#L151](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts#L151).
    - Static call search under `apps/` and `packages/` shows no callers of `fetchDiagnostics(...)` beyond its declaration.
  - Impact:
    - Phase 12’s trace/log providers exist, but no run lifecycle step and no HTTP endpoint actually populates trace/log diagnostics. In normal product use, `GET /runs/:runId/testcases/:testcaseId/trace` and `/logs` will continue returning `null` unless rows are manually seeded.
    - This directly misses the Phase 12 exit criteria that these endpoints return real provider-derived data.
  - Suggested fix:
    - Wire `fetchDiagnostics()` into the run/diagnostics lifecycle, or explicitly trigger provider-backed fetch when diagnostics endpoints are queried.

- Config updates for diagnostics/trace/log are still not honored after server startup
  - Evidence:
    - The server snapshots config once at startup and constructs `traceProvider` / `logProvider` from that snapshot, see [apps/cli/src/server.ts#L29](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts#L29) and [apps/cli/src/server.ts#L34](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts#L34).
    - `ConfigManager` supports observer-based broadcast on updates, see [packages/config/src/config-manager.ts#L102](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts#L102) and [packages/config/src/config-manager.ts#L116](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts#L116).
    - But the server never registers any observer to refresh diagnostics providers when settings change.
    - The Phase 12 roadmap explicitly requires diagnostics settings changes to be honored, see [docs/product-completion-roadmap.md#L80](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L80), and the design says config updates should broadcast to trace/log/diagnostics modules, see [docs/design.md#L1199](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L1199).
  - Impact:
    - Updating Jaeger/Loki endpoints, provider selection, or log limits through settings will not affect the live server until restart, which breaks a stated Phase 12 deliverable.
  - Suggested fix:
    - Register config observers that rebuild or swap the active trace/log providers inside the diagnostics stack on settings updates.

- Trace/log summaries are not persisted to the documented diagnostics file layout
  - Evidence:
    - The storage contract requires `diagnostics/<runId>/<testcaseId>/trace-summary.json` and `log-summary.json`, see [docs/storage-mapping-design.md#L48](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/storage-mapping-design.md#L48).
    - Path helpers already exist for those files, see [packages/storage/src/paths.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/storage/src/paths.ts).
    - But [apps/cli/src/services/diagnostics-service.ts#L202](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts#L202) and [apps/cli/src/services/diagnostics-service.ts#L224](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts#L224) only insert database rows; there is no file persistence path for trace/log summaries anywhere in the Phase 12 code.
    - The Phase 12 roadmap explicitly says to generate and persist those files, see [docs/product-completion-roadmap.md#L79](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L79).
  - Impact:
    - The diagnostics filesystem contract remains broken even if provider fetch succeeds. Downstream tooling or manual inspection that relies on the documented diagnostics file layout will not find the expected summary artifacts.
  - Suggested fix:
    - Persist fetched trace/log summaries to the documented diagnostics paths alongside the database rows.

### Medium

- Tests validate bridge parsing in isolation, but do not cover the missing product integration path
  - Evidence:
    - Bridge unit tests exist for [apps/trace-bridge/test/trace-bridge.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/trace-bridge/test/trace-bridge.test.ts) and [apps/log-bridge/test/log-bridge.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts).
    - But current CLI integration tests only verify the shape of `diagnostics` and that unknown trace/log requests return `null`, see [apps/cli/test/integration.test.ts#L475](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L475) and [apps/cli/test/integration.test.ts#L485](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L485).
    - There are no tests proving that a real run or endpoint call triggers `fetchDiagnostics()`, that config updates refresh providers, or that summary files are written.
  - Impact:
    - The branch can stay green while the main Phase 12 product loop remains disconnected.
  - Suggested fix:
    - Add integration tests for provider-backed diagnostics fetch, live config update propagation, and summary-file persistence.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the new trace/log bridge implementations
  - Re-read CLI diagnostics integration and server wiring
  - Cross-checked implementation against the Phase 12 roadmap and storage contract
  - Searched the codebase for actual `fetchDiagnostics()` call sites
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Static review found 3 High and 1 Medium issues

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `GET /runs/:runId/testcases/:testcaseId/trace returns real provider-derived data`
    - Result:
      - fail
    - Notes:
      - Provider adapters exist, but no product path invokes `fetchDiagnostics()`.
  - Criterion:
    - `GET /runs/:runId/testcases/:testcaseId/logs returns real provider-derived data`
    - Result:
      - fail
    - Notes:
      - Same integration gap as trace.
  - Criterion:
    - `provider failures create degraded diagnostics records instead of breaking the run`
    - Result:
      - pass with notes
    - Notes:
      - The provider wrappers and persistence logic are written to degrade, but the fetch path is not currently connected to product flow.
  - Criterion:
    - `trace-summary.json and log-summary.json are persisted under the documented diagnostics layout`
    - Result:
      - fail
    - Notes:
      - Database rows are written; summary files are not.

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Wire `fetchDiagnostics()` into a real run or endpoint lifecycle
  - Register config observers so diagnostics providers refresh after settings updates
  - Persist trace/log summaries to the documented diagnostics filesystem paths
  - Add integration tests for the real diagnostics path
- Deferred items:
  - richer failure-report UI evidence rendering beyond the current API layer
- Risks carried into next phase:
  - If merged as-is, the repository will appear to have “real trace/log providers,” but normal product flows will still surface empty diagnostics and miss the documented diagnostics artifacts.
