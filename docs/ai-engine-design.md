# AI Engine 详细设计

## 1. 模块目标

`ai-engine` 负责结构化失败归因、上下文裁剪、prompt 构建以及 `CodeTaskDraft` 生成。

边界：

- 负责分析与建议
- 不直接执行代码修改
- 不直接管理工具调用与 agent runtime
- AI 自主探测能力由 [agent-harness-design.md](./agent-harness-design.md) 中的 `ExplorationAgent` 承担

## 2. 输入

- `Run`
- `TestResult`
- `Scenario`
- `CorrelationContext`
- `TraceSummary[]`
- `LogSummary`
- network 摘要
- screenshot 路径
- verify 输出
- `Finding[]`（来自 exploration session）
- 相关 settings snapshot

## 3. 输出

- `FailureAnalysis`
- `FindingSummary`
- `GeneratedTestDraft`
- `CodeTaskDraft`

## 4. 关键接口

```ts
export interface AIEngine {
  analyzeFailure(input: FailureContext): Promise<FailureAnalysis>;
  summarizeFindings(input: ExplorationFindingContext): Promise<FindingSummary[]>;
  createGeneratedTestDraft(input: FailureContext | ExplorationFindingContext): Promise<GeneratedTestDraft[]>;
  createCodeTask(input: CodeTaskDraftInput): Promise<CodeTaskDraft[]>;
}
```

说明：

- 一次 `FailureAnalysis` 可以产出多个 `CodeTaskDraft`
- 例如同一失败同时给出“修测试”和“修业务代码”两个方向

## 5. Prompt 构建策略

### 5.1 Prompt 模板

建议模板外置并带版本号：

- `failure-analysis/default@v1`
- `code-task-draft/default@v1`

要求：

- 模板与 provider 实现解耦
- 模板版本写入分析产物，便于回放

### 5.2 上下文裁剪

必须定义裁剪规则，禁止把原始 trace / logs 全量塞给模型。

建议：

- 错误日志优先最近 `N` 条
- 慢接口只保留 top `K`
- 网络摘要优先失败请求和高耗时请求
- trace 只保留关键 span 摘要
- screenshot 只传引用路径或描述摘要

### 5.3 Provider 差异

AI provider 的差异应由 adapter 处理，不应污染上层领域模型。

允许差异化：

- system prompt 结构
- 工具消息格式
- token 预算

## 6. 设计约束

- AI 输出默认只到 `DRAFT` 或 `PENDING_APPROVAL`
- AI 不直接改正式代码
- 所有 AI 输出必须持久化
- 分析失败不得覆盖原始测试结果
- Prompt 模板版本、裁剪规则版本必须可追溯

## 7. 与 Exploration 的关系

AI 参与站点自主探测时，应通过 harness 中的 `ExplorationAgent` 运行。

此时：

- `ai-engine` 继续负责结构化分析与 draft 生成
- `agent-harness` 负责工具调用、权限、trace、回放

这样可以避免把“结构化分析”和“交互式 agent runtime”混成一个模块
