# Development Review Phase 13 Recheck 1

## 1. Metadata

- Review target: Phase 13 Real CodeTask Execution Chain recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-13.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13.md)
- Related phase: Phase 13
- Related previous reviews:
  - [development-review-phase-13.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The main Phase 13 execution-path issues from the previous review are largely closed: execution now returns immediately, successful runs land in `SUCCEEDED` instead of jumping straight to `COMMIT_PENDING`, non-zero agent exits are treated as failures, and `verifyOutputPath` is now persisted. However, two contract-level gaps still block closure: review submission still ignores state/version/override constraints, and the real execution path still does not persist `changedFiles`.

## 3. Findings

### High

- `submitReview()` still ignores the documented review gate constraints
  - Evidence:
    - The service accepts any existing task, writes a review record immediately, and transitions status solely from `input.decision`, without checking the current task status, `codeTaskVersion`, or `forceReviewOnVerifyFailure`, see [code-task-service.ts#L213](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L213) and [code-task-service.ts#L228](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L228).
    - The contract says `SubmitReviewInput.codeTaskVersion` must match the current `CodeTask.taskVersion`, see [services.ts#L82](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L82) and [app-services-design.md#L692](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L692).
    - The design says normal review is for the post-verify reviewable state, and verify-failed override requires explicit `forceReviewOnVerifyFailure=true`, see [design.md#L900](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L900), [code-task-design.md#L131](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/code-task-design.md#L131), and [api-contract-design.md#L147](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L147).
  - Impact:
    - A stale client can review the wrong attempt and still move the task to `COMMIT_PENDING`.
    - A verify-failed task can be accepted without the explicit override flag that the contract requires.
    - Review is still not bound tightly enough to the exact reviewable snapshot/version.

### Medium

- `changedFiles` is still never persisted by the real execution path
  - Evidence:
    - Phase 13 deliverables explicitly require persisting `changed files`, see [product-completion-roadmap.md#L99](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L99).
    - The design also says `changedFiles`, `diffPath`, and `patchPath` should be system-derived from workspace state, see [code-task-design.md#L89](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/code-task-design.md#L89).
    - `CodeTaskDetail` reads `row.changed_files_json`, but neither `runExecution()` nor `ArtifactWriter.generateArtifacts()` ever populates it, see [code-task-service.ts#L65](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L65) and [artifact-writer.ts#L66](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L66).
  - Impact:
    - The API still returns an empty `changedFiles` array even after a real code change.
    - Review and audit consumers cannot inspect the normalized changed-file set that the Phase 13 contract promised.

- Tests still do not lock down the remaining review/version and changed-files semantics
  - Evidence:
    - The integration flow only asserts the happy path `APPROVED -> execute -> SUCCEEDED -> review accept`, see [integration.test.ts#L184](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L184).
    - There is no test for stale `codeTaskVersion`, failed-verify override review, or `changedFiles` persistence.
    - The current API/unit test for `submitReview` still only checks the unconditional accept path, see [api.test.ts#L136](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/api.test.ts#L136).
  - Impact:
    - The suite can stay green while the remaining contract bugs in review control and artifact persistence remain open.

## 4. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 16 test files and 298 tests passing

## 5. Phase Gate

- Exit criteria checked:
  - Criterion:
    - `approving and executing a CodeTask starts a real harness/code-agent session`
    - Result:
      - pass
  - Criterion:
    - `code_tasks are updated from system-derived execution facts, not status-only placeholders`
    - Result:
      - partial
    - Notes:
      - execution status progression and artifact paths improved, but `changedFiles` is still missing and review version constraints are not enforced.
  - Criterion:
    - `verify results and diff/patch outputs reflect real workspace state`
    - Result:
      - pass
  - Criterion:
    - `failed verify stays reviewable only through the documented override path`
    - Result:
      - fail
    - Notes:
      - `submitReview()` still does not enforce the explicit override flag or current reviewable state.

## 6. Follow-ups / Notes

- Required follow-up actions:
  - Enforce `submitReview` state/version rules, including `forceReviewOnVerifyFailure`
  - Persist `changedFiles` from the workspace-derived execution result
  - Add regression tests for stale review version, verify-failed override gating, and changed-files persistence
