# design-review-v3 处置记录

> 对应评审文档：`docs/design-review-v3.md`
> 处置日期：2026-03-14

## 1. 结论

`design-review-v3.md` 的意见整体比前两轮更接近当前文档状态，其中一部分是有效缺口，另一部分是“已有答案但缺少显式说明”，还有少数建议不适合在当前阶段过度收紧。

本次已把仍然成立、且会影响实现边界的缺口补进设计文档与 UI 预览。

## 2. 已采纳并落地

- 明确多 CodeTask 并行时 Run 状态是聚合视图，单个 task retry 不强制回退全部任务
- 明确 `COLLECTING_ARTIFACTS` 在 regression/hybrid 与 exploration 下的产物语义
- 明确 `ExplorationAgent.explore()` 是 session 级入口，实际 step 循环仍由 Harness 驱动
- 明确 `CodeChangeResult.diffPath/patchPath/changedFiles` 以 Harness 基于工作区与 `git diff` 计算的结果为准
- 为 `RunRepository` 补充关键读方法，并明确 `AgentHarness` 可按职责直接调用 Repository
- 明确 `timeout_at` 的写入时机与 `TimeoutPolicy` 的检测机制
- 为 `AgentSession` / `agent_sessions` 补充 `contextRefsJson / context_refs_json`
- 去掉 `FailureAnalysis.retryCount`，保留 `version` 作为当前设计中的唯一分析版本字段
- 明确 exploration 配置三层合并规则：`StartRunInput > PersonalSettings > config.default.yaml`
- 明确 `ExecutionReport` 的索引入库 + 完整 JSON 文件落盘策略
- 明确 `ExecutionReportBuilder` 在 Run 终态时聚合 `flowSummaries`
- 明确 `TestcaseExecutionProfile` 默认预计算并落盘到 `execution-profile.json`
- 补充 testcase 级 diagnostics HTTP 契约
- 明确第一阶段 `Scenario` 的来源来自测试元数据/测试文件注解，不提供独立管理 UI
- 明确配置热更新观察者接口和注册时机
- 明确 `ObservedHarness` 建议位于 `packages/agent-harness`，并通过 `ObservabilityAdapter` 解耦
- 修正 `doctor` 对迁移状态的检查语义，改为“schema 版本与迁移执行结果是否一致”
- 同步更新 `docs/ui-preview/` 中首页、Run List、Run Detail、Review / Commit 的中英文静态预览

## 3. 已存在，不再重复修改

以下问题在复核时确认现有文档已经给出答案，因此未再重复修改：

- Harness 与 CodeAgent 的 diff / patch 职责边界
- `ExecutionReport` 的“表存索引、文件存完整报告”总体策略
- `taskVersion` 与持久层 `attempt` 的对应关系
- `TestcaseExecutionProfile` 已有文件路径定义

## 4. 当前阶段未按建议采纳

- 未把 `ExplorationAgent` 直接改成 `onStep()/shouldStop()` 风格接口
  原因：当前文档通过补充约束已能表达 Harness 驱动模型；进一步拆成 step 级回调更偏实现细化，当前不是阻塞项。

- 未把 `CodeTaskStatus.SUCCEEDED` 重命名为 `AWAITING_REVIEW`
  原因：当前通过补充“`SUCCEEDED` 不是终态，只表示 verify 阶段成功完成”的说明即可消除主要歧义，暂不做全状态名迁移。

## 5. 当前规范来源

本轮处置后，应以以下文档作为最新规范：

- `docs/design.md`
- `docs/agent-harness-design.md`
- `docs/orchestrator-design.md`
- `docs/ai-engine-design.md`
- `docs/api-contract-design.md`
- `docs/app-services-design.md`
- `docs/storage-mapping-design.md`
- `docs/test-assets-design.md`
- `docs/local-ui-design.md`
- `docs/observability-design.md`
- `docs/packaging-design.md`

`docs/design-review-v3.md` 保留为外部评审输入，不直接替代上述规范文档。
