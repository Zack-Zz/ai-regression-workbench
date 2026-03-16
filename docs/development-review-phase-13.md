# Development Review Phase 13

## 1. Metadata

- Review target: Phase 13 Real CodeTask Execution Chain
- Review date: 2026-03-16
- Reviewer: Codex
- Scope:
  - [apps/cli/src/services/code-task-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts)
  - [apps/cli/src/handlers/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
  - [packages/agent-harness/src/artifact-writer.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts)
  - [packages/agent-harness/src/codex-cli-agent.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/codex-cli-agent.ts)
  - [packages/agent-harness/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/index.ts)
- Related previous reviews:
  - [development-review-phase-12-recheck-5.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-12-recheck-5.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phase 13 now wires `executeCodeTask()` into a real harness/code-agent path, but the resulting behavior still violates the documented CodeTask state machine and API contract. The execution endpoint blocks until the full agent run finishes, successful execution skips the required `SUCCEEDED -> review -> COMMIT_PENDING` gate, and required execution artifacts are not persisted/exposed in the documented shape.

## 3. Findings

### High

- Successful execution skips `VERIFYING -> SUCCEEDED -> review` and jumps straight to `COMMIT_PENDING`
  - Evidence:
    - `executeCodeTask()` moves `APPROVED -> RUNNING`, runs the agent, then sets `finalStatus = artifacts.verifyPassed ? 'COMMIT_PENDING' : 'FAILED'`, with no `VERIFYING` or `SUCCEEDED` stage at all, see [code-task-service.ts#L119](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L119) and [code-task-service.ts#L154](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L154).
    - The design explicitly requires `RUNNING -> VERIFYING -> SUCCEEDED / FAILED -> Review Action -> COMMIT_PENDING`, and says `SUCCEEDED` still awaits human review, see [code-task-design.md#L24](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/code-task-design.md#L24) and [code-task-design.md#L43](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/code-task-design.md#L43).
    - The current integration flow still has to manually patch the DB row to `SUCCEEDED` before review can proceed, which confirms the real execute path does not produce the documented reviewable state, see [integration.test.ts#L197](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L197).
  - Impact:
    - A task can appear ready to commit before any human review happened.
    - The Phase 13 execution chain breaks the separation between execution and review, and it also leaves the documented `SUCCEEDED` state effectively unreachable from the real path.

- `POST /code-tasks/:taskId/execute` is implemented as a long-running synchronous request instead of an immediate-return action
  - Evidence:
    - The router now `await`s the full `taskSvc.executeCodeTask(...)` call before responding, see [index.ts#L167](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L167).
    - `executeCodeTask()` itself awaits the full agent run and artifact generation before returning, see [code-task-service.ts#L137](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L137) and [code-task-service.ts#L162](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L162).
    - The app-service contract says these actions should return immediately and let the state machine continue asynchronously, see [app-services-design.md#L831](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L831).
  - Impact:
    - UI/API callers now sit on an open HTTP request for the full `codex exec + verify` duration, which is the opposite of the documented control flow.
    - Long-running repairs are exposed to request timeout and retry hazards, and the local UI cannot treat execution as a queued background action.

- Agent failure or timeout can still be reported as success because `exitCode` is ignored
  - Evidence:
    - `CodexCliAgent.run()` returns an `exitCode`, including `124` on timeout, see [codex-cli-agent.ts#L10](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/codex-cli-agent.ts#L10) and [codex-cli-agent.ts#L33](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/codex-cli-agent.ts#L33).
    - `executeCodeTask()` discards that `exitCode` entirely and bases the final task status only on `artifacts.verifyPassed`, see [code-task-service.ts#L138](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L138) and [code-task-service.ts#L154](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L154).
  - Impact:
    - If `codex exec` fails or times out but verification commands are empty or still happen to pass, the task can be marked successful.
    - This violates the Phase 13 goal that `code_tasks` reflect real system-derived execution facts rather than status-only placeholders.

- Required execution artifacts are persisted incorrectly: `raw-output.txt` is overwritten with verify output, and `verifyOutputPath` is never surfaced
  - Evidence:
    - `executeCodeTask()` first writes the agent raw output via `writeRawOutput(...)`, see [code-task-service.ts#L143](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L143).
    - `ArtifactWriter.generateArtifacts()` then writes `verifyOutput` to both `verify.txt` and `raw-output.txt`, overwriting the original raw agent output, see [artifact-writer.ts#L66](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L66) and [artifact-writer.ts#L67](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/src/artifact-writer.ts#L67).
    - The DTO contract includes `verifyOutputPath`, but `CodeTaskDetail` assembly never returns it, and the storage row/update model has no field for it, see [dtos.ts#L160](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/dtos.ts#L160), [code-task-service.ts#L60](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L60), and [code-task-repo.ts#L54](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/storage/src/repos/code-task-repo.ts#L54).
  - Impact:
    - Review/audit consumers cannot inspect the true agent transcript anymore because it gets clobbered by verify output.
    - The documented artifact set for Phase 13 is incomplete from the API point of view even though the file may exist on disk.

### Medium

- The current tests do not lock down the real Phase 13 execution semantics
  - Evidence:
    - The integration flow still manually updates the task to `SUCCEEDED` instead of asserting the real `execute` path lands in the documented post-verify state, see [integration.test.ts#L197](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L197).
    - The `ArtifactWriter` test checks diff/patch generation, but there is no test that protects raw output from being overwritten or that requires `verifyOutputPath` to be surfaced in task detail, see [agent-harness.test.ts#L275](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/agent-harness/test/agent-harness.test.ts#L275).
  - Impact:
    - The suite stays green while the real execution path still violates the state machine and artifact contract.

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
      - fail
    - Notes:
      - `exitCode` is ignored and the real state machine is collapsed into `RUNNING -> COMMIT_PENDING/FAILED`.
  - Criterion:
    - `verify results and diff/patch outputs reflect real workspace state`
    - Result:
      - partial
    - Notes:
      - diff/patch are generated from workspace state, but raw output and verify artifact handling are still wrong.
  - Criterion:
    - `failed verify stays reviewable only through the documented override path`
    - Result:
      - fail
    - Notes:
      - the success path skips the required human review gate entirely.

## 6. Follow-ups / Notes

- Required follow-up actions:
  - Restore the documented execution state machine: `RUNNING -> VERIFYING -> SUCCEEDED/FAILED`, then let review move `SUCCEEDED -> COMMIT_PENDING`
  - Make `executeCodeTask` return immediately and run the long-lived code-agent session asynchronously
  - Treat non-zero / timeout `CodexCliAgent` exits as execution failure inputs, not ignorable metadata
  - Preserve `raw-output.txt`, persist `verifyOutputPath`, and expose it from `CodeTaskDetail`
