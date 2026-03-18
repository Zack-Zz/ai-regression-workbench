# 外部观测集成设计

## 1. 目标

为 `ai-regression-workbench` 提供两层可观测能力：

1. **进程级 + 业务流程日志**（`AppLogger`）— 内置，始终可用，输出到控制台和文件
2. **外部 AI / Harness 观测集成**（`ObservabilityAdapter`）— 可选旁路，不影响主流程

## 2. 设计原则

- 外部观测工具只作为旁路增强，不作为主流程依赖
- 未安装、未配置或执行失败时，不影响 Run / CodeTask 主流程
- 不引入外部工具的内部数据模型到主系统核心领域模型

## 3. AppLogger（内置进程日志）

### 3.1 位置

`packages/logger/src/index.ts` — 与 `StepLogger` 并列，单例导出 `appLogger`。

### 3.2 日志级别

| 级别 | 内容 |
|------|------|
| `error` | 致命错误：playwright 启动失败、AI 请求异常、task 执行抛出 |
| `warn` | 非致命异常：click/fill 失败、LLM 返回空、adapter 错误 |
| `info` | 业务关键点：run 创建/完成/失败、AI 调用耗时、task 执行状态、session 开始/结束 |
| `debug` | 细节：每个 playwright 操作（navigate/click/fill）、每个 tool call 记录 |

### 3.3 输出目标

- **控制台**：彩色人类可读，`error`/`warn` 走 stderr，其余走 stdout
- **文件**：NDJSON 格式，路径 `.zarb/logs/zarb.log`

### 3.4 配置

在 `.zarb/config.local.yaml` 中配置：

```yaml
log:
  level: info    # debug | info | warn | error，默认 info
  file: true     # false 则只输出控制台，不写文件
```

也可通过环境变量临时覆盖（优先级高于配置文件）：

```bash
ZARB_LOG_LEVEL=debug zarb
```

### 3.5 已接入的关键点

| 模块 | 日志内容 |
|------|---------|
| `bin.ts` | 启动参数、db 路径、log 文件路径、server 监听地址 |
| `server.ts` | 配置热更新（AI provider 切换） |
| `RunService` | run 创建、playwright 启动/完成/失败、AI 分析触发、run 取消 |
| `AIEngine` | 每次 AI 调用开始/完成（耗时）、HTTP 错误、token 用量（debug） |
| `CodeTaskService` | task 执行开始（agent/goal）、agent 完成（exitCode/耗时）、verify 结果 |
| `TestRunner` | playwright 进程启动、启动失败、整体汇总（total/passed/failed/skipped/耗时） |
| `ObservedHarness` | session 开始/完成（含耗时）、每个 tool call（debug） |
| `PlaywrightToolProvider` | navigate/click/fill 每个操作的目标+耗时+失败原因（debug） |
| `ExplorationAgent` | exploration 开始/结束汇总、LLM 决策失败警告 |

### 3.6 StepLogger 与 AppLogger 的区别

| | StepLogger | AppLogger |
|---|---|---|
| 用途 | Runner/Exploration 步骤结构化数据 | 进程级 + 业务流程运行日志 |
| 格式 | NDJSON，含 pageState/toolInput/toolOutput 等业务字段 | 控制台彩色 + 文件 NDJSON |
| 消费方 | UI 步骤时间线、业务数据查询 | 开发者/运维排查问题 |
| 路径 | `runs/<runId>/steps.ndjson`（per-run） | `logs/zarb.log`（全局） |

## 4. 外部观测集成（ObservabilityAdapter）

### 4.1 推荐接入对象

建议优先观测：

- `AgentHarness`
- `ExplorationAgent`
- `CodeRepairAgent`
- `CodexCliAgent`
- `KiroCliAgent`

### 4.2 接入方式

装饰器模式：

- `ObservedHarness` — 包装 `HarnessSessionManager`，转发生命周期事件到 `ObservabilityAdapter`
- `ObservabilityAdapter` 接口定义于 `packages/agent-harness/src/observability.ts`

`ObservedHarness` 负责：

1. 判断外部观测工具是否启用
2. 包装实际 harness session 生命周期
3. 记录 step、tool call、approval、resume、replay 的摘要
4. 将摘要写入系统事件或扩展记录

### 4.3 与 zai-xray 的关系

`zai-xray` 适合作为外部 AI tracing / metrics 工具使用。

推荐定位：

- `ai-regression-workbench` — 测试失败到修复提交的主业务闭环
- `zai-xray` — AI / harness 调用的 tracing、cost、latency、error metrics

集成方式：

- 在 `packages/agent-harness` 中定义 `ObservabilityAdapter` 接口
- `ObservedHarness` 仅依赖该接口，不直接耦合外部 provider SDK

参考：[zai-xray GitHub](https://github.com/Zack-Zz/zai-xray)

## 5. 建议记录的数据

外部观测工具建议只回填摘要：

- `enabled`、`provider`、`externalTraceId`
- `sessionId`、`agentName`
- `totalTokens`、`estimatedCost`、`latencyMs`
- `toolCallCount`、`summaryLink`

## 6. 错误处理

- 若外部观测工具不可用，记录 warning 事件即可
- 若包装执行失败，自动降级到原始 harness / code agent 执行
- `AppLogger` 本身的文件写入失败不影响主流程（appendFileSync 异常会被静默忽略）
