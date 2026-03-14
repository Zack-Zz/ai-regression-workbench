# design-review-v2 处置记录

> 对应评审文档：`docs/design-review-v2.md`
> 处置日期：2026-03-14

## 1. 结论

`design-review-v2.md` 中的意见分为三类：

- 已采纳并补充到主设计/分设计中的问题
- 已在现有文档中解决，因此不再重复修改的问题
- 经复核后不作为当前阶段设计要求的问题

本次已对“仍然成立且值得补齐”的问题完成修订。

## 2. 已采纳并落地

- Harness 增加 exploration 停止条件设计，包括 `stopConditions`、软停止与硬预算并用
- 明确 Harness 与 Orchestrator 的 pause / resume 协议，采用“安全点暂停 + checkpoint 恢复”
- 明确 `resumeRun(runId)` 由系统按 `pausedAtStage / checkpoint` 自动恢复，而不是由调用方指定目标状态
- 明确超时状态映射：`test runner` / `harness session` / `verify` 为 blocking，`trace/log` 与 `AI analysis` 为 degraded
- 明确 `PLANNING_EXPLORATION` 的职责、失败处理和 `hybrid` 对 regression 结果的优先利用
- 明确 `Finding` 仅来自 exploration session；regression 失败分析输出的是 `FailureAnalysis`
- 补充 `GeneratedTestDraft` 生命周期，规定第一阶段只生成 candidate，不自动 promote
- 明确第一阶段不做 Generated Tests 自动去重，由 review 阶段判断
- 补充 API 错误码命名规范和常见错误码
- 补充 `GET /runs` 与 `GET /code-tasks` 的分页约定，并在 DTO 中引入分页返回
- 明确第一阶段 findings 内嵌在 `RunDetail` 中，不单独提供 `/runs/:runId/findings`
- 明确 `system_events` 第一阶段只写不读，不提供查询 API
- 在仓库结构中补充 `packages/agent-harness`，并明确 `ExplorationAgent / CodeAgent` 的运行时代码归属
- 明确 `exploration` 配置缺省时来自 `config.default.yaml` 合并结果
- 对齐 `Scenario` 的存储映射字段，使其与主设计中的 DDL 更接近

## 3. 已存在，不再重复修改

下列问题在复核时确认已被当前设计吸收，`design-review-v2.md` 的判断基于旧版本或旧截图，因此未再重复修改：

- `agent_sessions` 表缺少 DDL
- `findings` 表缺少 DDL
- `code_tasks` 表缺少 `attempt`
- `reviews` 表缺少 `code_task_version`
- run 清理 SQL 缺少 `findings`
- `scope_type` 在 exploration 模式下无值或无定义
- `taskVersion / attempt`、`codeTaskVersion` 的映射未定义

## 4. 未按建议采纳

- 未给 `agent_sessions` 单独增加 `attempt` 字段
  原因：当前 retry 语义是“创建新的 CodeTask 子任务”，`taskId + code_tasks.attempt` 已能表达执行轮次；在 session 层重复存一份 `attempt` 会造成冗余。

- 未把 `system_events` 第一阶段扩展为正式查询 API
  原因：当前阶段只需要审计落盘和排障能力，读接口可以在实现阶段按需要补充。

- 未把 Generated Tests 的自动去重做成硬约束算法
  原因：第一阶段优先保留人工 review 决策，不提前引入高误判率的相似度判定逻辑。

## 5. 结果说明

`design-review-v2.md` 现在应被视为“外部评审输入”；当前规范性设计以以下文档为准：

- `docs/design.md`
- `docs/agent-harness-design.md`
- `docs/orchestrator-design.md`
- `docs/ai-engine-design.md`
- `docs/api-contract-design.md`
- `docs/app-services-design.md`
- `docs/test-assets-design.md`
- `docs/storage-mapping-design.md`

如后续继续 review，应优先基于以上最新文档，而不是重复引用已过时的缺口描述。
