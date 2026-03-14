# Development Review Phase 5

## 1. Metadata

- Review target: Phase 5 Agent Harness
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: `packages/agent-harness` runtime, policy enforcement, checkpoint/trace persistence, artifact truth generation
- Related phase: Phase 5
- Related previous reviews:
  - `development-review-phase-4.md`
  - `development-review-phase-4-recheck-1.md`
  - `development-review-phase-4-recheck-2.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 基线命令通过，但 Phase 5 仍有 3 个未闭环的实现缺口：Harness policy 只实现了局部约束、approval 记录没有真正持久化、diff/patch/verify 还没有形成“系统派生事实源”。

## 3. Scope

- Reviewed modules:
  - `packages/agent-harness/src/session-manager.ts`
  - `packages/agent-harness/src/tool-registry.ts`
  - `packages/agent-harness/src/artifact-writer.ts`
  - `packages/agent-harness/src/harness-policy.ts`
  - `packages/agent-harness/test/agent-harness.test.ts`
- Reviewed docs/contracts:
  - `docs/agent-harness-design.md`
  - `docs/design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 6 AI Engine
  - Phase 7 API wiring
  - Phase 8 UI wiring

## 4. Findings

### High

- Harness policy enforcement 只实现了 `toolCallTimeoutMs` 和 `requireApprovalFor`，其余 runtime 约束没有落地
  - Evidence:
    - 设计把 `sessionBudgetMs`、`stopConditions`、`allowedHosts`、`allowedWriteScopes` 都列为 HarnessPolicy 的核心约束，见 `docs/agent-harness-design.md:60-76`
    - Phase 5 目标也明确要求交付 “policy enforcement”，见 `.kiro/steering/module-roadmap.md:113-121`
    - 当前实现里 `ToolRegistry` 构造函数只接收 `requireApprovalFor` 和 `toolCallTimeoutMs`，见 `packages/agent-harness/src/tool-registry.ts:29-38`
    - `HarnessSessionManager` 也只是把 policy 序列化存盘，没有任何 `sessionBudgetMs`、`stopConditions`、`allowedHosts`、`allowedWriteScopes` 的执行逻辑，见 `packages/agent-harness/src/session-manager.ts:48-75`
  - Impact:
    - Harness 现在只能算“记录 policy”，还不能真正约束 session runtime；后续 exploration/code-repair 一接进来，就会绕过主设计里的 host / write scope / budget 边界。
  - Suggested fix:
    - 给 Harness 增加统一的 runtime guard
    - 至少落地：
      - `sessionBudgetMs` 超时检查
      - `allowedHosts` / `allowedWriteScopes` 拦截
      - exploration 的 `stopConditions` 判断入口

- approval boundary 只做了拒绝调用，没有形成可恢复、可审计的 approval 持久化链路
  - Evidence:
    - 设计要求 Harness 把 `tool call、approval、checkpoint` 持久化，见 `docs/agent-harness-design.md:158-165` 和 `docs/agent-harness-design.md:194-199`
    - 共享类型也给 `AgentSession` 预留了 `waiting-approval` 状态，见 `docs/design.md:1447` 和 `packages/shared-types/src/enums.ts:73-79`
    - 当前 `ToolRegistry` 在无审批时只返回 `denied`，把 `approvalId` 作为可选字段塞进内存中的 `ToolCallRecord`，见 `packages/agent-harness/src/tool-registry.ts:51-63` 和 `packages/agent-harness/src/tool-registry.ts:89-100`
    - `HarnessSessionManager` 没有任何 approval 记录模型、没有 `waiting-approval` 状态流转，也没有 approval 持久化入口，见 `packages/agent-harness/src/session-manager.ts:48-163`
  - Impact:
    - 运行时审批现在不可恢复、不可查询、不可回放。后续一旦接入真实 shell/git/write 工具，系统没法回答“等待的是哪一次审批”“批准后恢复到哪一步”。
  - Suggested fix:
    - 为 approval 增加显式持久化模型和 trace 落盘
    - 在 session 生命周期里补 `waiting-approval -> running` 的闭环
    - 让 tool call denial 与 approval request/approval granted 形成可回放记录

- `diff / patch / verify truth generation` 还没有真正实现为系统派生事实源
  - Evidence:
    - Phase 5 deliverable / exit criteria 明确要求 `diff / patch / verify truth generation` 且这些输出必须 “system-derived”，见 `.kiro/steering/module-roadmap.md:121-127`
    - 设计也要求变更结果以 Harness 统一生成的 `diff / patch / verify` 为准，而不是 agent 自报，见 `docs/agent-harness-design.md:145-156`
    - 当前 `ArtifactWriter` 只是把调用方传入的字符串直接写到目标路径，见 `packages/agent-harness/src/artifact-writer.ts:10-35`
    - `packages/agent-harness` 内没有任何基于工作区状态生成 diff/patch、执行 verify 命令、更新 `code_tasks.diff_path / patch_path / raw_output_path / verify_passed / harness_session_id` 的逻辑，见 `packages/agent-harness/src/*.ts`
  - Impact:
    - 现在的 artifact writer 只是“文件落盘工具”，不是“系统事实生成器”。只要上游把 agent 产出的任意字符串传进来，Harness 就会原样写盘，和设计要求的真值来源不一致。
  - Suggested fix:
    - 把 artifact 生成提升成 Harness 的正式执行路径：
      - 基于 workspace/git 生成 diff / patch
      - 基于 verify 命令结果生成 verify 输出和 `verify_passed`
      - 同步写回 `code_tasks` 的 artifact 路径与 `harness_session_id`

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Cross-checked Phase 5 exit criteria against `.kiro/steering/module-roadmap.md`
  - Cross-checked Harness policy / approval / artifact semantics against `docs/agent-harness-design.md` and `docs/design.md`
- Result summary:
  - 所有基线命令通过；当前问题集中在 Harness runtime contract 没有完全落成。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion: Harness owns runtime concerns, not business state transitions
    - Result: pass with notes
    - Notes: 当前实现没有侵入业务状态机，但 runtime concerns 也还没收全，尤其是 policy / approval / artifact truth
  - Criterion: session traces and context summaries are persisted
    - Result: pass with notes
    - Notes: `context-summary.json`、`steps.jsonl`、`tool-calls.jsonl` 可以落盘，但 approval 记录还没形成持久化闭环
  - Criterion: diff / patch / verify outputs are system-derived
    - Result: fail
    - Notes: 当前只有文件写入器，没有系统派生的 truth generation 流程
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 落地未实现的 HarnessPolicy enforcement
  - 增加 approval persistence 和 `waiting-approval` 闭环
  - 把 diff / patch / verify 变成 Harness 统一生成并回写 `code_tasks` 的事实源
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果直接进入 Phase 6/7，AIEngine、API、UI 会围绕一个“只会记账、不会真正约束”的 Harness 继续扩散，后续补权限边界和审计链路的返工成本会更高。
