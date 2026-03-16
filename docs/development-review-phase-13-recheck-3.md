# Development Review Phase 13 Recheck 3

## 1. Metadata

- Review target: Phase 13 Real CodeTask Execution Chain recheck
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: recheck of fixes for [development-review-phase-13-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-2.md)
- Related phase: Phase 13
- Related previous reviews:
  - [development-review-phase-13.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13.md)
  - [development-review-phase-13-recheck-1.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-1.md)
  - [development-review-phase-13-recheck-2.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-2.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - The previous two remaining issues are largely addressed: override review is now restricted to verify-failure-shaped rows, and artifact generation now includes newly created untracked files. However, the new artifact-capture strategy introduces a fresh blocking regression: it mutates the target workspace’s staged index state by running `git add -N .` followed by `git restore --staged .`, which can silently unstage user changes unrelated to the current CodeTask.

## 3. Findings

### High

- Artifact generation now destroys pre-existing staged state in the target workspace
  - Evidence:
    - `ArtifactWriter.generateArtifacts()` now runs `git add -N .` before reading diff state, then unconditionally runs `git restore --staged .` afterwards, see [artifact-writer.ts#L49](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L49) and [artifact-writer.ts#L53](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L53).
    - I validated this with a local temp repo containing an already staged modification plus a new untracked file: after the same `git add -N .` and `git restore --staged .` sequence, `git diff --cached --name-only` became empty, proving the previously staged change was lost from the index.
  - Impact:
    - Executing a CodeTask can silently unstage unrelated user work in the target project.
    - That breaks the expectation that artifact capture is observational, not destructive, and makes the Phase 13 execution path unsafe to run against a dirty collaborative workspace.
  - Suggested fix:
    - Capture untracked-file-aware artifacts without mutating the caller’s index state, or snapshot and restore the exact staged set instead of blasting the whole index with `git restore --staged .`.

### Medium

- Tests still do not protect staged-index preservation
  - Evidence:
    - The new artifact test only verifies that an untracked file appears in `changedFiles` and the diff output, see [agent-harness.test.ts#L294](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/test/agent-harness.test.ts#L294).
    - There is no test covering a workspace that already has staged changes before artifact generation begins.
  - Impact:
    - The suite stays green while this staged-state regression remains open.

## 4. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Reproduced the new `git add -N .` / `git restore --staged .` sequence in a temp repo with a pre-staged file and an untracked file
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 16 test files and 304 tests passing

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
      - artifact completeness improved, but capture is now unsafe because it mutates staged workspace state.
  - Criterion:
    - `verify results and diff/patch outputs reflect real workspace state`
    - Result:
      - partial
    - Notes:
      - untracked files are now included, but the method used to obtain them is still destructive to the index.
  - Criterion:
    - `failed verify stays reviewable only through the documented override path`
    - Result:
      - pass

## 6. Follow-ups / Notes

- Required follow-up actions:
  - Replace the current `git add -N .` / `git restore --staged .` approach with a non-destructive artifact-capture strategy
  - Add a regression test proving staged changes remain staged after artifact generation while untracked files are still captured
