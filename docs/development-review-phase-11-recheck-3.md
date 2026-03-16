# Development Review Phase 11 Recheck 3

## 1. Metadata

- Review target: Phase 11 Real Test Execution recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-2.md)
- Related phase: Phase 11
- Related previous reviews:
  - [development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
  - [development-review-phase-11-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-1.md)
  - [development-review-phase-11-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-2.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - This recheck closes the previous status-overwrite problem for `cancel`, and the baseline commands remain green. However, Phase 11 still does not satisfy the documented execution contract: `testcaseId` / `scenarioId` selectors still execute the full Playwright suite and only post-filter persisted results, and `pause` / `resume` still do not implement a real resumable safe-point flow.

## 3. Scope

- Reviewed modules:
  - [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts)
  - [apps/test-runner/test/test-runner.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts)
  - [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
- Reviewed docs/contracts:
  - [docs/development-review-phase-11-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-2.md)
  - [docs/test-assets-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)

## 4. Findings

### High

- `testcaseId` / `scenarioId` selectors still do not perform real execution selection
  - Evidence:
    - The runner no longer passes `--grep` for `testcaseId` / `scenarioId`, but instead explicitly runs all Playwright tests and only post-filters parsed results afterward, see [apps/test-runner/src/index.ts#L179](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L179), [apps/test-runner/src/index.ts#L197](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L197), and [apps/test-runner/src/index.ts#L232](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L232).
    - The design requires `RunRequest -> TestCaseRepository / AssetIndex -> executable testcase list -> Playwright filtering -> Test Runner`, see [docs/test-assets-design.md#L195](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L195).
  - Impact:
    - A run targeted at one testcase or scenario still executes every test in the project. Unselected tests can still trigger side effects, extend runtime, and fail independently even though their results are then discarded from storage.
    - This means Phase 11 still does not meet the “real test selection” gate; it only fixes storage identity alignment after execution.
  - Suggested fix:
    - Resolve selectors to concrete testcase assets before invocation and translate that resolved set into Playwright-level filtering, instead of executing the whole suite and filtering the report afterward.

- `pause` / `resume` still do not implement the documented safe-point resume behavior
  - Evidence:
    - `pauseRun()` now terminates the active runner process and marks the run `PAUSED`, see [apps/cli/src/services/run-service.ts#L233](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L233).
    - `resumeRun()` only flips status back to `RUNNING_TESTS`; it does not restart execution, restore a checkpoint, or schedule any further work, see [apps/cli/src/services/run-service.ts#L242](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L242).
    - The design requires `pause` to stop at a safe point and `resume` to continue from the latest stable state, see [docs/design.md#L917](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L917) and [docs/design.md#L930](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L930).
  - Impact:
    - Pausing an active regression run effectively kills it. Resuming that run only changes the row status; no Playwright work continues, so the run is left in a false “running” state.
    - This leaves the control API inconsistent with the product contract for resumable execution.
  - Suggested fix:
    - Persist resumable execution state and re-dispatch work on `resume`, or explicitly defer `pause/resume` support for regression runs instead of presenting a non-functional API.

### Medium

- The new tests still do not verify actual execution scoping or real pause/resume flow
  - Evidence:
    - The added runner tests only prove post-filtered persistence for selectors, not that unselected tests were skipped at execution time, see [apps/test-runner/test/test-runner.test.ts#L269](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts#L269).
    - The current integration test for pause/resume only checks HTTP 200 responses and never verifies that work actually resumes, see [apps/cli/test/integration.test.ts#L95](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L95).
  - Impact:
    - The current green test suite does not guard the two remaining contract failures, so regressions in execution selection and run control can still merge unnoticed.
  - Suggested fix:
    - Add tests that assert only the requested testcase/scenario is actually executed, and add an async runner integration test that proves `pause` reaches a safe point and `resume` continues work instead of only changing stored status.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the updated runner and run-control implementation
  - Re-read the newly added runner tests and integration tests
  - Cross-checked remaining behavior against the Phase 11 design contract
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around status overwrite after `cancel`, package-local runner tests, lint failures, non-blocking execution, skipped-event handling, and `networkLogPath` persistence are closed
  - 2 High and 1 Medium issues remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `startRun can execute a real Playwright test selection`
    - Result:
      - fail
    - Notes:
      - ID-based selectors now align with persisted identity, but still do not constrain Playwright execution scope.
  - Criterion:
    - `run control actions behave consistently during execution`
    - Result:
      - fail
    - Notes:
      - `cancel` no longer overwrites final state, but `pause` / `resume` still do not implement a resumable flow.
  - Criterion:
    - `artifacts and testcase persistence work for real runs`
    - Result:
      - pass
    - Notes:
      - The artifact and result persistence path remains green under current tests.

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Replace post-filtered ID selection with real pre-execution testcase resolution
  - Either implement resumable `pause` / `resume` correctly or gate those actions off for regression runs until supported
  - Add tests that lock down execution scoping and active-run control behavior
- Risks carried into next phase:
  - If merged now, the workbench will appear to support testcase/scenario runs and run control, but those APIs will still over-execute tests and misrepresent pause/resume behavior.
