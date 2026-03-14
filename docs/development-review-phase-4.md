# Development Review Phase 4

## 1. Metadata

- Review target: Phase 4 Orchestrator Core
- Review date: 2026-03-14
- Reviewer: Codex
- Scope: `apps/orchestrator` state machine, timeout policy, CodeTask coordination, Phase 4 exit criteria
- Related phase: Phase 4
- Related previous reviews:
  - `development-review-phase-3.md`
  - `development-review-phase-3-recheck-1.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 基线命令通过，但 Phase 4 仍有 3 个未闭环的实现缺口：`pause` 没按安全点模型落地、`CodeTask timeout_at` 没按设计写入与检查、Run 缺少多 CodeTask 聚合逻辑。

## 3. Scope

- Reviewed modules:
  - `apps/orchestrator/src/orchestrator.ts`
  - `apps/orchestrator/src/run-transitions.ts`
  - `apps/orchestrator/src/timeout-policy.ts`
  - `apps/orchestrator/test/orchestrator.test.ts`
- Reviewed docs/contracts:
  - `docs/design.md`
  - `docs/orchestrator-design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 5 Agent Harness implementation
  - HTTP/API integration
  - UI wiring

## 4. Findings

### High

- `pauseRun()` 直接把 Run 切到 `PAUSED`，没有遵守“安全点暂停”语义
  - Evidence:
    - 设计要求 `pause` 在当前稳定步骤结束后才落到 `PAUSED`，见 `docs/orchestrator-design.md:82-84` 与 `docs/design.md:793-797,917-930`
    - 实现里 `pauseRun()` 先写 `pauseRequested`，随后立刻把 `status` 改成 `PAUSED`，见 `apps/orchestrator/src/orchestrator.ts:113-124`
  - Impact:
    - `pause requested` 和 `actually paused at safe point` 被混成同一个状态，后续 Harness/Test Runner 接入后会造成 UI、恢复逻辑和事件语义不一致。
  - Suggested fix:
    - `pauseRun()` 只落 `pauseRequested=true`
    - 由状态推进或子步骤完成点检测 `pauseRequested`，在安全点再进入 `PAUSED` 并记录 `pausedAt/currentStage/checkpoint`

- `CodeTask` 没有独立写入和检查 `timeout_at`，不满足 Phase 4 exit criteria
  - Evidence:
    - Phase 4 exit criteria 要求 ``timeout_at`` “written and checked correctly”，见 `.kiro/steering/module-roadmap.md:103-107`
    - 设计要求 Run/CodeTask 进入带预算的活跃阶段时都要写入下一次超时截止时间，见 `docs/orchestrator-design.md:133-137`
    - `TimeoutPolicy` 已定义 `RUNNING` / `VERIFYING` 两类 CodeTask 超时预算，见 `apps/orchestrator/src/timeout-policy.ts:28-33`
    - 当前实现只在 Run 状态推进时通过 `toTimeoutStage()` 写 `timeoutAt`，映射里没有 CodeTask 阶段，见 `apps/orchestrator/src/orchestrator.ts:98-100,287-295`
    - `checkCodeTaskTimeout()` 直接复用父 Run 的 `timeout_at`，并在注释里承认 “for now”，见 `apps/orchestrator/src/orchestrator.ts:239-245`
  - Impact:
    - `RUNNING` / `VERIFYING` 的 CodeTask 无法拿到独立 deadline；verify 超时和 harness session 超时都会被错误地绑定到父 Run 的时钟上。
  - Suggested fix:
    - 为 CodeTask 持久化独立 `timeout_at`，或明确设计成单独表/字段索引
    - 在 `advanceCodeTask()` 进入 `RUNNING` / `VERIFYING` 时写入 deadline，并在 `checkCodeTaskTimeout()` 按任务自身 deadline 检查

- Run 缺少多 CodeTask 聚合状态逻辑
  - Evidence:
    - Phase 4 deliverables 明确包含 “multi-CodeTask aggregation rules”，见 `.kiro/steering/module-roadmap.md:96-107`
    - 设计规定 `AWAITING_CODE_ACTION`、`AWAITING_REVIEW`、`READY_TO_COMMIT`、`COMPLETED` 都是多 CodeTask 的聚合视图，见 `docs/orchestrator-design.md:151-159` 与 `docs/design.md:798`
    - `CodeTaskRepository` 已提供按 `runId` 查询的 `list()`，见 `packages/storage/src/repos/code-task-repo.ts:58-63,136-152`
    - 但当前 `Orchestrator` 在 CodeTask 创建、推进、retry 后只更新当前 task 和写事件，没有读取同一 run 下其他 task，也没有任何聚合判定，见 `apps/orchestrator/src/orchestrator.ts:167-189,217-236`
  - Impact:
    - 多个 CodeTask 并存时，Run 无法正确进入 `AWAITING_REVIEW` / `READY_TO_COMMIT` / `COMPLETED`，后续 review/commit 流会和设计脱节。
  - Suggested fix:
    - 增加 `recomputeRunStatusFromCodeTasks(runId)` 之类的聚合逻辑
    - 在 `createCodeTask()`、`advanceCodeTask()`、`retryCodeTask()`、`reject/commit/cancel` 后统一重算 Run 聚合状态

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Cross-checked Phase 4 exit criteria against `.kiro/steering/module-roadmap.md`
  - Cross-checked Run/CodeTask state semantics against `docs/design.md` and `docs/orchestrator-design.md`
- Result summary:
  - 所有基线命令通过，说明当前实现可编译、可测试；但实现行为仍未完全满足 Phase 4 设计约束。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion: state machine behavior matches design
    - Result: fail
    - Notes: `pause` 语义和多 CodeTask 聚合状态未对齐设计
  - Criterion: `timeout_at` is written and checked correctly
    - Result: fail
    - Notes: Run 有超时写入，CodeTask 没有独立超时写入与检查
  - Criterion: retry creates child CodeTask instead of mutating history
    - Result: pass
    - Notes: `retryCodeTask()` 正确创建子任务并增加 `attempt`
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 将 `pauseRequested` 与真正的 `PAUSED` 状态拆开
  - 为 CodeTask 引入独立 timeout 持久化与检查
  - 增加 Run 对多 CodeTask 的聚合状态重算逻辑
- Deferred items:
  - 无
- Risks carried into next phase:
  - 若直接进入 Phase 5，Harness 和 Review/Commit 会建立在错误的 Run/CodeTask 协调语义之上，后续返工成本会上升。
