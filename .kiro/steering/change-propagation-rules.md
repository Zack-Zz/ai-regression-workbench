---
inclusion: always
---

# Change Propagation Rules

Kiro must not change one layer and leave related layers stale.

## Persistence field changes

If you change a persisted field, you must review and update all affected layers:

- `docs/design.md`
- `docs/storage-mapping-design.md`
- migration SQL / schema scripts
- repository interfaces and persistence models
- API/DTO contracts if exposed externally

Examples:

- `attempt`
- `context_refs_json`
- `timeout_at`
- `report_path`

## API / DTO changes

If you change request or response shapes, you must review and update:

- `docs/api-contract-design.md`
- `docs/app-services-design.md`
- relevant UI docs
- related preview HTML pages under `docs/ui-preview/`

Examples:

- `RunDetail`
- `ExecutionReport`
- `SubmitReviewInput`
- diagnostics endpoints

## State machine changes

If you change state transitions or status semantics, you must review and update:

- `docs/design.md`
- `docs/orchestrator-design.md`
- `docs/code-task-design.md`
- any UI preview or UI documentation that displays those states

## UI changes

If you change user-visible fields, controls, or workflow semantics, you must review and update:

- `docs/local-ui-design.md`
- `docs/ui-preview/*.html`
- `docs/ui-preview/*.en.html`

## Source / test layout changes

If you add, move, or rename tests, you must keep source and test directories isolated and review/update:

- package/app directory layout (`src/` for production code, `test/` for tests)
- test runner globs such as `vitest.config.ts`
- package scripts or tsconfig includes/excludes that depend on test locations

## Required behavior

- Do not leave docs half-updated.
- Do not add temporary alias fields without explicit design approval.
- If a change affects multiple layers and you cannot update all of them safely, stop and report the gap.
