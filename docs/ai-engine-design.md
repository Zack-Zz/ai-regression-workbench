# AI Engine 详细设计

## 1. 模块目标

`ai-engine` 负责失败归因和修复任务草稿生成，不直接执行代码修改。

## 2. 输入

- `Run`
- `TestResult`
- `CorrelationContext`
- `TraceSummary[]`
- `LogSummary`
- network 摘要
- screenshot 路径

## 3. 输出

- `FailureAnalysis`
- `CodeTaskDraft`

## 4. 关键接口

```ts
export interface AIEngine {
  analyzeFailure(input: FailureContext): Promise<FailureAnalysis>;
  createCodeTask(input: CodeTaskDraftInput): Promise<CodeTaskDraft>;
}
```

## 5. 设计约束

- AI 输出默认只到 `DRAFT` 或 `PENDING_APPROVAL`
- AI 不直接改正式代码
- 所有 AI 输出必须持久化
