# Development Review Phase 11 Recheck 4

## 1. Metadata

- Review target: Phase 11 Real Test Execution recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-recheck-3.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-3.md)
- Related phase: Phase 11
- Related previous reviews:
  - [development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
  - [development-review-phase-11-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-1.md)
  - [development-review-phase-11-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-2.md)
  - [development-review-phase-11-recheck-3.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-3.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - This recheck closes the previous “execute everything then post-filter” issue for ID-based selection, and the branch still passes the baseline verification commands. However, Phase 11 still cannot close because `scenarioId` selection only resolves one testcase title instead of the full testcase set for that scenario, and the run-control API still permits illegal terminal-state transitions that violate the documented run state machine.

## 3. Scope

- Reviewed modules:
  - [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts)
  - [apps/test-runner/test/test-runner.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts)
  - [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts)
  - [apps/cli/src/handlers/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
- Reviewed docs/contracts:
  - [docs/development-review-phase-11-recheck-3.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-3.md)
  - [docs/test-assets-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)

## 4. Findings

### High

- `scenarioId` selector still only executes the first matching testcase, not the scenario’s testcase set
  - Evidence:
    - `resolveIdToTitle()` returns a single title string and uses `.find(...)` for `scenarioId`, see [apps/test-runner/src/index.ts#L376](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L376) and [apps/test-runner/src/index.ts#L395](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L395).
    - That title is then fed into a single `--grep` invocation for execution, see [apps/test-runner/src/index.ts#L184](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L184) and [apps/test-runner/src/index.ts#L197](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L197).
    - The design models `scenarioId` as metadata shared by testcase assets, and selector resolution is supposed to produce an executable testcase list before translation to Playwright filters, see [docs/test-assets-design.md#L170](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L170) and [docs/test-assets-design.md#L195](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L195).
  - Impact:
    - A `scenarioId` that maps to multiple testcase assets will currently run only the first matched test. That under-executes the scenario and makes scenario-scoped regression runs incomplete.
  - Suggested fix:
    - Resolve `scenarioId` to the full testcase set, then translate that set into Playwright filtering that can execute all matching tests rather than only the first title.

### Medium

- Run-control actions still allow illegal transitions from terminal states
  - Evidence:
    - `pauseRun()` and `cancelRun()` only check existence / a small subset of cases; they do not reject `COMPLETED` / `FAILED` runs before mutating status, see [apps/cli/src/services/run-service.ts#L233](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L233) and [apps/cli/src/services/run-service.ts#L270](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L270).
    - The documented run state machine allows `PAUSED` / `CANCELLED` from in-flight stages, but not from terminal states like `COMPLETED`, see [docs/design.md#L842](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L842), [docs/design.md#L850](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L850), and [docs/design.md#L863](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L863).
  - Impact:
    - A finished run can still be rewritten to `PAUSED` or `CANCELLED`, corrupting historical state and making the UI/API report impossible transitions.
  - Suggested fix:
    - Enforce the documented state machine in `pauseRun()` / `resumeRun()` / `cancelRun()` and reject control actions for terminal states.

- Tests still do not cover the remaining selector and state-machine edge cases
  - Evidence:
    - The new selector tests only cover one testcase per `scenarioId`, see [apps/test-runner/test/test-runner.test.ts#L327](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts#L327).
    - The integration tests do not assert that terminal runs reject pause/cancel, see [apps/cli/test/integration.test.ts#L292](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L292) and [apps/cli/test/integration.test.ts#L309](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L309).
  - Impact:
    - The remaining scenario-selection bug and illegal state transitions are currently unguarded by tests.
  - Suggested fix:
    - Add a multi-testcase `scenarioId` selector test and control-action tests that verify terminal runs cannot transition back to `PAUSED` / `CANCELLED`.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the updated selector resolution path
  - Re-read the updated run-control logic and router mappings
  - Cross-checked remaining behavior against the design and test-asset contracts
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around full-suite execution for ID selectors, non-blocking execution, `cancel` status overwrite, skipped-event handling, `networkLogPath` persistence, and package-local runner tests are closed
  - 1 High and 2 Medium issues remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `startRun can execute a real Playwright test selection`
    - Result:
      - fail
    - Notes:
      - `testcaseId` selection is now materially improved, but `scenarioId` still under-selects by executing only the first matched testcase.
  - Criterion:
    - `run control actions behave consistently during execution and in terminal states`
    - Result:
      - fail
    - Notes:
      - Resume is now explicitly rejected for unsupported regression flows, but terminal-state transitions are still not protected.
  - Criterion:
    - `artifacts and testcase persistence work for real runs`
    - Result:
      - pass
    - Notes:
      - No new regressions were found in artifact or result persistence.

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Make `scenarioId` resolve to all matching testcase assets instead of a single title
  - Enforce legal run-state transitions for `pause` / `resume` / `cancel`
  - Add tests for multi-testcase scenarios and terminal-state control rejection
- Risks carried into next phase:
  - If merged now, scenario-scoped runs can silently miss part of the intended coverage, and run history can still be rewritten into impossible states by control actions.
