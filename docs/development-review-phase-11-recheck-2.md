# Development Review Phase 11 Recheck 2

## 1. Metadata

- Review target: Phase 11 Real Test Execution recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-1.md)
- Related phase: Phase 11
- Related previous reviews:
  - [development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
  - [development-review-phase-11-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-1.md)
  - [development-review-phase-10-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-4.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phase 11 has closed most of the first two review rounds: the runner is non-blocking, baseline verification is green again, `networkLogPath` is persisted, skipped tests are no longer emitted as failures, and `apps/test-runner` now has package-local tests. However, Phase 11 still cannot be closed because selector semantics remain inconsistent with persisted testcase identity, and the newly asynchronous run path still does not honor `cancel` / `pause` control semantics.

## 3. Scope

- Reviewed modules:
  - [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts)
  - [apps/test-runner/test/test-runner.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts)
  - [apps/test-runner/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/package.json)
  - [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts)
- Reviewed docs/contracts:
  - [docs/development-review-phase-11-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-1.md)
  - [docs/test-assets-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)
- Explicitly out of scope:
  - Phase 12 trace/log provider implementation
  - Phase 13 code-agent execution path
  - packaging / release flow

## 4. Findings

### High

- `scenarioId` / `testcaseId` selectors still do not target the same identity source that the runner persists
  - Evidence:
    - Execution selection for `testcaseId` and `scenarioId` still translates directly to `playwright test --grep <id>`, see [apps/test-runner/src/index.ts#L169](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L169) and [apps/test-runner/src/index.ts#L171](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L171).
    - Persisted testcase identity is derived from `zarb-testcase-id` annotation when present, otherwise from `titleHash(fullTitle)`, and `scenarioId` is derived from `zarb-scenario-id`, see [apps/test-runner/src/index.ts#L428](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L428), [apps/test-runner/src/index.ts#L429](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L429), and [apps/test-runner/src/index.ts#L432](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L432).
    - The design requires `suite | scenario | tag | testcase` selectors to resolve to executable testcase assets before conversion to Playwright filters, see [docs/test-assets-design.md#L195](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L195), and requires each test to bind stable `scenarioId / testcaseId`, see [docs/design.md#L2552](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2552).
  - Impact:
    - `startRun({ selector: { testcaseId } })` still does not reliably select the testcase whose persisted `testcaseId` equals that value. This is broken both for annotation-based IDs and for title-hash fallback IDs, because `--grep <id>` matches title text, not the metadata that persistence later stores.
    - The workbench still has a split contract: runs are selected by title substring, but storage and diagnostics are keyed by metadata-derived identity.
  - Suggested fix:
    - Add the missing testcase asset-resolution layer before invoking Playwright, or otherwise make selector translation use the same metadata source that persistence uses instead of direct `--grep <id>` on raw selector values.

- `cancel` / `pause` remain state-only markers and do not control the background runner
  - Evidence:
    - Background execution now runs in an async task that always writes a terminal status when the runner finishes, see [apps/cli/src/services/run-service.ts#L123](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L123).
    - `pauseRun()` and `cancelRun()` only update the run row; they do not signal the child process or prevent the async completion path from overwriting status, see [apps/cli/src/services/run-service.ts#L226](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L226) and [apps/cli/src/services/run-service.ts#L238](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L238).
    - The design treats `pause` as a safe-point pause and `cancel` as a real control action on in-flight runs, see [docs/design.md#L793](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L793), [docs/design.md#L919](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L919), and [docs/design.md#L929](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L929).
  - Impact:
    - A cancelled run keeps executing Playwright in the background and can later transition back to `COMPLETED`, `FAILED`, or `ANALYZING_FAILURES`, which makes the control API lie about the real run state.
    - `pause` has the same problem: it changes displayed status, but execution continues with no checkpointing or safe-point stop.
  - Suggested fix:
    - Track the spawned process / execution token per run, make `cancel` terminate or suppress completion of the in-flight runner, and make `pause` honor the documented safe-point model instead of only mutating stored status.

### Medium

- The new runner tests still do not cover selector translation or run-control behavior
  - Evidence:
    - [apps/test-runner/test/test-runner.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts) now covers metadata persistence, degraded events, skipped-event handling, artifact persistence, startup failure, and counters.
    - But it still has no test that proves `selector.testcaseId` / `selector.scenarioId` maps to the intended Playwright selection, and no integration test that proves `cancel` / `pause` behave correctly once a run is executing through [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts).
  - Impact:
    - The baseline is green while two user-visible contract bugs remain untested, which is why they survived into this recheck.
  - Suggested fix:
    - Add targeted tests for selector-to-Playwright translation and for run control semantics under the async runner integration path.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the current Phase 11 runner implementation
  - Re-read the new `apps/test-runner` unit tests
  - Cross-checked selector and run-control semantics against design docs
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around blocking execution, skipped-event misclassification, `networkLogPath` persistence, lint failures, and missing package-local runner tests are closed
  - 2 High and 1 Medium issues remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `startRun can execute a real Playwright test selection`
    - Result:
      - fail
    - Notes:
      - Real execution works asynchronously, but `scenarioId` / `testcaseId` selectors still do not map to the same testcase identity that the runner persists.
  - Criterion:
    - `artifacts are written under the documented storage layout`
    - Result:
      - pass
    - Notes:
      - `networkLogPath` now persists as a first-class artifact and the package has direct runner tests.
  - Criterion:
    - `run control actions behave consistently during execution`
    - Result:
      - fail
    - Notes:
      - `cancel` / `pause` currently mutate stored status only; they do not control the background Playwright execution.
  - Criterion:
    - `runner startup failure is treated as blocking; testcase-level failures are not`
    - Result:
      - pass
    - Notes:
      - The non-blocking spawn path and testcase-level failure handling remain correct.
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Unify selector resolution and persisted testcase identity for `scenarioId` / `testcaseId`
  - Make `cancel` / `pause` actually control or suppress the in-flight background runner
  - Add tests that lock down selector translation and run-control behavior
- Deferred items:
  - Phase 12 real trace/log provider integration
  - richer execution-profile population beyond the Phase 11 minimum slice
- Risks carried into next phase:
  - If merged now, the workbench can run real Playwright tests and persist artifacts, but ID-based selection and run-control APIs will still behave inconsistently with the documented product contract.
