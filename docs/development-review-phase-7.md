# Development Review Phase 7

## 1. Metadata

- Review target: Phase 7 API Layer
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: `apps/cli`, shared service contracts, API contract alignment
- Related phase: Phase 7
- Related previous reviews: `development-review-phase-6-recheck-1.md`

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 基线命令通过，但 Phase 7 仍有多处 HTTP 契约和服务语义没有对齐设计，当前不能判定为完成。

## 3. Scope

- Reviewed modules:
  - `apps/cli/src/handlers`
  - `apps/cli/src/services`
  - `apps/cli/test`
  - `packages/shared-types/src/services.ts`
- Reviewed docs/contracts:
  - `docs/api-contract-design.md`
  - `docs/app-services-design.md`
  - `docs/design.md`
  - `.kiro/steering/module-roadmap.md`
- Explicitly out of scope:
  - Phase 8 UI implementation
  - 非 API 层的存储 schema 设计

## 4. Findings

### High

- Missing contract endpoints in the API layer
  - Evidence:
    - 契约要求提供 `GET /runs/:runId/execution-report`、`GET /runs/:runId/testcases/:testcaseId/execution-profile`、`GET /runs/:runId/testcases/:testcaseId/trace`、`GET /runs/:runId/testcases/:testcaseId/logs`、`POST /code-tasks/:taskId/retry`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L91](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L91) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L136](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L136)。
    - App service 设计也把这些方法列成正式服务边界，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L170](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L170)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L185](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L185)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L200](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L200)。
    - 当前路由只实现了 `/runs`、`/runs/:runId`、`/runs/:runId/events`、failure-report、diagnostics、analysis、`/code-tasks/:taskId/approve|reject|execute|cancel` 等接口，没有上述路径，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L20](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L20)。
  - Impact:
    - Phase 7 的“endpoint paths and DTOs match contract docs”与“testcase diagnostics endpoints are complete”两个退出条件都未满足。
  - Suggested fix:
    - 按契约补齐缺失路由，并同步补出 `RunService.getExecutionReport()`、`DiagnosticsService.getExecutionProfile()/getTrace()/getLogs()`、`CodeTaskService.retryCodeTask()` 及对应测试。

- `RunService.startRun()` and `listRuns()` do not honor the documented request/query contract
  - Evidence:
    - `StartRunInput` 和 `ListRunsQuery` 已定义 `selector`、`runMode`、`includeSharedInRuns`、`includeGeneratedInRuns`、`exploration` 等字段，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L28](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L28) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L51](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/shared-types/src/services.ts#L51)。
    - 设计要求 `regression` 必须且只能有一个 selector，`hybrid` 必须同时有 `selector + exploration`，且完整 exploration 配置要在 `RunService.startRun()` 归一化后持久化，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L413](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/app-services-design.md#L413)。
    - 当前实现只做了最小校验，然后一律写入 `scopeType: 'suite'`，忽略 selector/runMode 的细分语义，也没有持久化 merged exploration config；`listRuns()` 也没有消费 `runMode` 查询参数，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L39](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/run-service.ts#L39) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L30](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L30)。
  - Impact:
    - API 返回的 run 记录与请求输入不一致，后续 UI 和 Orchestrator 很容易基于错误的 `scopeType/scopeValue/runMode` 做判断。
  - Suggested fix:
    - 实现 selector 归一化、`runMode` 过滤、`hybrid` 输入校验和 exploration 配置合并持久化，并为每种模式补充接口测试。

- Review retry semantics are implemented incorrectly
  - Evidence:
    - 契约和主设计都明确要求 review retry 必须创建新的 task attempt，并通过 `parentTaskId` 串联，而不是把旧 task 状态回退，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L144](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L144)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L693](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L693)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L931](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/design.md#L931)。
    - 当前 `submitReview()` 在 `decision='retry'` 时直接把原任务状态改回 `DRAFT`，没有创建新任务，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L109](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/code-task-service.ts#L109)。
  - Impact:
    - 会破坏 `taskVersion -> attempt` 的版本语义，也会丢失 retry 历史，后续 review/commit/audit 无法正确追踪。
  - Suggested fix:
    - 引入 `retryCodeTask()` 并在 review retry 分支创建新的 `CodeTask` 记录，复制必要上下文，设置 `parentTaskId` 和递增 `attempt`。

### Medium

- Settings versioning is process-local and bypasses the Phase 1 config contract
  - Evidence:
    - 当前 `SettingsService` 用进程内 `private version = 1` 管理版本，重启后会重置，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/settings-service.ts#L17](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/services/settings-service.ts#L17)。
    - Phase 1 已经实现了带 sidecar 元数据的 `ConfigManager`，版本可以跨实例保留，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts#L14](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts#L14) 和 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts#L73](/Users/zhouze/Documents/git-projects/ai-regression-workbench/packages/config/src/config-manager.ts#L73)。
    - API 契约要求 `PUT /settings` 基于 `expectedVersion` 做并发保护，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L129](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L129)。
  - Impact:
    - 进程重启后 `expectedVersion` 会失真，可能接受本应被拒绝的并发覆盖。
  - Suggested fix:
    - 直接复用 `packages/config` 的 `ConfigManager`，不要在 API 层再维护一套独立的 settings 版本实现。

- Error status handling is still narrower than the documented API contract
  - Evidence:
    - 契约明确区分 `400/404/409/422/500`，并要求稳定 `errorCode`，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L50](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L50)。
    - 当前路由对 `approve/reject/execute/cancel/reviews` 等接口的大多数失败分支只返回 `404` 或 `400`，没有把状态冲突、业务校验失败区分出来，见 [/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L53](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L53)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L115](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L115)、[/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L140](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L140)。
  - Impact:
    - 前端无法稳定地区分“资源不存在”“状态冲突”“业务校验失败”，会直接影响交互和重试策略。
  - Suggested fix:
    - 把 service 层错误细分成 not found / invalid state / validation failure / version conflict，并在 handler 层映射到约定的 HTTP 状态码。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
  - 逐项交叉核对 `handlers`、`services`、shared DTO、API 契约和 app service 设计
  - 检查 `src/` 与 `test/` 目录隔离
- Result summary:
  - 三个基线命令均通过，当前问题集中在 API 契约实现不完整和服务语义偏差，不是工程基线失败。

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `endpoint paths and DTOs match contract docs`
    - Result:
      - fail
    - Notes:
      - 多个 contract endpoint 缺失，`StartRunInput` / `ListRunsQuery` 语义也未完全落实。
  - Criterion:
    - `testcase diagnostics endpoints are complete`
    - Result:
      - fail
    - Notes:
      - 缺少 `execution-profile`、`trace`、`logs` 相关接口。
  - Criterion:
    - `error codes are stable and documented`
    - Result:
      - fail
    - Notes:
      - 当前 handler 仍把多类错误折叠为 `400/404`。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 补齐缺失 API endpoint 与对应 service 方法
  - 修正 `startRun` / `listRuns` 的 contract 语义
  - 把 review retry 改成创建新 task attempt
  - 用 `ConfigManager` 替换 API 层的自实现 settings 版本管理
- Deferred items:
  - 无
- Risks carried into next phase:
  - 如果在 Phase 8 之前不先修这些接口偏差，UI 层会被迫围绕错误契约实现，后面返工成本会更高。
