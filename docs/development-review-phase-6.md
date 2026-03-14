# Development Review Phase 6

## 1. Metadata

- Review target: Phase 6 AI Engine and Draft Generation
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: `apps/ai-engine` prompt/template loading, context trimming, failure analysis, finding summaries, generated test drafts, CodeTask drafts
- Related phase: Phase 6
- Related previous reviews:
  - `development-review-phase-5.md`
  - `development-review-phase-5-recheck-1.md`
  - `development-review-phase-5-recheck-2.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 基线命令通过，但 Phase 6 仍有 3 个未闭环的设计缺口：prompt 模板仍是内嵌常量、`CodeTaskDraft` 没有持久化、`FailureAnalysis` 持久化丢失 prompt 版本可追溯性。

## 3. Scope

- Reviewed modules:
  - `apps/ai-engine/src/ai-engine.ts`
  - `apps/ai-engine/src/context-trimmer.ts`
  - `apps/ai-engine/src/prompt-loader.ts`
  - `apps/ai-engine/test/ai-engine.test.ts`
- Reviewed docs/contracts:
  - `docs/ai-engine-design.md`
  - `docs/design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 7 API wiring
  - Phase 8 UI wiring
  - Real provider integration

## 4. Findings

### High

- Prompt 模板仍然是代码内嵌常量，没有做到外置和可配置
  - Evidence:
    - 设计要求模板外置并带版本号，默认放在 `prompts/` 目录，见 `docs/ai-engine-design.md:58-68` 和 `docs/design.md:2670-2677`
    - 当前 `prompt-loader.ts` 直接把所有模板硬编码在 `TEMPLATES` 常量里，没有任何文件加载逻辑，见 `apps/ai-engine/src/prompt-loader.ts:7-27`
  - Impact:
    - 模板改动必须改代码并重新发版，后续 provider 差异化、prompt 调优和回放对比都缺少正式模板资产入口。
  - Suggested fix:
    - 把模板迁到外部 `prompts/` 目录
    - `PromptLoader` 改为从文件系统加载模板，并保留版本号解析

- `CodeTaskDraft` 仍然没有持久化，和“所有 AI 输出必须持久化”不一致
  - Evidence:
    - `LocalAIEngine` 注释直接写了 “All outputs are persisted to DB and disk before returning”，见 `apps/ai-engine/src/ai-engine.ts:28-33`
    - 设计也明确写了 “所有 AI 输出必须持久化”，见 `docs/ai-engine-design.md:92-98`
    - 但 `createCodeTaskDraft()` 只是构造一个内存对象后直接返回数组，没有任何 DB 或文件写入，见 `apps/ai-engine/src/ai-engine.ts:163-194`
    - 对比之下，`createGeneratedTestDraft()` 已经把代码落盘并保存元数据，见 `apps/ai-engine/src/ai-engine.ts:142-160`
  - Impact:
    - `CodeTaskDraft` 无法被后续 `CodeTaskPolicy -> PENDING_APPROVAL` 流程稳定接住；一旦进程结束，这批 AI 产物就丢失了。
  - Suggested fix:
    - 为 `CodeTaskDraft` 增加正式持久化模型
    - 至少保存 draft 元数据，并提供从 draft 到 `code_tasks` / `PENDING_APPROVAL` 的明确衔接路径

### Medium

- `FailureAnalysis` 持久化丢失了 prompt 版本可追溯性
  - Evidence:
    - 设计要求 “模板版本写入分析产物，便于回放”，并要求 prompt/trim 版本可追溯，见 `docs/ai-engine-design.md:65-68` 和 `docs/ai-engine-design.md:92-98`
    - `analyzeFailure()` 在返回 DTO 时包含 `promptTemplateVersion`，见 `apps/ai-engine/src/ai-engine.ts:70-81`
    - 但 `AnalysisRepository.save()` 的持久化字段里没有 `prompt_template_version`，`analyzeFailure()` 也没有把该版本落库，见 `packages/storage/src/repos/analysis-repo.ts:13-24` 和 `apps/ai-engine/src/ai-engine.ts:84-96`
  - Impact:
    - FailureAnalysis 一旦只剩数据库记录，就无法回放它到底是由哪个 prompt 模板版本生成的。
  - Suggested fix:
    - 给 `failure_analysis` 增加 `prompt_template_version`，必要时再补 `context_trimmer_version`
    - 在 `AnalysisRepository` 和测试里同步落库校验

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - Cross-checked prompt/template requirements against `docs/ai-engine-design.md`
  - Cross-checked CodeTaskDraft flow against `docs/design.md`
- Result summary:
  - 所有基线命令通过；当前问题集中在 AI output persistence 和 prompt traceability 没有完全落成。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion: AI output stays within draft / pending approval boundaries
    - Result: pass
    - Notes: 当前 `GeneratedTestDraft` 和 `CodeTaskDraft` 都停在 `draft`
  - Criterion: findings remain exploration-only
    - Result: pass
    - Notes: `summarizeFindings()` 只接受 `ExplorationFindingContext`，没有把 regression failure 落成 findings
  - Criterion: generated test draft lifecycle matches design
    - Result: pass with notes
    - Notes: 候选测试草稿已落盘并保存元数据，但 `CodeTaskDraft` 的持久化还没跟上
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 外置 prompt 模板并实现文件加载
  - 为 `CodeTaskDraft` 增加持久化与后续衔接
  - 给 `FailureAnalysis` 持久化补上 prompt 版本追溯
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果直接进入 Phase 7，API/前端会围绕一个“GeneratedTest 已落库、CodeTaskDraft 只在内存里”的不对称模型继续扩散，后续补持久化会涉及 DTO、存储和页面联动返工。
