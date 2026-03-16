# Development Review Phase 13 Recheck 2

## 1. Metadata

- Review target: Phase 13 Real CodeTask Execution Chain recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-13-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-1.md)
- Related phase: Phase 13
- Related previous reviews:
  - [development-review-phase-13.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13.md)
  - [development-review-phase-13-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-1.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The previous review/version gating issues are mostly fixed: `submitReview` now checks `codeTaskVersion`, normal review is restricted to `SUCCEEDED`, override review requires the explicit flag, and `changedFiles` is now persisted. However, two blocking issues still remain. Override review is still allowed for any `FAILED` task instead of only true verify-failure cases with persisted review artifacts, and the current artifact generation still misses newly created untracked files because it relies only on `git diff HEAD`.

## 3. Findings

### High

- `forceReviewOnVerifyFailure` currently allows override review for any `FAILED` task, not just verify-failed tasks with reviewable artifacts
  - Evidence:
    - `submitReview()` treats `row.status === 'FAILED'` as sufficient for override review and does not check whether the failure actually came from `VERIFYING`, whether `verifyPassed=false`, or whether diff/patch/verify outputs exist, see [code-task-service.ts#L222](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L222) and [code-task-service.ts#L228](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L228).
    - The design is narrower: override review is only allowed when verify failed and diff/patch have already been persisted, see [design.md#L2845](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2845) and [design.md#L2846](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2846).
    - Current tests only exercise a hand-written `FAILED` row plus `forceReviewOnVerifyFailure=true`; they do not distinguish verify-failure from agent-execution failure, see [integration.test.ts#L241](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L241).
  - Impact:
    - A task that failed because the agent crashed or timed out before producing reviewable diff/patch/verify artifacts can still be forced into `COMMIT_PENDING`.
    - This violates the Phase 13 gate that only failed verify should be reviewable through the documented override path.

- Artifact generation still omits newly created untracked files, so diff/patch/changedFiles do not fully reflect workspace state
  - Evidence:
    - `ArtifactWriter.generateArtifacts()` computes everything from `git diff HEAD` and `git diff HEAD --name-only`, see [artifact-writer.ts#L49](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L49) and [artifact-writer.ts#L52](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L52).
    - Those commands do not report an untracked file unless it has been staged; I verified this locally in a temp repo by creating `new-file.txt` after an initial commit and observing that `git diff HEAD --name-only` returned no output.
    - The design requires `changedFiles` / `diffPath` / `patchPath` to reflect workspace-derived change facts, see [design.md#L1545](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L1545), and Phase 13 exit criteria require diff/patch outputs to reflect real workspace state, see [product-completion-roadmap.md#L107](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L107).
  - Impact:
    - If a repair creates a new test file or source file, `changedFiles` can stay incomplete and the persisted diff/patch can miss the most important part of the change.
    - Review, replay, and later commit control would then operate on an incomplete artifact set even though the workspace actually changed.

### Medium

- The new tests still do not lock down the remaining override and untracked-file behavior
  - Evidence:
    - The new override tests only check status-based `FAILED` handling, not whether the task truly failed in `VERIFYING` with persisted review artifacts, see [integration.test.ts#L233](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L233).
    - The `ArtifactWriter` test still only covers a tracked-file modification and does not cover newly created untracked files, see [agent-harness.test.ts#L268](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/test/agent-harness.test.ts#L268).
  - Impact:
    - The suite stays green while the remaining artifact-completeness and override-boundary bugs remain open.

## 4. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Verified local Git behavior for `git diff HEAD --name-only` on an untracked new file
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 16 test files and 302 tests passing

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
      - state progression and version gating improved, but artifact completeness still misses untracked files.
  - Criterion:
    - `verify results and diff/patch outputs reflect real workspace state`
    - Result:
      - fail
    - Notes:
      - untracked newly created files are still omitted by the current Git diff strategy.
  - Criterion:
    - `failed verify stays reviewable only through the documented override path`
    - Result:
      - fail
    - Notes:
      - override review is still keyed off generic `FAILED` status instead of true verify-failure evidence.

## 6. Follow-ups / Notes

- Required follow-up actions:
  - Restrict override review to true verify-failure cases with persisted diff/patch/verify artifacts
  - Extend artifact generation so newly created untracked files are included in `changedFiles` and persisted diff/patch outputs
  - Add regression tests for override rejection on non-verify failures and for untracked-file artifact capture
