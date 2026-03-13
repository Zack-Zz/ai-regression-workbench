# 外部观测集成设计

## 1. 目标

为 `ai-regression-workbench` 提供可选的 AI 调用观测能力，同时保持主流程与外部观测工具解耦。

## 2. 设计原则

- 外部观测工具只作为旁路增强，不作为主流程依赖
- 未安装、未配置或执行失败时，不影响 Run / CodeTask 主流程
- 不引入外部工具的内部数据模型到主系统核心领域模型

## 3. 推荐接入对象

建议优先观测：

- `CodexCliAgent`
- `KiroCliAgent`

不建议直接侵入：

- `Run`
- `FailureAnalysis`
- `Review`
- `CommitRecord`

## 4. 推荐接入方式

建议使用装饰器模式：

- `CodexCliAgent`
- `KiroCliAgent`
- `ObservedCodeAgent`

`ObservedCodeAgent` 负责：

1. 判断外部观测工具是否启用
2. 包装实际 CLI 调用
3. 提取最少量观测摘要
4. 将摘要写入事件或扩展记录

## 5. 与 zai-xray 的关系

`zai-xray` 适合作为外部 AI tracing / metrics 工具使用。

推荐定位：

- `ai-regression-workbench`
  负责测试失败到修复提交的主业务闭环

- `zai-xray`
  负责 AI CLI 调用的 tracing、cost、latency、error metrics

参考：

- [zai-xray GitHub](https://github.com/Zack-Zz/zai-xray)

## 6. 建议记录的数据

建议只回填摘要：

- `enabled`
- `provider`
- `externalTraceId`
- `totalTokens`
- `estimatedCost`
- `latencyMs`
- `summaryLink`

不建议直接同步外部工具完整数据库。

## 7. 错误处理

- 若外部观测工具不可用，记录 warning 事件即可
- 若包装执行失败，应自动降级到原始 CodeAgent 执行
