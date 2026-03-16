# Product Completion Roadmap

## 1. Purpose

This document defines the work that remains after the original Phase 0-10 roadmap.

Phase 0-10 established the local workbench baseline:

- monorepo, contracts, storage, event store, orchestrator, harness, AI engine, API, local UI, doctor, and hardening checks
- integration tests, selected Playwright e2e coverage, contract checks, and migration regression checks

That roadmap is now closed. The remaining work is product-completion work: replacing stubbed execution/integration layers with real implementations and finishing packaging, release, and operational readiness.

## 2. Current Gap Map

The main product gaps are:

- `apps/test-runner`
  real Playwright regression execution is not implemented
- `apps/trace-bridge`
  real trace-provider integration is not implemented
- `apps/log-bridge`
  real log-provider integration is not implemented
- `apps/review-manager`
  real review/apply/commit execution is not implemented
- `CodeTask` execution path
  `executeCodeTask()` currently advances status but does not invoke a real code agent session
- packaging / distribution
  install, init, workspace bootstrap, browser checks, and release workflow are documented but not finished as a product experience

## 3. Product Done Definition

The product should be considered complete only when this full loop runs against a real target workspace:

`regression run -> artifacts -> correlation context -> trace/log lookup -> AI analysis -> CodeTask approval -> controlled code change -> verify -> review -> explicit commit`

Minimum completion criteria:

- a real Playwright suite can be executed from `zarb`
- failed testcases produce real artifacts and correlation context
- trace/log summaries come from configured providers, not placeholders
- approved CodeTasks can run through a real code-agent path with diff/patch/verify outputs
- review acceptance does not auto-commit, but explicit commit can create a real git commit
- the CLI packaging/init flow is usable on a clean machine
- the full loop is protected by automated integration and e2e coverage

## 4. Phase 11: Real Test Execution

Goal:

- turn the current run flow into a real Playwright execution pipeline

Deliverables:

- implement `apps/test-runner`
- connect `RunService` / orchestrator to the runner instead of DB-only state setup
- execute Playwright against `workspace.targetProjectPath`
- persist real `test_results`, artifacts, network logs, and correlation context
- emit runner lifecycle events and timeout/degraded signals

Exit criteria:

- `startRun` can execute a real Playwright test selection
- artifacts are written under the documented storage layout
- failed testcases produce `failure-report` inputs without manual seeding
- runner startup failure is treated as blocking; testcase-level failures are not

## 5. Phase 12: Real Diagnostics Integration

Goal:

- replace diagnostics placeholders with real provider-backed trace/log fetching

Deliverables:

- implement `apps/trace-bridge`
- implement `apps/log-bridge`
- support at least one trace provider and one log provider
- generate and persist `trace-summary.json` and `log-summary.json`
- honor config updates for diagnostics/trace/log settings

Exit criteria:

- `GET /runs/:runId/testcases/:testcaseId/trace` returns real provider-derived data
- `GET /runs/:runId/testcases/:testcaseId/logs` returns real provider-derived data
- provider failures create degraded diagnostics records instead of breaking the run
- Failure Report UI shows real trace/log evidence for at least one end-to-end path

## 6. Phase 13: Real CodeTask Execution

Goal:

- make approved CodeTasks execute real controlled code modification sessions

Deliverables:

- wire `executeCodeTask()` to a real harness-driven execution path
- connect at least one real `CodeAgent` path, preferably `CodexCliAgent`
- persist harness session data, raw output, changed files, diff, patch, and verify outputs
- enforce workspace path, scope path, approval, and verify constraints during execution
- make retry/recovery semantics work with real sessions

Exit criteria:

- approving and executing a CodeTask starts a real harness/code-agent session
- `code_tasks` are updated from system-derived execution facts, not status-only placeholders
- verify results and diff/patch outputs reflect real workspace state
- failed verify stays reviewable only through the documented override path

## 7. Phase 14: Real Review And Commit Control

Goal:

- convert review/commit from audit records into real controlled workspace actions

Deliverables:

- implement `apps/review-manager`
- support reviewing the exact diff/patch snapshot tied to a task version
- support explicit patch/apply confirmation flow where needed
- create real git commits in the target workspace
- persist commit SHA, branch, failure reason, and audit records

Exit criteria:

- review accept still does not auto-commit
- explicit commit can create a real commit in the target workspace
- commit failures are surfaced and persisted without corrupting task history
- audit data is sufficient to reconstruct who approved, what changed, and what was committed

## 8. Phase 15: Product Packaging And Setup

Goal:

- make the tool installable and usable as a real local product

Deliverables:

- finish `zarb` init/bootstrap flow
- implement clean-machine dependency checks
- verify Playwright browser installation path
- verify git and code-agent CLI availability
- support first-run guided initialization and local workbench startup
- document supported install/update/uninstall paths

Exit criteria:

- a clean machine can install and initialize the product using the documented flow
- `zarb`, `zarb init`, `zarb doctor`, and local UI startup work without repo-only assumptions
- configuration/bootstrap failures have actionable diagnostics

## 9. Phase 16: Release Readiness

Goal:

- raise the workbench from engineering-complete to release-ready

Deliverables:

- cross-browser or browser-matrix validation for critical flows
- real target-workspace e2e for run -> diagnostics -> code task -> review -> commit
- long-running and restart/recovery checks
- security review for workspace writes, git actions, and external provider credentials
- release notes, operator docs, and support docs

Exit criteria:

- the full product loop passes against a representative external sample workspace
- restart/recovery behavior is verified for run and code-task flows
- security-sensitive actions are covered by tests and documented guardrails
- docs match the shipped product shape

## 10. Execution Order

Recommended order:

1. Phase 11
2. Phase 12
3. Phase 13
4. Phase 14
5. Phase 15
6. Phase 16

Parallelization notes:

- Phase 12 can start once Phase 11 has defined real correlation context outputs
- Phase 15 can partially progress in parallel with Phase 11-14
- Phase 16 should start only after Phases 11-15 are materially complete

## 11. Immediate Next Step

The highest-value next milestone is:

- implement `apps/test-runner`

Reason:

- it is the entry point for the whole product loop
- the current system cannot yet fulfill its primary promise of running a real Playwright regression workflow from the workbench
- downstream diagnostics, AI analysis, and repair flows are much easier to validate once real runner outputs exist
