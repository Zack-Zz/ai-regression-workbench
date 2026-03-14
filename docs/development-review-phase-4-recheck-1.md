# Development Review Phase 4 Recheck 1

## 1. Metadata

- Review target: Phase 4 Orchestrator Core recheck
- Review date: 2026-03-14
- Reviewer: Codex
- Scope: Recheck of fixes for `development-review-phase-4.md`
- Related phase: Phase 4
- Related previous reviews:
  - `development-review-phase-4.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 上轮的 `pause` 安全点模型和 `CodeTask timeout_at` 问题已经修复，基线命令也通过；但多 `CodeTask` 聚合逻辑还剩 1 个关键语义错误，`COMMIT_PENDING / COMMITTED` 会把 Run 推到错误状态。

## 3. Scope

- Reviewed modules:
  - `apps/orchestrator/src/orchestrator.ts`
  - `apps/orchestrator/test/orchestrator.test.ts`
  - `packages/storage/src/repos/code-task-repo.ts`
- Reviewed docs/contracts:
  - `docs/design.md`
  - `docs/orchestrator-design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 5 Agent Harness implementation
  - API/UI integration

## 4. Findings

### High

- `recomputeRunStatus()` 对 `COMMIT_PENDING / COMMITTED` 的聚合映射仍然错误
  - Evidence:
    - 设计要求 `AWAITING_REVIEW` 表示“存在待 review 的 CodeTask”，`READY_TO_COMMIT / COMPLETED` 则取决于是否还存在待 commit 的任务，见 `docs/orchestrator-design.md:154-159`
    - 主状态机也明确是 `AWAITING_REVIEW -> READY_TO_COMMIT -> COMPLETED`，见 `docs/design.md:844-848`
    - 当前实现把 `COMMIT_PENDING` 和 `SUCCEEDED` 一起归到 `AWAITING_REVIEW`，见 `apps/orchestrator/src/orchestrator.ts:278-281`
    - 同时在“全部 terminal”分支里，把存在 `COMMITTED` 的情况映射到 `READY_TO_COMMIT`，否则回退到 `AWAITING_CODE_ACTION`，见 `apps/orchestrator/src/orchestrator.ts:284-286`
  - Impact:
    - review accept 之后，Run 不会稳定进入 `READY_TO_COMMIT`
    - 所有任务已 commit 后，Run 也不会自然进入 `COMPLETED`
    - review/commit 流程进入 Phase 5 之前仍会建立在错误的聚合状态语义上
  - Suggested fix:
    - `SUCCEEDED` 保持映射到 `AWAITING_REVIEW`
    - `COMMIT_PENDING` 应映射到 `READY_TO_COMMIT`
    - 所有 task 都已终态且不存在 `COMMIT_PENDING` 时，应进入 `COMPLETED`
    - 补测试覆盖：
      - `SUCCEEDED -> AWAITING_REVIEW`
      - `COMMIT_PENDING -> READY_TO_COMMIT`
      - `COMMITTED only -> COMPLETED`

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Rechecked Phase 4 findings against `docs/orchestrator-design.md` aggregation rules
  - Rechecked source/test layout isolation
- Result summary:
  - 所有基线命令通过；剩余问题是 Run 聚合状态语义不一致，不是构建或测试基线问题。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion: state machine behavior matches design
    - Result: fail
    - Notes: `pause` 与 task timeout 已对齐，但 `COMMIT_PENDING / COMMITTED` 聚合状态仍不符合设计
  - Criterion: `timeout_at` is written and checked correctly
    - Result: pass
    - Notes: CodeTask 已有独立 `timeout_at` 持久化与检查
  - Criterion: retry creates child CodeTask instead of mutating history
    - Result: pass
    - Notes: `retryCodeTask()` 仍保持创建子任务语义
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 修正 `recomputeRunStatus()` 中 `COMMIT_PENDING / COMMITTED` 的聚合规则
  - 补充对应的 Run 聚合测试
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果在当前状态进入 Phase 5，Harness/Review/Commit 的状态联动会围绕错误的 Run 聚合状态继续扩散。
