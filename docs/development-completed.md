# Development Completed — Phase 0–14

All phases below have passed final review and are considered complete.

## Phase 0 — Workspace Bootstrap

- Monorepo structure initialized with pnpm workspaces
- Package boundaries established (`apps/`, `packages/`)
- TypeScript config, ESLint flat config, Vitest config wired
- Baseline commands (`typecheck`, `lint`, `build`, `test`) all pass

## Phase 1 — Shared Contracts and Config

- Shared enums: `RunStatus`, `CodeTaskStatus`, `AutomationLevel`, `CodeTaskMode`, terminal status sets
- Run / CodeTask / Review / Commit DTOs defined in `packages/shared-types`
- `ConfigManager` with `getSettings`, `validateSettings`, `updateSettings`, snapshot versioning, observer broadcast
- Deep-isolated default config (no shared-reference mutation)

## Phase 2 — Storage and Migrations

- SQLite schema and migration runner (`packages/storage`)
- Repositories: `RunRepository`, `CodeTaskRepository`, `ReviewRepository`, `CommitRepository`, and supporting repos
- Artifact path helpers with path-traversal protection (rejects `..`, absolute paths, empty segments)
- Schema fields aligned to design: `test_runs`, `code_tasks`, `reviews` all match DTO contracts

## Phase 3 — Event Store and Diagnostics Persistence

- Run event writer/reader with correct `(created_at, id)` cursor pagination
- System event writer, API call / UI action / flow step persistence
- Testcase execution profile materialized to `diagnostics/<runId>/<testcaseId>/execution-profile.json`
- Source/test directories isolated (`src/` vs `test/`)

## Phase 4 — Orchestrator Core

- Run state machine: `PENDING → RUNNING_TESTS → ANALYZING_FAILURES → AWAITING_CODE_ACTION → … → COMPLETED`
- `pause` uses safe-point model (`pauseRequested` flag, not immediate status flip)
- `CodeTask.timeout_at` written and checked independently per task stage (`RUNNING`, `VERIFYING`)
- Multi-CodeTask aggregation: `recomputeRunStatusFromCodeTasks()` called after every task transition
- Retry creates child `CodeTask` with incremented `attempt`, preserves history

## Phase 5 — Agent Harness

- `HarnessSessionManager` with full policy enforcement: `sessionBudgetMs`, `allowedHosts`, `allowedWriteScopes`, `stopConditions`, `toolCallTimeoutMs`
- Approval persistence: `waiting-approval → running` lifecycle, tool call / approval records persisted
- Diff/patch/verify are system-derived from workspace git state, written back to `code_tasks`
- Session traces, context summaries, tool-call logs persisted to disk

## Phase 6 — AI Engine and Draft Generation

- Prompt templates externalized to `prompts/` directory with version parsing
- `FailureAnalysis` persisted with `prompt_template_version` for replay traceability
- `CodeTaskDraft` persisted to DB before returning (aligned with `GeneratedTestDraft`)
- Context trimmer with configurable token budget

## Phase 7 — API Layer

- All documented endpoints implemented: runs, testcase diagnostics (`execution-profile`, `trace`, `logs`), `execution-report`, code-task CRUD + `retry`
- `startRun` normalizes `selector`, `runMode`, `hybrid` validation, persists merged exploration config
- `listRuns` filters by `runMode`
- Review retry creates new `CodeTask` attempt with `parentTaskId` (does not mutate history)
- `SettingsService` backed by `ConfigManager` (persistent versioning, `expectedVersion` concurrency guard)
- Error codes: `400/404/409/422/500` with stable `errorCode` strings

## Phase 8 — Local UI and Preview Alignment

- `QuickRunPanel`: `runMode`, `selectorType`, `focusAreas`, workspace/shared-assets preflight context
- `SettingsPage`: all config groups (`Storage`, `Workspace`, `Test Assets`, `Diagnostics`, `Trace/Logs`, `AI/CodeAgent`, `Report/UI`), displays `reloadedModules` / `nextRunOnlyKeys` / `requiresRestart`
- `FailureReportPage`: trace and log summary cards rendered
- Review/commit workflow: `expectedTaskVersion` and verify-override risk warning visible
- `local-ui` included in root build; UI smoke tests added

## Phase 9 — Observability and Doctor

- `ObservedHarness` wired into production assembly path (optional, safe degradation)
- `zarb doctor` CLI command with exit code
- `DoctorService` checks both missing expected migrations and unexpected extra migrations
- HTTP `GET /doctor` endpoint

## Phase 10 — Hardening

- Integration tests covering all documented API routes with response-shape and error-code assertions
- Playwright e2e tests: `Quick Run → Run Detail`, `CodeTask Review/Commit`, `Settings save/reload`
- Migration regression: `scripts/sql` directory compared against `_migrations` records; key columns/indexes asserted
- Preview drift smoke test against `docs/ui-preview`

## Phase 11 — Real Test Execution

- `TestRunner` spawns real Playwright process non-blocking; run completes asynchronously
- `testcaseId` / `scenarioId` selectors resolve via asset index before invoking Playwright; anchored exact-match `--grep` patterns (no substring over-selection)
- `scenarioId` resolves to full testcase set (not just first match)
- Artifacts persisted: `networkLogPath`, HAR-based correlation, testcase metadata from annotations
- Run control: `cancel` terminates background process; `pause`/`resume` honor safe-point model; terminal states reject control actions; `RUN_NOT_PAUSED` returns `409`

## Phase 12 — Real Diagnostics Integration

- `JaegerTraceProvider` and `LokiLogProvider` wired into `DiagnosticsService.fetchDiagnostics()`
- On-demand fetch triggered by diagnostics endpoints
- `trace-summary.json` and `log-summary.json` persisted under `diagnostics/<runId>/<testcaseId>/`
- Config observer refreshes providers on settings update (no restart required)
- Loki query: per-field label-selector queries (OR semantics), configurable `correlationKeys.logFields`, results deduplicated

## Phase 13 — Real CodeTask Execution Chain

- `executeCodeTask()` returns immediately; agent session runs asynchronously
- State machine: `APPROVED → RUNNING → VERIFYING → SUCCEEDED/FAILED`; `SUCCEEDED` awaits human review before `COMMIT_PENDING`
- Non-zero / timeout `CodexCliAgent` exit treated as execution failure
- `raw-output.txt` preserved separately from `verify.txt`; `verifyOutputPath` exposed in `CodeTaskDetail`
- `changedFiles` populated from workspace-derived git state (includes untracked new files, non-destructive index capture)
- `submitReview`: enforces `codeTaskVersion` match; normal review restricted to `SUCCEEDED`; override requires `forceReviewOnVerifyFailure=true` and verify-failure evidence (diff/patch present)

## Phase 14 — Real Review and Commit Control

- `CommitManager` no longer re-applies patch (workspace already contains changes)
- Commit staging limited to task-scoped `changedFiles` (not `git add -A`)
- `branchName` accepted in `CreateCommitInput`, forwarded by `CodeTaskService`, persisted by `CommitRepository`
- Commit failures surfaced and persisted without corrupting task history
- Audit data sufficient to reconstruct approver, changed files, and committed branch
