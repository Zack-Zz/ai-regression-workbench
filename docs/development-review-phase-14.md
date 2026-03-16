# Development Review Phase 14

## 1. Metadata

- Review target: Phase 14 Real Review And Commit Control
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: initial review of the Phase 14 delivery
- Related phase: Phase 14
- Related previous reviews:
  - [development-review-phase-13-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-13-recheck-4.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phase 14 moves review/commit beyond pure audit records, but the real `/commits` path is still not safe to close. The service currently re-applies the task patch onto the already-modified workspace, stages unrelated dirty files with `git add -A`, and does not fully wire branch control/audit through the public commit flow.

## 3. Scope

- Reviewed modules:
  - [apps/cli/src/services/code-task-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts)
  - [apps/review-manager/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/review-manager/src/index.ts)
  - [packages/agent-harness/src/artifact-writer.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts)
  - [packages/storage/src/repos/commit-repo.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/storage/src/repos/commit-repo.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
  - [apps/review-manager/test/review-manager.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/review-manager/test/review-manager.test.ts)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/code-task-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/code-task-design.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)
  - [docs/app-services-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md)

## 4. Findings

- High: the real `/commits` path re-applies the task patch onto a workspace that already contains those same edits. `ArtifactWriter.generateArtifacts()` writes `patchPath` from the current workspace diff state in [artifact-writer.ts#L49](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L49) and [artifact-writer.ts#L87](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L87). `CodeTaskService.createCommit()` then always forwards that `row.patch_path` to `CommitManager` in [code-task-service.ts#L303](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L303), and `CommitManager.commit()` unconditionally runs `git apply` in [index.ts#L60](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/review-manager/src/index.ts#L60) and [index.ts#L63](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/review-manager/src/index.ts#L63). In the normal Phase 13 -> Phase 14 flow, that means trying to apply the same patch twice. I reproduced this against a temp git repo: `git diff HEAD > change.patch` followed by `git apply change.patch` on the still-dirty workspace failed with `patch does not apply`. The direct `review-manager` tests never exercise this code path because they call `CommitManager.commit()` without `patchPath`.

- High: commit execution stages the entire workspace instead of the reviewed snapshot. `CommitManager.commit()` uses `git add -A` in [index.ts#L79](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/review-manager/src/index.ts#L79), so any unrelated dirty file already present in the target repo will be swept into the commit. That violates the Phase 14 contract to review and commit the exact diff/patch snapshot tied to the task version in [product-completion-roadmap.md#L119](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L119) and undermines the audit requirement in [product-completion-roadmap.md#L129](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L129). The current implementation never constrains staging to `changedFiles`, `patchPath`, or another task-scoped file set.

- Medium: branch control and branch audit are not fully wired through the public commit flow. The Phase 14 deliverables call for persisting commit branch information in [product-completion-roadmap.md#L122](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md#L122), and the broader design keeps `branchName` in the model in [code-task-design.md#L59](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/code-task-design.md#L59) and [design.md#L1515](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L1515). But the actual `/commits` input no longer exposes `branchName` in [services.ts#L88](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L88), `CodeTaskService.createCommit()` never forwards one in [code-task-service.ts#L303](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L303), and `CommitRepository.update()` cannot persist the branch chosen at commit time in [commit-repo.ts#L44](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/storage/src/repos/commit-repo.ts#L44). The one branch test currently covers only direct `CommitManager.commit({ branchName })`, which is not the product API path.

- Medium: regression coverage misses the real commit-path risks above. `apps/cli` integration tests replace `CommitManager` with a stub in [integration.test.ts#L37](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L37) and only assert that `/commits` returns `200` in [integration.test.ts#L220](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L220). `apps/review-manager` tests exercise direct git commit success/failure and branch creation, but they do not cover `patchPath` in [review-manager.test.ts#L67](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/review-manager/test/review-manager.test.ts#L67) or isolation from unrelated dirty files. That leaves the two High-severity regressions unguarded.

## 5. Validation

- Commands run:
  - `pnpm lint`
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Re-read the commit path from `CodeTaskService.createCommit()` into `CommitManager.commit()`
  - Re-read how Phase 13 artifacts derive `patchPath` from current workspace state
  - Reproduced duplicate patch application against a temp git repo
- Result summary:
  - `pnpm lint` passed
  - `pnpm -r typecheck` passed
  - `pnpm build` passed
  - `pnpm test` passed
  - `pnpm test` completed with 17 test files and 310 tests passing
  - The reproduced duplicate-apply scenario failed with `patch does not apply`, which matches the current `/commits` control flow

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `review accept still does not auto-commit`
    - Result:
      - pass
  - Criterion:
    - `explicit commit can create a real commit in the target workspace`
    - Result:
      - fail
  - Criterion:
    - `commit failures are surfaced and persisted without corrupting task history`
    - Result:
      - fail
  - Criterion:
    - `audit data is sufficient to reconstruct who approved, what changed, and what was committed`
    - Result:
      - fail

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Remove or strictly gate patch application in the normal commit path so a reviewed task is not re-applied onto the same dirty workspace
  - Limit commit staging to the reviewed task snapshot rather than `git add -A`
  - Reconnect branch control and branch persistence to the public `/commits` flow if branch-specific commits remain part of the Phase 14 contract
  - Add end-to-end tests for `createCommit()` with real `patchPath` and with unrelated workspace dirt present
- Deferred items:
  - Phase 15 product packaging and setup
