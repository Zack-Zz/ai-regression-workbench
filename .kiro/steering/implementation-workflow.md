---
inclusion: always
---

# Implementation Workflow

Kiro must follow this workflow when implementing features in this repository.

## 1. Read first

Before coding:

- Identify the primary design docs for the task.
- Summarize the exact constraints that apply.
- Identify affected modules and files.

## 2. Stay inside scope

- Prefer the smallest implementation that satisfies the design.
- Do not expand into unrelated refactors.
- Do not “improve” architecture beyond the documented phase unless explicitly requested.
- Keep production code under `src/` and tests under `test/`; do not add new colocated tests inside `src/`.

## 3. Design-first rule

- If implementation reveals a design gap, update the design docs first.
- Only then implement code against the updated design.

## 4. Implementation order

Prefer this order when relevant:

1. shared types / interfaces
2. config and normalization
3. storage and migrations
4. repository methods
5. orchestrator / harness logic
6. API surface
7. UI / preview synchronization
8. tests and verification

## 5. Required self-check before finishing

Kiro must verify:

- type / build checks for touched modules
- tests for touched behavior
- source and test directories remain isolated (`src/` vs `test/`)
- DTO and API contract consistency
- persistence field and migration consistency
- state machine and workflow consistency
- `docs/ui-preview/` synchronization for user-visible changes

## 6. Stop conditions

Stop and report instead of guessing when:

- two authoritative docs conflict
- a migration is needed but schema intent is unclear
- a status/state name appears to require redefinition
- a change would introduce an undocumented API shape
- a field meaning is ambiguous across DTO / storage / UI

## 7. Final reporting

When done, report:

- which authoritative docs were followed
- what was implemented
- what validations were run
- any residual risk or remaining design gap
