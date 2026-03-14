# Phase 2 开发 Review 复核记录 01

> 评审日期：2026-03-14
> 评审范围：`development-review-phase-2.md` 修复后复核
> 当前结论：未完全通过，上一轮问题已修复，但仍存在剩余 schema / repository coverage 缺口

## 1. 结论

上轮 Phase 2 review 中提出的以下问题已确认修复：

- `code_tasks` 默认枚举值已对齐共享类型
- `test_runs` 已补入 `exploration_config_json / pause_requested / current_stage / paused_at / totals / summary`
- 路径 helper 已增加 traversal / absolute / empty segment 校验
- `reviews` 已补入 `patch_hash` 并统一到 `created_at`

但本轮复核发现，Phase 2 仍未完全满足“schema matches design and storage mapping / repository supports both read and write paths required by orchestrator and harness”的退出条件。

## 2. Findings

### 2.1 High

- `001_initial_schema.sql` 仍与权威设计存在多处结构漂移
  - 典型例子：
    - `scenarios` 缺少 `updated_at`
    - `correlation_contexts` 缺少 `session_ids_json / service_hints_json`
    - `diagnostic_fetches` 缺少 `request_json`
    - `failure_analysis` 缺少 `suspected_layer / confidence / probable_cause / trace_summary_json / log_summary_json / version`
    - `findings` 缺少 `scenario_id / summary / evidence_json / promoted_task_id`
    - `api_call_records` / `ui_action_records` / `flow_step_records` 仍是精简版，不含设计要求的 `success`、`response_summary`、`ended_at`、聚合计数字段等
    - `agent_sessions` 缺少 `agent_name / policy_json / checkpoint_id / summary`
    - `run_events.entity_id` 仍可空，而设计要求非空
    - `commit_records` 缺少 `error_message`
  - 风险：
    - 后续按设计实现 orchestrator / harness / diagnostics / execution report 时，会再次遇到 migration 返工。

- storage 包的 repository 覆盖面仍不足，未达到设计要求的共享持久化边界
  - 当前只提供了：
    - `RunRepository`
    - `CodeTaskRepository`
    - `ReviewRepository`
    - `CommitRepository`
    - `TestResultRepository`
  - 仍缺少 design 中明确列出的持久化入口：
    - `saveCorrelationContext`
    - `saveAgentSession`
    - `saveFinding`
    - `saveApiCall`
    - `saveUiAction`
    - `saveFlowStep`
    - `saveExecutionReport`
    - `saveDiagnosticFetch`
    - `saveAnalysis`
    - `saveSystemEvent`
  - 风险：
    - `AgentHarness`、`DiagnosticsService`、`ExecutionReportBuilder` 在 Phase 3/4/5 仍没有可复用的存储边界，Phase 2 的 repository layer 交付不完整。

## 3. 验证结果

本轮实际执行结果如下：

- `pnpm test`
  - 结果：通过
- `pnpm -r typecheck`
  - 结果：通过
- `pnpm build`
  - 结果：通过

说明：本轮剩余问题仍然是设计契约和模块边界覆盖问题，而不是基线命令问题。

## 4. 修复建议

- 继续以 `docs/design.md` 和 `docs/storage-mapping-design.md` 为准，把 `001_initial_schema.sql` 里剩余表结构补齐，不要只对上一轮指出的表做局部修补。
- 在 `packages/storage` 中补出最小可用的 shared persistence boundary，至少覆盖设计里的 `RunRepository` 所要求的核心 save/get 方法，哪怕先以单表 repo 或统一 facade 形式实现。
- 增加 schema contract 测试，不要只验证“表存在”或“部分列存在”，而要覆盖关键字段集与非空约束。

