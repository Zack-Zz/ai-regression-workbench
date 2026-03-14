# HTTP API 契约设计

## 1. 目标

定义 Web UI 与本地应用服务之间的 HTTP 契约，避免前后端各自发明错误码、动作结果和实时刷新协议。

## 2. 通用原则

- 所有响应使用 `application/json`
- 长流程操作采用“触发后返回”，不在单次请求内等待全流程完成
- 第一阶段以轮询为主，SSE 为后续增强
- 所有业务错误都需要稳定的 `errorCode`

## 3. 通用响应结构

成功读接口：

```json
{
  "success": true,
  "data": {}
}
```

动作接口：

```json
{
  "success": true,
  "message": "CodeTask 已进入待执行状态",
  "warnings": [],
  "nextSuggestedAction": "refresh-run-detail"
}
```

失败接口：

```json
{
  "success": false,
  "message": "selector 与 runMode 不匹配",
  "errorCode": "RUN_SELECTOR_INVALID",
  "retryable": false,
  "details": {
    "runMode": "regression"
  }
}
```

## 4. HTTP 状态码建议

- `200`
  成功读取或动作已接受
- `400`
  参数错误、状态不合法
- `404`
  资源不存在
- `409`
  版本冲突、状态冲突、expectedVersion 不匹配
- `422`
  业务校验失败
- `500`
  未分类服务端错误

## 5. 常用错误码

- `RUN_SELECTOR_INVALID`
- `RUN_MODE_INVALID`
- `WORKSPACE_NOT_FOUND`
- `SHARED_ROOT_INVALID`
- `CODE_TASK_STATE_INVALID`
- `CODE_TASK_SCOPE_FORBIDDEN`
- `VERIFY_OVERRIDE_NOT_ALLOWED`
- `SETTINGS_VERSION_CONFLICT`
- `SETTINGS_VALIDATION_FAILED`
- `SERVICE_RESTART_REQUIRED`

## 6. 运行相关接口

- `POST /runs`
  触发 `StartRunInput`
- `GET /runs`
  返回 `RunSummary[]`
- `GET /runs/:runId`
  返回 `RunDetail`
- `GET /runs/:runId/execution-report`
  返回 `ExecutionReport`
- `GET /runs/:runId/events?cursor=<id>&limit=<n>`
  返回 `RunEventPage`

第一阶段轮询建议：

- `RunDetail` 活跃 run 每 2 秒拉一次
- `RunList` 有活跃 run 时每 5 秒拉一次
- run 终态后停止轮询

## 7. Settings 相关接口

- `GET /settings`
- `POST /settings/validate`
- `PUT /settings`

约束：

- `PUT /settings` 必须携带 `expectedVersion`
- 若 `report.port` 等配置需重启生效，响应中通过 `requiresRestart` 与 `nextRunOnlyKeys` 明示

## 8. CodeTask / Review / Commit

- `POST /code-tasks/:taskId/approve`
- `POST /code-tasks/:taskId/execute`
- `POST /code-tasks/:taskId/retry`
- `POST /reviews`
- `POST /commits`

约束：

- review retry 作用于“创建新 task attempt”，而不是把旧 task 状态回退
- verify override 必须通过显式字段提交，例如 `forceReviewOnVerifyFailure=true`
- verify override 属于 `accept` 的受控变体，不单独引入第四种 review decision

## 9. SSE 策略

第一阶段不要求实现 SSE。

若后续增加：

- `GET /runs/:runId/events/stream`
- 仅作为低延迟增强
- 轮询仍保留为降级路径
