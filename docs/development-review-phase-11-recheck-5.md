# Development Review Phase 11 Recheck 5

## 1. Metadata

- Review target: Phase 11 Real Test Execution recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-4.md)
- Related phase: Phase 11
- Related previous reviews:
  - [development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
  - [development-review-phase-11-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-1.md)
  - [development-review-phase-11-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-2.md)
  - [development-review-phase-11-recheck-3.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-3.md)
  - [development-review-phase-11-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11-recheck-4.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - This recheck closes the previous scenario fan-out and terminal-state transition issues, and the baseline commands remain green. However, Phase 11 still cannot close because exact ID-based selection is still implemented with an unanchored `--grep` regex, which can over-select additional tests whose titles contain the resolved title as a substring. There is also still an API error mapping bug for `resume` on existing non-paused runs.

## 3. Scope

- Reviewed modules:
  - [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts)
  - [apps/test-runner/test/test-runner.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts)
  - [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts)
  - [apps/cli/src/handlers/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)

## 4. Findings

### High

- `testcaseId` / `scenarioId` selection still over-selects because the generated `--grep` pattern is not anchored
  - Evidence:
    - ID resolution now returns exact title(s), but execution passes them to Playwright as raw escaped regex fragments: a single title becomes `escapeRegex(resolvedTitle)`, and multiple titles become `(<title1>|<title2>)`, see [apps/test-runner/src/index.ts#L197](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L197) and [apps/test-runner/src/index.ts#L198](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L198).
  - Impact:
    - Any other test whose full title contains one of those resolved titles as a substring will also match and execute. For example, selecting `MySuite > login test` can also run `MySuite > login test variant`.
    - This means exact `testcaseId` / `scenarioId` selection is still not guaranteed even though title resolution itself is now correct.
  - Suggested fix:
    - Anchor the regex to the full title when generating `--grep`, or use a filtering approach that guarantees exact title equality rather than substring regex matching.

### Medium

- `/runs/:runId/resume` still reports `404` for an existing run that is simply not paused
  - Evidence:
    - `resumeRun()` returns `RUN_NOT_PAUSED` for an existing non-paused run, see [apps/cli/src/services/run-service.ts#L256](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L256).
    - The router does not map that code explicitly, so it falls through to `notFound(...)`, see [apps/cli/src/handlers/index.ts#L79](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L79) and [apps/cli/src/handlers/index.ts#L83](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L83).
  - Impact:
    - The API tells clients the run does not exist when the real problem is an invalid action for the current state.
  - Suggested fix:
    - Map `RUN_NOT_PAUSED` to a non-404 status such as `400` or `409`, consistent with other state/action validation errors.

- Tests still do not lock down the remaining exact-match and resume-error semantics
  - Evidence:
    - The selector tests assert that the combined grep contains the expected titles, but they do not assert exact-match anchoring against substring-collision cases, see [apps/test-runner/test/test-runner.test.ts#L393](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/test/test-runner.test.ts#L393).
    - The integration tests cover `RUN_RESUME_NOT_SUPPORTED`, but not `RUN_NOT_PAUSED` on an existing run, see [apps/cli/test/integration.test.ts#L95](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L95).
  - Impact:
    - The two remaining edge-case bugs are currently unguarded by tests.
  - Suggested fix:
    - Add a substring-collision selector test and a resume-on-non-paused-run API test.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the latest selector resolution and grep generation path
  - Re-read the latest router error-code mappings
  - Re-read the new selector and terminal-state tests
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around scenario fan-out and terminal-state pause/cancel transitions are closed
  - 1 High and 2 Medium issues remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `startRun can execute an exact real Playwright test selection`
    - Result:
      - fail
    - Notes:
      - ID resolution is now materially correct, but execution still uses non-anchored regex matching for the final Playwright filter.
  - Criterion:
    - `run control APIs return state-accurate responses`
    - Result:
      - fail
    - Notes:
      - `resume` still misreports `RUN_NOT_PAUSED` as `404`.
  - Criterion:
    - `artifacts and testcase persistence work for real runs`
    - Result:
      - pass

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Make ID-based `--grep` exact, not substring-based
  - Map `RUN_NOT_PAUSED` to a state/action error response instead of `404`
  - Add tests for substring-collision selection and resume-on-non-paused-run
