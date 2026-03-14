# Development Review Phase 7 Recheck 1

## 1. Metadata

- Review target: Phase 7 API Layer recheck
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: recheck of `development-review-phase-7.md`
- Related phase: Phase 7
- Related previous reviews:
  - `development-review-phase-7.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 上轮 5 个问题里，缺失 endpoint、settings 版本实现、部分错误码映射已经修复；但 `review retry` 语义和 exploration run 归一化仍未完全对齐设计。

## 3. Scope

- Reviewed modules:
  - `apps/cli/src/handlers`
  - `apps/cli/src/services`
  - `apps/cli/test`
- Reviewed docs/contracts:
  - `docs/api-contract-design.md`
  - `docs/app-services-design.md`
  - `docs/design.md`
- Explicitly out of scope:
  - Phase 8 UI
  - 非 Phase 7 的 orchestrator / harness 内部行为

## 4. Findings

### High

- Review retry still does not create a new task attempt directly
  - Evidence:
    - 契约明确要求 review retry 作用于“创建新 task attempt”，不是回退旧任务，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L144](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L144)。
    - 主设计也要求 retry 必须创建新的 `CodeTask`，并通过 `parentTaskId` 串联，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L692](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L692) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L931](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L931)。
    - 当前 `submitReview()` 在 `decision='retry'` 时只是把原任务标记成 `FAILED`，真正的新 attempt 仍然需要后续再手动调用 `retryCodeTask()`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L152](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L152) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L115](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L115)。
  - Impact:
    - review retry 的 API 语义仍然和契约不一致，前端或调用方需要额外拼接一次重试动作，任务历史也会出现“review retry 已提交但新 attempt 尚未创建”的中间裂缝。
  - Suggested fix:
    - 在 `submitReview()` 的 retry 分支里直接创建新 `CodeTask` attempt，并把原任务保留在原状态或标记为已被 retry；不要要求调用方再发第二次 retry 请求。

### Medium

- Exploration run normalization is still incomplete
  - Evidence:
    - 设计要求 `StartRunInput.exploration` 在 `RunService.startRun()` 内完成默认值合并，并把完整 exploration 配置持久化；`RunScopeType` 也明确包含 `'exploration'`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L386](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L386) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L420](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L420)。
    - 当前 `startRun()` 在没有 selector 时仍把 `scopeType` 默认写成 `'suite'`，并且只是原样保存 `input.exploration`，没有做配置层默认值合并，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L66](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L66) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L78](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L78)。
  - Impact:
    - exploration run 的摘要字段会误导 UI/后续服务，且持久化的 exploration 配置并不是设计定义的“归一化后完整配置”。
  - Suggested fix:
    - exploration-only run 在持久化时应使用 `scopeType='exploration'`，并接入配置默认值合并逻辑后再写入 `explorationConfigJson`。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - 逐条对照 `development-review-phase-7.md` 复核修复情况
  - 交叉检查 `submitReview()`、`retryCodeTask()`、`startRun()` 与契约文档
- Result summary:
  - 基线命令全部通过；仍残留 1 个高优先级语义问题和 1 个中优先级归一化问题。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `endpoint paths and DTOs match contract docs`
    - Result:
      - fail
    - Notes:
      - 路径层面已补齐，但 `review retry` 与 exploration run DTO/语义仍未完全匹配。
  - Criterion:
    - `testcase diagnostics endpoints are complete`
    - Result:
      - pass
    - Notes:
      - `execution-profile`、`trace`、`logs` 路径已实现。
  - Criterion:
    - `error codes are stable and documented`
    - Result:
      - pass with notes
    - Notes:
      - 相比上轮已有明显收口；本轮未发现新的阻塞性错误码问题。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 修正 `submitReview(retry)`，直接创建新 attempt
  - 修正 exploration run 的 `scopeType` 与配置归一化
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果现在让 UI 或更高层流程直接消费这版 API，review retry 和 exploration run 仍会出现和设计不一致的行为。
