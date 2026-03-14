# Development Review Phase 5 Recheck 1

## 1. Metadata

- Review target: Phase 5 Agent Harness recheck
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: Recheck of fixes for `development-review-phase-5.md`
- Related phase: Phase 5
- Related previous reviews:
  - `development-review-phase-5.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 上轮的 policy / approval / artifact 方向已经补进来了，但还剩 2 个关键语义问题：默认空 `allowedWriteScopes` 会放开写权限，`patch` 生成也还不是基于当前工作区改动。

## 3. Scope

- Reviewed modules:
  - `packages/agent-harness/src/tool-registry.ts`
  - `packages/agent-harness/src/session-manager.ts`
  - `packages/agent-harness/src/artifact-writer.ts`
  - `packages/agent-harness/test/agent-harness.test.ts`
- Reviewed docs/contracts:
  - `docs/agent-harness-design.md`
  - `docs/design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 6 AI Engine
  - API/UI integration

## 4. Findings

### High

- 默认空 `allowedWriteScopes` 现在会变成“允许任意写”，和 exploration 默认只读语义相反
  - Evidence:
    - 测试明确声明 exploration policy 默认应“不允许 write scopes”，见 `packages/agent-harness/test/agent-harness.test.ts:36-40`
    - 默认 exploration policy 也确实把 `allowedWriteScopes` 设成空数组，见 `packages/agent-harness/src/harness-policy.ts:22-28`
    - 但 `ToolRegistry` 只有在 `allowedWriteScopes.length > 0` 时才做写路径校验，见 `packages/agent-harness/src/tool-registry.ts:92-107`
  - Impact:
    - `allowedWriteScopes=[]` 时，`fs.write*` 工具不会被任何 scope 规则拦截。也就是说默认 exploration session 反而可能拥有无限写权限。
  - Suggested fix:
    - 把空 `allowedWriteScopes` 解释为“禁止所有写”
    - 单独对 exploration / code-repair 默认 policy 补测试，覆盖“空数组时拒绝写”

- `patch` 生成语义仍然错误，`git format-patch HEAD --stdout` 不是当前工作区改动的补丁
  - Evidence:
    - 设计要求 `diff / patch / verify` 作为 Harness 统一生成的事实源，反映本次变更结果，见 `docs/agent-harness-design.md:145-156`
    - 当前 `generateArtifacts()` 用 `git diff HEAD` 生成 diff，但 patch 用的是 `git format-patch HEAD --stdout`，见 `packages/agent-harness/src/artifact-writer.ts:46-49`
    - `git format-patch HEAD --stdout` 产出的是提交 patch，而不是未提交工作区改动；它和 `git diff HEAD` 的语义不一致，也可能在某些仓库状态下失败
  - Impact:
    - `changes.diff` 和 `changes.patch` 可能指向不同事实来源，后续 review/commit/replay 会围绕错误 patch 工作。
  - Suggested fix:
    - 让 `patch` 和 `diff` 基于同一工作区状态生成
    - 至少补测试覆盖：
      - 工作区有未提交改动时，`changes.diff` 和 `changes.patch` 都来自当前改动
      - 不依赖 `HEAD` commit patch 语义

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Rechecked `allowedWriteScopes` semantics against default exploration policy
  - Rechecked artifact generation semantics against Phase 5 “system-derived truth” requirement
- Result summary:
  - 所有基线命令通过；剩余问题是权限和 artifact 真值语义问题，不是构建或测试基线问题。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion: Harness owns runtime concerns, not business state transitions
    - Result: pass with notes
    - Notes: Harness 边界没有侵入业务状态机，但写权限默认值仍然错误
  - Criterion: session traces and context summaries are persisted
    - Result: pass
    - Notes: context summary、step trace、tool/approval 记录都已落盘
  - Criterion: diff / patch / verify outputs are system-derived
    - Result: fail
    - Notes: `patch` 仍没有和当前工作区改动保持同一事实来源
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 修正空 `allowedWriteScopes` 的默认拒绝语义
  - 修正 `patch` 的生成方式，并补覆盖当前工作区改动的测试
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果现在进入 Phase 6，exploration 默认权限边界会失真，review/commit 也会拿到不可靠的 patch 产物。
