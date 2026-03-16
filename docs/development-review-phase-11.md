# Development Review Phase 11

## 1. Metadata

- Review target: Phase 11 Real Test Execution
- Review date: 2026-03-16
- Reviewer: Codex
- Scope: `apps/test-runner`, `apps/cli` runner integration, Phase 11 execution-path review
- Related phase: Phase 11
- Related previous reviews:
  - [development-review-phase-10-recheck-4.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10-recheck-4.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phase 11 has moved beyond the stub stage and introduced a real Playwright runner entrypoint, but the current implementation does not yet satisfy the product contract for real execution. The main problems are: the API process is blocked during execution, selector semantics do not match the design, testcase identity is not derived from stable test metadata, and the branch currently fails `pnpm lint`.

## 3. Scope

- Reviewed modules:
  - [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts)
  - [apps/test-runner/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/package.json)
  - [apps/test-runner/tsconfig.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/tsconfig.json)
  - [apps/cli/src/services/run-service.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts)
  - [apps/cli/src/server.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/server.ts)
  - [apps/cli/package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/package.json)
- Reviewed docs/contracts:
  - [docs/product-completion-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/product-completion-roadmap.md)
  - [docs/design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md)
  - [docs/test-assets-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md)
  - [docs/storage-mapping-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/storage-mapping-design.md)
- Explicitly out of scope:
  - Phase 12 trace/log provider implementation
  - Phase 13 code-agent execution path
  - packaging / release flow

## 4. Findings

### High

- Real Playwright execution currently blocks the entire API process
  - Evidence:
    - `startRun()` schedules execution with `setImmediate`, but still calls synchronous `spawnSync(...)`, so the server event loop remains blocked for the full Playwright runtime, see [apps/cli/src/services/run-service.ts#L121](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L121) and [apps/test-runner/src/index.ts#L140](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L140).
    - This breaks the expected workbench behavior where the UI can continue polling run status and users can still inspect or control the system while a run is in progress.
  - Impact:
    - During any non-trivial test run, `/runs`, `/runs/:id`, local UI polling, and pause/cancel style operations will stall until the child process exits. That turns the local workbench into a stop-the-world execution model instead of a responsive controller.
  - Suggested fix:
    - Move the runner to a non-blocking process model (`spawn` / worker / job queue) and persist intermediate status updates asynchronously.

- `suite` selector is mapped to Playwright `--project`, which does not match the documented selector semantics
  - Evidence:
    - The runner maps `selector.suite` to `--project`, see [apps/test-runner/src/index.ts#L134](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L134).
    - The design says `suite | scenario | tag | testcase` is a test-asset selector that should first resolve to testcase(s) and then be converted into Playwright filtering, see [docs/test-assets-design.md#L195](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L195) and [docs/design.md#L1095](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L1095).
  - Impact:
    - Runs selected by `suite` will target the wrong execution scope whenever the suite name is not literally a Playwright project name. This makes the Phase 11 runner incompatible with the API/UI contract already used by the rest of the product.
  - Suggested fix:
    - Introduce the missing asset-selection layer and translate `suite/scenario/tag/testcase` into concrete Playwright filters based on indexed testcase metadata rather than directly overloading Playwright CLI flags.

- Testcase identity is synthesized from rendered titles instead of stable `testcaseId` / `scenarioId`
  - Evidence:
    - The runner derives testcase keys with `sanitizeId(fullTitle)`, see [apps/test-runner/src/index.ts#L183](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L183) and [apps/test-runner/src/index.ts#L340](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L340).
    - The design requires each test to bind stable `scenarioId / testcaseId`, see [docs/design.md#L2552](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L2552) and [docs/test-assets-design.md#L167](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/test-assets-design.md#L167).
    - `scenarioId` is never persisted into `test_results`, even though downstream APIs and storage mappings expect it, see [docs/storage-mapping-design.md#L46](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/storage-mapping-design.md#L46).
  - Impact:
    - A testcase title change will change its identity, break testcase-scoped diagnostics lookup, and make `scenarioId`-level reasoning unavailable to downstream diagnostics/analysis flows.
  - Suggested fix:
    - Read stable testcase metadata from the test asset/index layer and persist both `testcaseId` and `scenarioId` from that source instead of deriving IDs from display titles.

### Medium

- Skipped tests are emitted as `TESTCASE_FAILED` events
  - Evidence:
    - The event emission branch only distinguishes `passed` from “everything else”, see [apps/test-runner/src/index.ts#L235](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L235).
    - `normalizeStatus()` does classify skipped tests correctly for storage, but events still misreport them, see [apps/test-runner/src/index.ts#L334](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L334).
  - Impact:
    - Run timelines and any event-driven consumer will over-report failures and create false failure signals for skipped testcases.
  - Suggested fix:
    - Add a separate skip branch in event generation, or explicitly avoid emitting failure events for skipped cases until a dedicated skipped event type is introduced.

- Network log persistence is not actually wired into the documented storage contract
  - Evidence:
    - The runner copies attachments and then heuristically scans for `.har` / `network` files, see [apps/test-runner/src/index.ts#L204](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L204) and [apps/test-runner/src/index.ts#L349](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts#L349).
    - It never writes `networkLogPath` back to `test_results`, although the storage contract explicitly includes network artifacts under testcase storage, see [docs/storage-mapping-design.md#L46](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/storage-mapping-design.md#L46).
  - Impact:
    - Correlation-context extraction is dependent on incidental attachment shape, and other consumers have no stable persisted `network_log_path` to follow.
  - Suggested fix:
    - Treat network log capture as a first-class artifact: persist it explicitly, store `networkLogPath`, and make correlation extraction depend on that persisted path rather than directory scanning.

- Phase 11 currently fails the repository lint gate
  - Evidence:
    - `pnpm lint` fails with 9 errors in [apps/test-runner/src/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/test-runner/src/index.ts), including unused imports and `@typescript-eslint/no-unnecessary-condition` / `@typescript-eslint/no-non-null-assertion` violations.
  - Impact:
    - The branch is not in a shippable state and cannot satisfy the project’s baseline verification requirement.
  - Suggested fix:
    - Clear the lint violations first, then rerun the baseline commands before asking for a closure review.

## 5. Validation

- Commands run:
  - `pnpm lint`
- Additional checks:
  - Read the Phase 11 runner integration diff
  - Cross-checked selector / testcase identity semantics against design docs
  - Cross-checked artifact / correlation persistence against storage mapping docs
- Result summary:
  - `pnpm lint` failed
  - Static review found 3 High and 3 Medium issues
  - `typecheck` / `build` / `test` were not re-run as part of this review

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `startRun can execute a real Playwright test selection`
    - Result:
      - fail
    - Notes:
      - The runner can invoke Playwright, but `suite` selection semantics are incorrect and the API process is blocked during execution.
  - Criterion:
    - `artifacts are written under the documented storage layout`
    - Result:
      - pass with notes
    - Notes:
      - screenshot/video/trace copy logic exists, but network-log persistence is still incomplete.
  - Criterion:
    - `failed testcases produce failure-report inputs without manual seeding`
    - Result:
      - pass with notes
    - Notes:
      - basic testcase result persistence exists, but testcase identity is unstable and `scenarioId` is missing.
  - Criterion:
    - `runner startup failure is treated as blocking; testcase-level failures are not`
    - Result:
      - pass with notes
    - Notes:
      - startup failures are treated as blocking, but skipped testcase events are currently misreported as failures.
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: no
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - `apps/test-runner` still has no dedicated `test/` directory or runner-specific tests in this phase.

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Make Phase 11 execution non-blocking for the API/UI process
  - Introduce the missing testcase asset-selection / identity layer for `suite/scenario/tag/testcase`
  - Persist stable `testcaseId` / `scenarioId` and explicit `networkLogPath`
  - Add dedicated tests for `apps/test-runner` and the `RunService` runner integration path
  - Re-run baseline verification and close the current lint failures
- Deferred items:
  - Phase 12 real trace/log provider integration
  - richer execution-profile population beyond Phase 11 minimum slice
- Risks carried into next phase:
  - If merged as-is, the workbench will appear to “run real tests” but will do so with blocking server behavior and unstable testcase identity, which will amplify downstream diagnostics and UI inconsistencies.
