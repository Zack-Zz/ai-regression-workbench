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
- `TraceSummary`
- `LogSummary`

## 6. 第一阶段约束

- 只支持一个 trace provider
- 只支持一个 log provider
- 日志只输出摘要，不做全文检索 UI
