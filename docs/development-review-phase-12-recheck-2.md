# Development Review Phase 12 Recheck 2

## 1. Metadata

- Review target: Phase 12 Real Diagnostics Integration recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-12-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-1.md)
- Related phase: Phase 12
- Related previous reviews:
  - [development-review-phase-12.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12.md)
  - [development-review-phase-12-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The previous Phase 12 issues around disconnected fetch flow, summary-file persistence, config observer wiring, default Jaeger endpoint compatibility, and request/session ID log queries are now closed. However, one contract-level diagnostics bug still remains: the log bridge still ignores `diagnostics.correlationKeys.logFields` and hardcodes Loki field names, so settings-driven log correlation is not actually honored.

## 3. Scope

- Reviewed modules:
  - [apps/log-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts)
  - [apps/cli/src/services/diagnostics-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/log-bridge/test/log-bridge.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts)
  - [packages/config/src/defaults.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/defaults.ts)
  - [packages/shared-types/src/services.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts)
- Reviewed docs/contracts:
  - [docs/diagnostics-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)

## 4. Findings

### High

- The log bridge still ignores configurable `diagnostics.correlationKeys.logFields`
  - Evidence:
    - The diagnostics config exposes `correlationKeys.logFields`, see [packages/shared-types/src/services.ts#L118](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L118).
    - Defaults include multiple possible field names such as `traceId`, `trace_id`, `requestId`, and `sessionId`, see [packages/config/src/defaults.ts#L27](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/defaults.ts#L27).
    - The diagnostics design explicitly marks `diagnostics.correlationKeys.logFields` as configurable, see [docs/diagnostics-design.md#L38](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md#L38).
    - But `buildLogQL()` still hardcodes only `trace_id`, `request_id`, and `session_id`, and there is no path from settings into the log query builder, see [apps/log-bridge/src/index.ts#L60](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L60).
  - Impact:
    - If a real log source uses configured field names like `traceId` or `requestId` instead of the hardcoded snake_case labels, Phase 12 log fetching will still miss the relevant records even though the settings model and design say those correlation fields are configurable.
    - This means Phase 12 still does not fully honor diagnostics/log settings updates in the way the product contract describes.
  - Suggested fix:
    - Thread `diagnostics.correlationKeys.logFields` into the log provider and generate Loki queries from configured field names rather than hardcoded label keys.

### Medium

- Tests still do not cover settings-driven log field selection
  - Evidence:
    - The new log bridge tests cover `requestIds` / `sessionIds` usage, see [apps/log-bridge/test/log-bridge.test.ts#L69](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts#L69).
    - But there is no test proving that changing `diagnostics.correlationKeys.logFields` changes the generated log query.
  - Impact:
    - The branch remains green while the remaining config-contract bug is unguarded.
  - Suggested fix:
    - Add a test that passes non-default log field names through the diagnostics/log settings path and asserts the generated Loki query honors them.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the latest trace/log bridge implementations
  - Re-read diagnostics fetch integration and config observer wiring
  - Cross-checked log query construction against diagnostics settings contract
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around default Jaeger endpoint compatibility and request/session ID query support are closed
  - 1 High and 1 Medium issue remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `GET /runs/:runId/testcases/:testcaseId/trace returns real provider-derived data`
    - Result:
      - pass
  - Criterion:
    - `GET /runs/:runId/testcases/:testcaseId/logs returns real provider-derived data`
    - Result:
      - fail
    - Notes:
      - The fetch path works, but settings-driven log field selection is still not honored.
  - Criterion:
    - `provider failures create degraded diagnostics records instead of breaking the run`
    - Result:
      - pass
  - Criterion:
    - `trace-summary.json and log-summary.json are persisted under the documented diagnostics layout`
    - Result:
      - pass

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Honor `diagnostics.correlationKeys.logFields` in Loki query construction
  - Add a settings-driven log field test
