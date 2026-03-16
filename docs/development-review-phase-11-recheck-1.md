# Development Review Phase 11 Recheck 1

## 1. Metadata

- Review target: Phase 11 Real Test Execution recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
- Related phase: Phase 11
- Related previous reviews:
  - [development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
  - [development-review-phase-10-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-4.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The Phase 11 branch has fixed most of the first-round issues: execution is now non-blocking, `networkLogPath` is persisted, skipped tests are no longer emitted as failures, and the baseline commands pass again. However, one contract-level blocker remains: `scenarioId` / `testcaseId` selection still does not line up with the metadata source used to derive stable testcase identity.

## 3. Scope

- Reviewed modules:
  - [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts)
  - [apps/test-runner/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/package.json)
  - [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
- Reviewed docs/contracts:
  - [docs/development-review-phase-11.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-11.md)
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
    - The runner now derives persisted testcase identity from Playwright annotations `zarb-testcase-id` / `zarb-scenario-id`, see [apps/test-runner/src/index.ts#L403](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L403).
    - But execution selection for `scenarioId` and `testcaseId` still uses `playwright test --grep <id>`, see [apps/test-runner/src/index.ts#L167](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L167).
    - The local design explicitly allows `scenarioId` to come from test metadata or test-file annotations, see [docs/test-assets-design.md#L185](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L185), and requires each test to bind stable `scenarioId / testcaseId`, see [docs/design.md#L2552](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2552).
    - From Playwright’s official docs, annotations are report metadata, while `--grep` is documented for text / tag filtering rather than arbitrary annotation descriptions: https://playwright.dev/docs/test-annotations
  - Impact:
    - If a project follows the documented Phase 11 direction and stores IDs in annotations instead of titles, `startRun({ selector: { scenarioId } })` / `startRun({ selector: { testcaseId } })` can fail to select the intended tests even though the runner later persists those same IDs in storage.
    - This leaves the system in a split-brain state: selection is based on title text, but storage and diagnostics are keyed by annotation-derived identity.
  - Suggested fix:
    - Make selection and persistence use the same identity source.
    - Either add the missing asset-index resolution layer before invoking Playwright, or constrain Phase 11 to a documented tag/title convention and stop claiming annotation-derived IDs as the canonical selector source until that layer exists.

### Medium

- Missing metadata is still silently converted into hashed testcase IDs
  - Evidence:
    - When `zarb-testcase-id` is absent, the runner falls back to `titleHash(fullTitle)`, see [apps/test-runner/src/index.ts#L406](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L406).
    - The design says every test must bind `scenarioId / testcaseId`, see [docs/design.md#L2552](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2552).
  - Impact:
    - Invalid test assets are accepted silently, and a title rename changes the derived ID even though the product model expects stable testcase identity.
  - Suggested fix:
    - Prefer failing fast or recording an explicit degraded/error condition when required test metadata is missing, instead of silently generating a fallback identifier.

- Phase 11 still has no dedicated runner-level tests
  - Evidence:
    - `apps/test-runner` now contains substantial execution logic, but there is still no package-local `test/` directory and [apps/test-runner/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/package.json) does not define runner-specific tests.
  - Impact:
    - The current green baseline does not directly verify selector translation, annotation-derived IDs, artifact persistence, or correlation extraction for the new runner path.
  - Suggested fix:
    - Add targeted tests for `TestRunner.execute()` and the async `RunService` integration, especially for selector mapping, metadata extraction, skipped-test handling, and HAR-based correlation capture.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the current Phase 11 runner implementation
  - Compared first-round findings against the updated code path
  - Cross-checked selector / metadata semantics against design and Playwright docs
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - Previous issues around blocking execution, skipped-event misclassification, `networkLogPath` persistence, and lint failures are closed
  - 1 High and 2 Medium issues remain

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `startRun can execute a real Playwright test selection`
    - Result:
      - fail
    - Notes:
      - Real execution now works asynchronously, but `scenarioId` / `testcaseId` selectors still do not align with annotation-derived identity.
  - Criterion:
    - `artifacts are written under the documented storage layout`
    - Result:
      - pass
    - Notes:
      - `networkLogPath` is now persisted alongside other artifacts.
  - Criterion:
    - `failed testcases produce failure-report inputs without manual seeding`
    - Result:
      - pass with notes
    - Notes:
      - Persistence path is materially improved, but missing testcase metadata is still silently hashed.
  - Criterion:
    - `runner startup failure is treated as blocking; testcase-level failures are not`
    - Result:
      - pass
    - Notes:
      - The non-blocking spawn path and event fixes close the first-round issue here.
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: no
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - `apps/test-runner` still lacks a dedicated `test/` directory.

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Unify selector resolution and persisted testcase identity for `scenarioId` / `testcaseId`
  - Decide whether missing testcase metadata is fatal or degraded, and enforce that policy explicitly
  - Add package-level tests for `apps/test-runner`
- Deferred items:
  - Phase 12 real trace/log provider integration
  - richer execution-profile population beyond the Phase 11 minimum slice
- Risks carried into next phase:
  - If merged now, the system can execute real tests, but projects that rely on annotation-defined testcase identity will still see selection behavior diverge from persisted run/diagnostics identity.
