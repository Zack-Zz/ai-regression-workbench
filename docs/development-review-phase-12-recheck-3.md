# Development Review Phase 12 Recheck 3

## 1. Metadata

- Review target: Phase 12 Real Diagnostics Integration recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-12-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-2.md)
- Related phase: Phase 12
- Related previous reviews:
  - [development-review-phase-12.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12.md)
  - [development-review-phase-12-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-1.md)
  - [development-review-phase-12-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-2.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The previous Phase 12 issues around default Jaeger endpoint compatibility and request/session correlation support are now closed. However, the new `logFields` implementation is still incorrect at query semantics level: it combines all configured correlation fields into a single Loki selector, which makes them AND constraints instead of the intended OR-style alternatives.

## 3. Scope

- Reviewed modules:
  - [apps/log-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts)
  - [apps/log-bridge/test/log-bridge.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts)
  - [apps/cli/src/services/diagnostics-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [packages/config/src/defaults.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/defaults.ts)
  - [packages/shared-types/src/services.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts)
- Reviewed docs/contracts:
  - [docs/diagnostics-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)

## 4. Findings

### High

- `logFields` are now threaded through, but the generated Loki selector uses incorrect AND semantics
  - Evidence:
    - `buildLogQL()` collects all correlation IDs and then appends one label matcher per configured field into the same selector object, see [apps/log-bridge/src/index.ts#L68](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L68) and [apps/log-bridge/src/index.ts#L89](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L89).
    - With multiple configured fields, the query becomes structurally equivalent to `{traceId=~"...",requestId=~"...",sessionId=~"..."}`.
    - In Loki label selectors, comma-separated matchers are conjunctive, so this requires all those labels to be present and matching on the same stream.
    - The diagnostics design treats `logFields` as configurable correlation alternatives, not mandatory simultaneous labels, see [docs/diagnostics-design.md#L38](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md#L38).
  - Impact:
    - A normal log stream that only carries one of the configured correlation labels, such as `traceId` without `requestId` or `sessionId`, will now fail to match once multiple `logFields` are configured.
    - The implementation also mixes all correlation ID values across all configured fields, so a `requestId` value is tested against `traceId` labels and vice versa, which further increases false negatives and query noise.
  - Suggested fix:
    - Build the query as OR-style alternatives across configured fields, rather than one selector that requires all fields at once. The generated query must preserve the intended “match any configured correlation field” semantics.

### Medium

- Tests cover field-name propagation, but not the actual Loki query semantics
  - Evidence:
    - The new test only asserts that the generated URL contains configured field names, see [apps/log-bridge/test/log-bridge.test.ts#L90](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts#L90).
    - It does not assert that multiple configured fields are combined with correct OR semantics, or that correlation IDs are mapped to the right field sets.
  - Impact:
    - The test suite stays green while the real query semantics remain wrong for common log stream shapes.
  - Suggested fix:
    - Add a test that inspects the generated query for multi-field configuration and proves it does not require all configured fields to exist on the same stream.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the latest `logFields` plumbing in `apps/log-bridge`
  - Cross-checked generated Loki selector structure against expected correlation semantics
  - Re-read the new log bridge tests
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around Jaeger default endpoint compatibility and request/session correlation support are closed
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
      - The fetch path is connected, but multi-field log correlation still generates an over-constrained Loki selector.
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
  - Fix Loki query construction so configured `logFields` are treated as alternatives, not simultaneous required labels
  - Add a test that locks down multi-field query semantics
