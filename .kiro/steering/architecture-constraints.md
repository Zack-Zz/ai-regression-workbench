---
inclusion: always
---

# Architecture Constraints

Kiro must preserve the designed module boundaries.

## Core boundaries

- `Orchestrator`
  Owns business state transitions for Run, CodeTask, Review, and Commit.
- `AgentHarness`
  Owns agent runtime concerns: context assembly, tools, policy, approvals, checkpoint, replay, trace.
- `AIEngine`
  Owns analysis and draft generation only. It does not directly run tools or modify code.
- `CodeAgent`
  Owns plan/apply/verify behavior inside Harness control.

## Non-negotiable semantics

- Do not rename or redefine `RunStatus` values without updating design first.
- Do not rename or redefine `CodeTaskStatus` values without updating design first.
- `taskVersion` is API/DTO language for persisted `attempt`.
- `ExecutionReport` full content is stored as JSON file; SQLite stores index metadata only.
- `findings` are embedded in `RunDetail` in phase one; do not introduce a required standalone findings API.
- `Scenario` has no standalone management UI in phase one.
- `changedFiles`, `diffPath`, `patchPath`, and verify truth must come from Harness/system-calculated results, not agent self-reporting.

## Exploration constraints

- `ExplorationAgent.explore()` is a session-level entrypoint.
- Harness still drives the actual step loop, tool calls, checkpointing, and budget enforcement.
- `hybrid` must execute regression first, then exploration planning/exploration.

## Persistence constraints

- Relative paths only for persisted file references under tool workspace data roots.
- Schema changes must go through migration scripts, not ad hoc edits.
- `ExecutionReportBuilder` aggregates run-level summaries from lower-level records at run termination.

## Source and test layout constraints

- Production source files must live under `src/`.
- Test files must live under `test/`; do not place `*.test.*` or `*.spec.*` files under `src/`.
- Keep source and test directories isolated at package/app level, for example:
  - `packages/foo/src/...`
  - `packages/foo/test/...`
- If an existing module still has colocated tests under `src/`, migrate them when touching that area unless the task explicitly defers the move.
