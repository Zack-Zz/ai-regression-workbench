# Development Review Phase 12 Recheck 4

## 1. Metadata

- Review target: Phase 12 Real Diagnostics Integration recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-12-recheck-3.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-3.md)
- Related phase: Phase 12
- Related previous reviews:
  - [development-review-phase-12.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12.md)
  - [development-review-phase-12-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-1.md)
  - [development-review-phase-12-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-2.md)
  - [development-review-phase-12-recheck-3.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-3.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The previous Phase 12 issues around configurable `logFields` propagation are partially addressed, but the new Loki query construction is still incorrect. It moved correlation matching into a `|~` line filter, which matches log content rather than Loki labels, so label-based correlation can still fail even though the generated URL now mentions the configured field names.

## 3. Scope

- Reviewed modules:
  - [apps/log-bridge/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts)
  - [apps/log-bridge/test/log-bridge.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts)
  - [apps/cli/src/services/diagnostics-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/diagnostics-service.ts)
- Reviewed docs/contracts:
  - [docs/diagnostics-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)

## 4. Findings

### High

- The new Loki query no longer matches configured correlation labels; it matches log lines instead
  - Evidence:
    - `buildLogQL()` now builds the stream selector from `service` only, then pushes configured correlation field expressions into `lineFilters`, and finally emits them through `|~`, see [apps/log-bridge/src/index.ts#L76](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L76) and [apps/log-bridge/src/index.ts#L99](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L99).
    - In Loki, `|~` is a line-content regex filter, not a label matcher. Expressions such as `traceId=~"..."` inside that filter are treated as regex text to search for in the log message, not as structured label constraints.
    - The diagnostics contract treats `logFields` as configurable correlation fields for log querying, see [docs/diagnostics-design.md#L38](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/diagnostics-design.md#L38), and the design says logs are queried by correlation IDs plus time window, see [docs/design.md#L2590](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2590).
  - Impact:
    - If correlation IDs are attached as Loki labels, which is exactly what `logFields` implies, the current query can still miss the target logs because the message body may not contain strings like `traceId=~"trace-abc"`.
    - This keeps Phase 12’s log retrieval path contractually broken even though field names are now configurable.
  - Suggested fix:
    - Build valid Loki label matching for configured correlation fields instead of moving them into a line regex. The query must preserve label semantics while still supporting alternative configured field names.

### Medium

- Correlation ID types are still mixed together across all configured fields
  - Evidence:
    - `buildLogQL()` merges `traceIds`, `requestIds`, and `sessionIds` into one `allIds` array, then applies that same regex to every configured field, see [apps/log-bridge/src/index.ts#L69](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L69) and [apps/log-bridge/src/index.ts#L87](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/src/index.ts#L87).
  - Impact:
    - `requestId` values are searched against `traceId` fields and `sessionId` values are searched against `requestId` fields. At best this creates noisy over-broad queries; at worst it interacts badly with provider-specific query semantics and misses the right logs.
  - Suggested fix:
    - Preserve the mapping between correlation ID type and configured field names, instead of flattening all IDs into one shared value set.

- Tests still only validate URL shape, not valid Loki semantics
  - Evidence:
    - The new multi-field test asserts that the generated URL does not contain both fields inside a stream selector and does contain both names in the URL, see [apps/log-bridge/test/log-bridge.test.ts#L107](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/log-bridge/test/log-bridge.test.ts#L107).
    - It does not assert that the resulting query is valid Loki syntax for label-based correlation or that label-only streams can actually match.
  - Impact:
    - The suite stays green while the underlying query semantics remain wrong.
  - Suggested fix:
    - Add a test that locks down valid label-based query generation for multiple configured log fields.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the latest `buildLogQL()` implementation
  - Re-read the new multi-field log bridge tests
  - Cross-checked generated query structure against Loki label vs line-filter semantics
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around default Jaeger endpoint compatibility, request/session correlation support, and basic `logFields` propagation are closed
  - 1 High and 2 Medium issues remain

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
      - The query now mentions configured field names, but it still uses line regex semantics instead of label matching.
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
  - Rework Loki query generation so configured correlation fields remain label-based matchers
  - Keep correlation ID types mapped to the right configured fields
  - Add a test that proves valid label-based multi-field query generation
