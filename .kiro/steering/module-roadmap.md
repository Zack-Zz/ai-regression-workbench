---
inclusion: always
---

# Module Roadmap

Kiro should implement this repository in phases. Do not jump to later phases before the current phase has a coherent minimal slice.

## Phase 0: Workspace Bootstrap

Goal:

- initialize monorepo structure
- establish package boundaries
- wire basic toolchain

Deliverables:

- workspace config
- package manifests
- baseline TypeScript config
- lint / typecheck / test command skeletons

Exit criteria:

- repository installs successfully
- empty baseline typecheck passes
- package boundaries match design docs

## Phase 1: Shared Contracts and Config

Goal:

- define shared enums, DTOs, and interfaces
- implement config loading, normalization, and versioned snapshots

Deliverables:

- shared status enums
- Run / CodeTask / Review / Commit DTOs
- config manager
- settings snapshot model

Exit criteria:

- status names match design exactly
- exploration config merge follows documented precedence
- config validation and snapshot versioning are test-covered

## Phase 2: Storage and Migrations

Goal:

- establish SQLite schema and repository layer
- make file-path persistence rules explicit in code

Deliverables:

- migration scripts
- repository interfaces and persistence models
- artifact path helpers
- schema bootstrap / migration runner

Exit criteria:

- schema matches design and storage mapping
- migrations are repeatable
- relative path rules are enforced
- repository supports both read and write paths required by orchestrator and harness

## Phase 3: Event Store and Diagnostics Persistence

Goal:

- persist run events, system events, and testcase-level diagnostics records

Deliverables:

- run event writer / reader
- system event writer
- api call / ui action / flow step persistence
- execution profile precompute path

Exit criteria:

- event pagination works with cursor + limit
- testcase execution profile can be materialized to file
- degraded/failure events are queryable

## Phase 4: Orchestrator Core

Goal:

- implement Run lifecycle and CodeTask lifecycle coordination

Deliverables:

- Run state transitions
- pause / resume / cancel handling
- timeout policy
- multi-CodeTask aggregation rules

Exit criteria:

- state machine behavior matches design
- `timeout_at` is written and checked correctly
- retry creates child CodeTask instead of mutating history

## Phase 5: Agent Harness

Goal:

- implement session runtime, policy enforcement, checkpointing, and artifact capture

Deliverables:

- Harness session manager
- tool registry
- approval boundaries
- contextRefs persistence
- diff / patch / verify truth generation

Exit criteria:

- Harness owns runtime concerns, not business state transitions
- session traces and context summaries are persisted
- diff / patch / verify outputs are system-derived

## Phase 6: AI Engine and Draft Generation

Goal:

- implement failure analysis, finding summaries, generated test drafts, and CodeTask drafts

Deliverables:

- analysis interfaces
- prompt/template loading
- context trimming
- draft generators

Exit criteria:

- AI output stays within draft / pending approval boundaries
- findings remain exploration-only
- generated test draft lifecycle matches design

## Phase 7: API Layer

Goal:

- expose HTTP endpoints matching app services and API contract

Deliverables:

- run endpoints
- diagnostics endpoints
- code task / review / commit endpoints
- settings endpoints

Exit criteria:

- endpoint paths and DTOs match contract docs
- testcase diagnostics endpoints are complete
- error codes are stable and documented

## Phase 8: Local UI and Preview Alignment

Goal:

- implement the Web UI using the documented workflows and keep previews aligned

Deliverables:

- quick run panel
- run list / detail
- failure report
- code task detail
- review / commit
- settings

Exit criteria:

- UI behavior matches local-ui design
- preview HTML is updated for visible workflow changes
- runMode, selectorType, findings embedding, review versioning, and settings restart semantics are visible

## Phase 9: Observability and Doctor

Goal:

- add optional observability wrappers and operational diagnostics

Deliverables:

- ObservedHarness integration point
- doctor command checks
- migration health checks
- environment / secret diagnostics

Exit criteria:

- observability remains optional
- doctor checks schema version consistency, not just pending migrations

## Phase 10: Hardening

Goal:

- verify behavior under realistic flows and lock down regressions

Deliverables:

- integration tests
- selected e2e coverage
- contract consistency checks
- migration regression checks

Exit criteria:

- critical flows are covered
- no contract drift between design, API, storage, and preview layers

## Global rules

- Prefer finishing the current phase cleanly over partially touching multiple later phases.
- If a phase requires a design change, update the authoritative docs first.
- Do not skip storage, contract, or preview propagation when the phase changes visible or persisted behavior.
- Keep repository layout consistent: production code under `src/`, tests under `test/`, and avoid colocated `*.test.*` files inside `src/`.
