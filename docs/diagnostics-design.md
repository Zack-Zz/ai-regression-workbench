# Diagnostics 详细设计

## 1. 模块范围

诊断层包含：

- `test-runner`
- `trace-bridge`
- `log-bridge`

目标是为失败用例生成统一诊断上下文，而不是只保存零散 artifacts。

## 2. 诊断输入

- network log
- response headers
- response body
- ui actions（click/input/select 等）
- flow steps（业务步骤）
- screenshot
- video
- trace summary
- log summary

## 3. CorrelationContext

```ts
export interface CorrelationContext {
  traceIds: string[];
  requestIds: string[];
  sessionIds: string[];
  serviceHints?: string[];
  fromTime?: string;
  toTime?: string;
}
```

## 4. 可配置关联键

- `diagnostics.correlationKeys.responseHeaders`
- `diagnostics.correlationKeys.responseBodyPaths`
- `diagnostics.correlationKeys.logFields`
- `diagnostics.correlationKeys.caseInsensitiveHeaderMatch`
- `diagnostics.correlationKeys.timeWindowSeconds`

## 5. 输出对象

- `CorrelationContext`
- `ApiCallRecord`
- `UiActionRecord`
- `FlowStepRecord`
- `TestcaseExecutionProfile`
- `TraceSummary`
- `LogSummary`

## 6. 采集规则

接口粒度（API Call）：

- 记录 method、url、statusCode、startedAt、endedAt、durationMs
- 记录 responseSummary（脱敏后的响应摘要）
- 记录 success/errorType/errorMessage
- 尝试关联 traceId/requestId

点击粒度（UI Action）：

- 记录 actionType、locator、pageUrl、startedAt、endedAt、durationMs
- 记录该动作触发的接口数量（apiCallCount）与失败数量（failedApiCount）

流程粒度（Flow Step）：

- 记录 stepName、startedAt、endedAt、durationMs
- 聚合步骤内点击数、接口数、失败接口数
- 保留 flowStep 与 uiAction/apiCall 关联

错误处理：

- 明细采集失败记为 degraded，并写事件
- 不影响 testcase 主执行与 run 主流程推进

## 7. 第一阶段约束

- 只支持一个 trace provider
- 只支持一个 log provider
- 日志只输出摘要，不做全文检索 UI
- 明细报告先覆盖失败 testcase，成功用例按配置开关采集
