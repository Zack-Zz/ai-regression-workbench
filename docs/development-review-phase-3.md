# Development Review

## 1. Metadata

- Review target: Phase 3
- Review date: 2026-03-14
- Reviewer: Codex
- Scope: event store, system events, testcase-level diagnostics persistence, execution profile precompute
- Related phase: Phase 3
- Related previous reviews:
  - `docs/development-review-phase-2-recheck-2.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - Phase 3 的主干功能已经落地，`pnpm test / typecheck / build` 全部通过。
  - 但当前仍有 1 个真实功能缺陷和 1 个结构约束违例，暂不建议把 Phase 3 视为完全收口。

## 3. Scope

- Reviewed modules:
  - `packages/event-store`
  - `packages/storage/src/repos/run-event-repo.ts`
  - `packages/storage/src/repos/system-event-repo.ts`
  - `packages/storage/src/repos/api-call-repo.ts`
  - `packages/storage/src/repos/ui-action-repo.ts`
  - `packages/storage/src/repos/flow-step-repo.ts`
  - `packages/storage/src/repos/run-repo.ts`
- Reviewed docs/contracts:
  - `docs/design.md`
  - `docs/storage-mapping-design.md`
  - `.kiro/steering/module-roadmap.md`
  - `.kiro/steering/architecture-constraints.md`
  - `docs/development-review-checklist.md`
- Explicitly out of scope:
  - Orchestrator business state transitions
  - Harness runtime
  - API layer
  - UI

## 4. Findings

### High

- Run event cursor pagination can skip valid events when `id` order and `created_at` order diverge
  - Evidence:
    - `RunEventRepository.list()` sorts by `created_at ASC, id ASC` but, when a cursor is present, filters with `id > ?` instead of using the same sort key.
    - A minimal reproduction with event ids `z` at `t0` and `a` at `t1` returns page 1 = `z`, page 2 = empty, so event `a` is skipped.
  - Impact:
    - Phase 3 exit criterion “event pagination works with cursor + limit” is not actually satisfied.
    - Timeline pages can silently lose events in real runs whenever UUID/order does not match timestamp order.
  - Suggested fix:
    - Use a cursor derived from the actual ordering key, for example `(created_at, id)`, and apply the same tuple ordering in the next-page predicate.
    - Add a regression test where ids are intentionally out of lexical order relative to timestamps.

### Medium

- Source and test directories are still not isolated
  - Evidence:
    - Tests still live under `src/`, for example:
      - `packages/event-store/src/event-store.test.ts`
      - `packages/storage/src/storage.test.ts`
      - `packages/config/src/loader.test.ts`
      - `packages/config/src/config-manager.test.ts`
    - `vitest.config.ts` still discovers tests from `packages/*/src/**/*.test.ts` and `apps/*/src/**/*.test.ts`.
  - Impact:
    - This violates the current repository constraint that production code must live under `src/` and tests under `test/`.
    - It will keep causing future reviews to fail the layout gate even when functionality is correct.
  - Suggested fix:
    - Move tests into `test/` directories at package/app level.
    - Update `vitest.config.ts` and any relevant tsconfig include/exclude rules to match the new layout.

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Manual reproduction of run event pagination with intentionally inverted `id`/timestamp ordering
  - Scan for colocated tests under `src/`
- Result summary:
  - `pnpm -r typecheck`: pass
  - `pnpm build`: pass
  - `pnpm test`: pass
  - Additional manual pagination check: failed

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion: event pagination works with cursor + limit
    - Result: fail
    - Notes: current cursor predicate uses `id > ?` while ordering uses `created_at, id`
  - Criterion: testcase execution profile can be materialized to file
    - Result: pass
    - Notes: builder writes `diagnostics/<runId>/<testcaseId>/execution-profile.json` and tests cover build + read
  - Criterion: degraded/failure events are queryable
    - Result: pass with notes
    - Notes: records are persisted and retrievable through event readers, but pagination bug must be fixed first
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: no
  - Any colocated tests under `src/`: yes
  - If yes, explain:
    - `packages/config`, `packages/storage`, and `packages/event-store` still keep tests under `src/`

## 7. Follow-ups / Notes

- Required follow-up actions:
  - Fix run event cursor pagination to use a cursor consistent with the sort key
  - Move tests out of `src/` into `test/`
  - Update test discovery config after the move
- Deferred items:
  - None
- Risks carried into next phase:
  - If pagination bug remains, any event timeline UI/API built in later phases may silently drop events
  - If test layout stays mixed, repository governance will keep drifting from the documented rule
