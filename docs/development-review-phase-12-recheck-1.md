# Development Review Phase 12 Recheck 1

## 1. Metadata

- Review target: Phase 12 Real Diagnostics Integration recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-12.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12.md)
- Related phase: Phase 12
- Related previous reviews:
  - [development-review-phase-12.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12.md)
  - [development-review-phase-11-recheck-6.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-6.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The main Phase 12 integration gaps are now closed: diagnostics fetching is triggered on demand, summary files are written, and diagnostics providers refresh through config observer updates. However, two provider-level contract bugs still remain: the default Jaeger endpoint is incompatible with the provider implementation, and Loki queries still ignore `requestIds` / `sessionIds` even though the diagnostics flow passes them through as first-class correlation keys.

## 3. Scope

- Reviewed modules:
  - [apps/trace-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/trace-bridge/src/index.ts)
  - [apps/log-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts)
  - [apps/cli/src/services/diagnostics-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
  - [packages/config/src/defaults.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/defaults.ts)
  - [packages/shared-types/src/dtos.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/dtos.ts)
- Reviewed docs/contracts:
  - [docs/development-review-phase-12.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)
  - [docs/diagnostics-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md)

## 4. Findings

### High

- The default Jaeger endpoint is incompatible with the trace provider implementation
  - Evidence:
    - `JaegerTraceProvider` expects a base endpoint like `http://host:16686` and always appends `/api/traces/${traceId}`, see [apps/trace-bridge/src/index.ts#L15](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/trace-bridge/src/index.ts#L15) and [apps/trace-bridge/src/index.ts#L24](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/trace-bridge/src/index.ts#L24).
    - But the shipped default config still sets `trace.endpoint` to `http://localhost:16686/api/traces`, see [packages/config/src/defaults.ts#L36](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/defaults.ts#L36).
    - The design docs and UI preview also still present the `/api/traces` form as the configured endpoint, see [docs/design.md#L2358](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2358).
  - Impact:
    - With untouched defaults, trace fetches will request `.../api/traces/api/traces/<traceId>`, so the default Phase 12 path degrades immediately even though the provider wiring is now present.
  - Suggested fix:
    - Either change the provider to accept a fully-qualified trace API prefix, or normalize the default/docs config to the provider’s expected base endpoint format.

- Loki query construction still ignores `requestIds` and `sessionIds`
  - Evidence:
    - `DiagnosticsService.fetchDiagnostics()` passes `traceIds`, `requestIds`, and `sessionIds` into the log provider, see [apps/cli/src/services/diagnostics-service.ts#L254](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts#L254).
    - But `buildLogQL()` only translates `traceIds` and `services` into the Loki selector; `requestIds` and `sessionIds` are ignored entirely, see [apps/log-bridge/src/index.ts#L60](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L60).
    - The DTO contract exposes `requestIds` / `sessionIds` as first-class `LogQuery` inputs, see [packages/shared-types/src/dtos.ts#L370](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/dtos.ts#L370).
    - The design explicitly says logs should be queried by `traceIds / requestIds / sessionIds + time window`, see [docs/design.md#L2590](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2590).
  - Impact:
    - Any testcase whose usable log correlation comes from `requestId` or `sessionId` rather than `traceId` will still fail to retrieve relevant logs even though Phase 12 now appears “integrated”.
  - Suggested fix:
    - Extend Loki query construction to include configured request/session correlation fields, not just `trace_id`.

### Medium

- The new tests still do not cover the two remaining provider-contract bugs
  - Evidence:
    - The trace bridge tests only construct `JaegerTraceProvider` with the base endpoint form, so they do not catch the shipped default-config mismatch, see [apps/trace-bridge/test/trace-bridge.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/trace-bridge/test/trace-bridge.test.ts).
    - The Phase 12 integration tests verify on-demand trace fetch and config observer wiring, but they do not assert any `requestIds` / `sessionIds` driven Loki query behavior, see [apps/cli/test/integration.test.ts#L501](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L501) and [apps/cli/test/integration.test.ts#L532](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L532).
  - Impact:
    - The branch stays green while the default trace configuration and non-trace correlation log path remain broken.
  - Suggested fix:
    - Add one test for default trace endpoint compatibility and one for log queries driven solely by `requestIds` / `sessionIds`.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the latest diagnostics fetch integration and server observer wiring
  - Re-read provider query construction in trace/log bridge modules
  - Cross-checked defaults and query semantics against the design/docs contract
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around disconnected fetch flow, missing summary-file persistence, and missing config observer wiring are closed
  - 2 High and 1 Medium issues remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `GET /runs/:runId/testcases/:testcaseId/trace returns real provider-derived data`
    - Result:
      - fail
    - Notes:
      - The fetch path is connected now, but the shipped default Jaeger endpoint does not match the provider’s URL expectations.
  - Criterion:
    - `GET /runs/:runId/testcases/:testcaseId/logs returns real provider-derived data`
    - Result:
      - fail
    - Notes:
      - The fetch path is connected now, but request/session-key-driven log queries still do not work.
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
  - Align Jaeger default config and provider URL construction
  - Include `requestIds` / `sessionIds` in Loki query construction
  - Add tests for both remaining provider-contract cases
