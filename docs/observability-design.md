# 外部观测集成设计

## 1. 目标

为 `ai-regression-workbench` 提供可选的 AI 调用与 harness session 观测能力，同时保持主流程与外部观测工具解耦。

## 2. 设计原则

- 外部观测工具只作为旁路增强，不作为主流程依赖
- 未安装、未配置或执行失败时，不影响 Run / CodeTask 主流程
- 不引入外部工具的内部数据模型到主系统核心领域模型

## 3. 推荐接入对象

建议优先观测：

- `AgentHarness`
- `ExplorationAgent`
- `CodeRepairAgent`
- `CodexCliAgent`
- `KiroCliAgent`

不建议直接侵入：

- `Run`
- `FailureAnalysis`
- `Review`
- `CommitRecord`

## 4. 推荐接入方式

建议使用装饰器模式：

- `ObservedHarness`
- `ObservedCodeAgent`

说明：

- 第一优先级是观测 harness session
- 对只支持 CLI 的 code agent，可继续保留 `ObservedCodeAgent`
- `ObservedHarness` 建议实现于 `packages/agent-harness`，作为可选装饰器导出
- 具体装配可以放在 `apps/orchestrator` 的依赖组装层完成

`ObservedHarness` 负责：

1. 判断外部观测工具是否启用
2. 包装实际 harness session 生命周期
3. 记录 step、tool call、approval、resume、replay 的摘要
4. 将摘要写入系统事件或扩展记录

## 5. 与 zai-xray 的关系

`zai-xray` 适合作为外部 AI tracing / metrics 工具使用。

推荐定位：

- `ai-regression-workbench`
  负责测试失败到修复提交的主业务闭环

- `zai-xray`
  负责 AI / harness 调用的 tracing、cost、latency、error metrics

集成方式建议：

- 在 `packages/agent-harness` 中定义 `ObservabilityAdapter` 接口
- `ObservedHarness` 仅依赖该接口，不直接耦合外部 provider SDK
- 外部观测工具既可以通过 npm SDK 接入，也可以通过 HTTP 回调/ingest API 接入

参考：

- [zai-xray GitHub](https://github.com/Zack-Zz/zai-xray)

## 6. 建议记录的数据

建议只回填摘要：

- `enabled`
- `provider`
- `externalTraceId`
- `sessionId`
- `agentName`
- `totalTokens`
- `estimatedCost`
- `latencyMs`
- `toolCallCount`
- `summaryLink`

不建议直接同步外部工具完整数据库。

## 7. 工具自身可观测性

除了被测系统的 trace/log，还应观测工具自身关键耗时：

- AI prompt 构建耗时
- harness session 总耗时
- 单工具调用耗时
- SQLite 查询与写入耗时
- verify 执行耗时

这些指标至少要进入：

- 结构化日志
- 事件摘要
- 可选外部 tracing

## 8. 错误处理

- 若外部观测工具不可用，记录 warning 事件即可
- 若包装执行失败，应自动降级到原始 harness / code agent 执行
