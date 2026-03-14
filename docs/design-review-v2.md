# 设计评估报告 v2

> 评审范围：`docs/` 下全部设计文档（v2.2，含新增 `agent-harness-design.md`、`api-contract-design.md`）
> 评审日期：2026-03-14
> 对比基准：上一版评审报告 `design-review.md`

---

## 总体评价

相比上一版，本轮修订质量明显提升。上一版评审中提出的大多数高优先级问题已得到有效回应：

- `ActionResult` 补充了 `errorCode` 和 `retryable` 字段
- `PAUSED` 状态已加入 Run 状态机
- CodeTask retry 语义已明确为"创建新子任务"而非状态回退
- `system_events` 表已从 `run_events` 中独立出来
- 数据库迁移机制已纳入 `packaging-design.md` 和 `storage-mapping-design.md`
- 敏感配置（API Key）已明确优先从环境变量读取
- 路径字段已统一为相对路径存储
- `report.port` 变更已明确为"下次启动生效"，不做运行时热重绑
- 新增 `agent-harness-design.md` 解决了 Orchestrator 职责过重的问题
- 新增 `api-contract-design.md` 补全了 HTTP 契约层

这是一套已经具备较强工程落地基础的设计文档体系。以下是本轮评审发现的新问题和残留问题。

---

## 一、新增模块评审

### 1.1 Agent Harness 设计

总体评价：设计思路清晰，职责边界划分合理，Harness 与 Orchestrator 的分工明确。

**问题 1：ExplorationAgent 的停止条件设计不完整**

`agent-harness-design.md` 提到 `ExplorationAgent` 负责"决定探测目标、下一步探针和停止条件"，但没有定义停止条件的具体规则。`HarnessPolicy` 中有 `sessionBudgetMs`、`maxSteps`、`maxPages`，但这些是硬性预算，不是智能停止条件。

实际场景中，探测可能需要在"发现足够多 finding"或"覆盖了所有 focusAreas"时提前停止，而不是等预算耗尽。

建议：
- 在 `HarnessPolicy` 中增加 `stopConditions` 字段，支持配置"最小 finding 数量达到即停"或"所有 focusAreas 覆盖即停"等策略。
- 或者在 `ExplorationAgent` 的接口中明确 `shouldStop(context): boolean` 的决策逻辑。

**问题 2：Harness session 的 pause/resume 与 Run 状态机的协调没有设计**

`orchestrator-design.md` 中 `pauseRun` 会让 Run 进入 `PAUSED`，但如果此时 Harness 正在运行一个 exploration session，Harness session 如何响应 pause 信号？是立即中断还是等当前 step 完成？

建议：
- 明确 Harness session 的 pause 语义：收到 pause 信号后，等当前 tool call 完成，保存 checkpoint，然后挂起。
- 明确 Orchestrator 在 pause 时需要向 Harness 发送什么信号，以及 Harness 的响应协议。

**问题 3：`agent_sessions` 表缺少 `attempt` 字段**

CodeTask retry 会创建新的子任务，每个子任务可能对应一个新的 Harness session。但 `agent_sessions` 表中没有 `attempt` 字段，无法区分同一 CodeTask 的多次执行对应的 session。

建议：
- `agent_sessions` 增加 `attempt` 字段，与 `code_tasks.attempt` 对应。
- 或者通过 `task_id + attempt` 联合索引来关联。

### 1.2 API Contract 设计

总体评价：补充了 HTTP 层的错误码规范和状态码建议，解决了上一版的主要缺口。

**问题 1：错误码列表不完整**

`api-contract-design.md` 中的错误码列表只覆盖了部分场景，缺少：
- `RUN_NOT_FOUND`、`CODE_TASK_NOT_FOUND` 等资源不存在错误
- `RUN_ALREADY_COMPLETED`、`RUN_ALREADY_CANCELLED` 等状态冲突错误
- `HARNESS_SESSION_TIMEOUT`、`AGENT_EXECUTION_FAILED` 等执行层错误
- `COMMIT_FAILED`（git 操作失败）

建议：
- 补全错误码列表，至少覆盖每个业务对象的"不存在"和"状态不合法"两类错误。
- 或者明确错误码的命名规范（`<OBJECT>_<CONDITION>`），让实现层自行扩展。

**问题 2：分页接口没有统一规范**

`GET /runs` 返回 `RunSummary[]`，但没有说明是否支持分页。随着 run 数量增长，不分页的列表接口会有性能问题。

建议：
- 统一列表接口的分页规范，例如 `?page=1&pageSize=20` 或 `?cursor=<id>&limit=20`。
- 明确 `GET /runs`、`GET /code-tasks` 等列表接口是否支持分页，以及默认返回数量上限。

---

## 二、状态机设计（残留与新问题）

### 2.1 PAUSED 状态的恢复路径过于细化

新版状态机图中，`PAUSED` 到各个状态的恢复路径被拆分为多条（`resume regression`、`resume exploration planning`、`resume exploration`、`resume diagnostics`、`resume code task`），这意味着 `resumeRun` 接口需要知道"从哪个状态恢复到哪个状态"。

但 `Orchestrator` 接口中 `resumeRun(runId)` 只接受 `runId`，没有携带恢复目标状态。

建议：
- 明确 `resumeRun` 的语义是"从最近持久化的稳定状态继续"，由 Orchestrator 内部根据 `pausedAtStatus` 字段决定恢复路径，不需要调用方指定。
- 状态机图中的多条恢复路径是内部实现细节，不需要暴露给外部接口。

### 2.2 超时机制有设计但缺少状态映射

`orchestrator-design.md` 第 7 节已补充了超时策略，这是上一版的改进。但文档只说"超时后进入明确状态"，没有说明具体进入哪个状态。

建议：
- 明确各类超时的目标状态：
  - `test runner` 超时 → `FAILED`（blocking）
  - `trace/log` 查询超时 → `RUN_STEP_DEGRADED` 事件 + 继续（non-blocking）
  - `AI analysis` 超时 → `RUN_STEP_DEGRADED` 事件 + 继续（non-blocking）
  - `harness session` 超时 → CodeTask 进入 `FAILED`
  - `verify` 超时 → CodeTask 进入 `FAILED`

### 2.3 Run 状态机中 `AWAITING_REVIEW -> AWAITING_CODE_ACTION` 路径语义模糊

状态机图中有 `AWAITING_REVIEW --> AWAITING_CODE_ACTION: review retry -> 新建 CodeTask`，但这条路径的语义是"Run 回到等待代码操作的状态"，而实际上新建的 CodeTask 应该直接进入 `PENDING_APPROVAL`，Run 也应该直接进入 `AWAITING_CODE_ACTION`。

问题在于：如果有多个 CodeTask 并行（同一次 run 的多个失败用例各自有 CodeTask），其中一个 retry 时，Run 是否应该回到 `AWAITING_CODE_ACTION`？还是保持在 `AWAITING_REVIEW` 等待其他 CodeTask？

建议：
- 明确多 CodeTask 并行时 Run 状态的推进规则：是"所有 CodeTask 都完成才推进 Run 状态"，还是"每个 CodeTask 独立推进"。
- 如果是后者，Run 状态机可能需要引入"部分完成"的中间状态，或者 Run 状态只跟踪整体进度而不跟踪单个 CodeTask。

---

## 三、领域模型（残留与新问题）

### 3.1 Finding 与 FailureAnalysis 的关系不清晰

`design.md` 第 7.4.2 节定义了 `Finding`，`ai-engine-design.md` 的输出中也有 `FindingSummary`。但两者的关系没有明确：
- `Finding` 是 exploration 专属的，还是 regression 失败分析也可以产生 `Finding`？
- `FailureAnalysis` 和 `Finding` 是并列关系还是包含关系？
- `storage-mapping-design.md` 中 `findings` 表的 `run_id` 和 `session_id` 字段说明它来自 exploration，但 `ai-engine-design.md` 的 `summarizeFindings` 接口接受 `ExplorationFindingContext`，暗示 Finding 只来自 exploration。

建议：
- 明确 `Finding` 的来源：只来自 exploration session，还是 regression 失败分析也可以产生 Finding。
- 如果两者都可以产生 Finding，需要在 `findings` 表中增加 `source: 'exploration' | 'regression'` 字段。

### 3.2 GeneratedTestDraft 的生命周期没有设计

`ai-engine-design.md` 的输出中有 `GeneratedTestDraft`，`storage-mapping-design.md` 中也有 `generated-tests/<taskId>/candidate.spec.ts`。但 `GeneratedTestDraft` 的完整生命周期没有设计：
- 候选测试如何晋升为正式测试？
- 晋升需要哪些审批步骤？
- 晋升后存储在哪里？
- 候选测试是否可以直接执行（在 `includeGeneratedInRuns=true` 时）？

建议：
- 补充 `GeneratedTestDraft` 的生命周期设计，至少定义"草稿 -> 待审批 -> 晋升为正式测试"的流程。
- 或者明确第一阶段只生成候选测试文件，晋升流程后置。

### 3.3 Scenario 模型在主文档中有定义，但存储映射不完整

`design.md` 第 7.2.1 节补充了 `Scenario` 的定义，`storage-mapping-design.md` 中也有 `scenarios` 表。但 `scenarios` 表的字段只有 `scenario_id`、`name`、`entry_urls_json`，与 `test-assets-design.md` 中 `Scenario` 的完整字段（包括 `suite`、`tags`、`sourceType` 等）不一致。

建议：
- 对齐 `scenarios` 表字段与 `Scenario` 领域模型字段。
- 明确 `Scenario` 是由谁创建的（手工定义？AI 从 exploration 中提取？）。

---

## 四、存储设计（残留与新问题）

### 4.1 `code_tasks` 表缺少 `attempt` 字段的 DDL

`app-services-design.md` 中 `CodeTaskSummary` 有 `taskVersion` 字段，文档注释说"对应持久层中的 `code_tasks.attempt`"，`code-task-design.md` 也提到了 `taskVersion`。但 `design.md` 第 13.6 节的 `code_tasks` 表 DDL 中没有 `attempt` 字段，`storage-mapping-design.md` 的映射矩阵中也没有提到。

建议：
- 在 `code_tasks` 表 DDL 中补充 `attempt INTEGER NOT NULL DEFAULT 1` 字段。
- 在 `storage-mapping-design.md` 的映射矩阵中补充 `attempt` 字段的说明。

### 4.2 `agent_sessions` 表没有对应的 DDL

`storage-mapping-design.md` 的映射矩阵中有 `agent_sessions` 表，索引 DDL 中也有对应索引，但 `design.md` 的 SQLite 表设计章节（第 13 节）没有 `agent_sessions` 的建表语句。

建议：
- 在 `design.md` 第 13 节补充 `agent_sessions` 表的 DDL。
- 或者在 `agent-harness-design.md` 中补充该表的 DDL。

### 4.3 `findings` 表没有对应的 DDL

同上，`storage-mapping-design.md` 映射矩阵中有 `findings` 表，但没有建表语句。

建议：
- 补充 `findings` 表的 DDL，至少包含 `id`、`run_id`、`session_id`、`category`、`severity`、`page_url`、`summary`、`created_at` 字段。

### 4.4 `system_events` 表的查询接口没有设计

`storage-mapping-design.md` 中 `system_events` 表的查询入口标注为 `GET /system/events（后续）`，但 `api-contract-design.md` 中没有这个接口，`app-services-design.md` 中也没有对应的 Service 方法。

这意味着 settings 变更历史、迁移记录等系统事件目前无法通过 API 查询，只能直接查 DB。

建议：
- 明确第一阶段 `system_events` 只写不读（仅用于审计和排障），不提供查询 API。
- 或者在 `BootstrapService` 或新增的 `SystemService` 中提供基础查询能力。

### 4.5 清理 SQL 中缺少 `scenarios` 和 `findings` 表

`storage-mapping-design.md` 第 9.2 节的清理 SQL 中没有删除 `findings` 表的语句（`findings` 有 `run_id` 字段，应该随 run 清理）。`scenarios` 表是否随 run 清理也没有说明。

建议：
- 在清理 SQL 中补充 `DELETE FROM findings WHERE run_id = :run_id`。
- 明确 `scenarios` 的清理策略（scenarios 是跨 run 共享的，不应随单个 run 清理）。

---

## 五、Exploration 模式设计（新增模块）

### 5.1 Exploration 模式的 Run 状态机路径不完整

`design.md` 第 8.1 节说明了 `exploration` 模式直接进入 `PLANNING_EXPLORATION`，但 `PLANNING_EXPLORATION` 阶段的职责没有明确：
- 是 AI 生成探测计划？还是 Harness 初始化 session？
- 如果 AI 生成计划失败，进入什么状态？
- `PLANNING_EXPLORATION` 是否可以被 pause？（状态机图中有这条路径，但语义不清楚）

建议：
- 明确 `PLANNING_EXPLORATION` 的具体职责和失败处理。
- 如果 planning 只是 Harness session 初始化，可以考虑合并到 `RUNNING_EXPLORATION` 的前置步骤，不单独作为一个 Run 状态。

### 5.2 Hybrid 模式的 exploration 预算与 regression 结果的关联没有设计

`hybrid` 模式先跑 regression，再做 exploration。但文档没有说明：
- exploration 阶段是否会参考 regression 的失败结果来决定探测方向？
- 如果 regression 全部通过，exploration 是否仍然执行？
- exploration 的 `focusAreas` 是否可以由 regression 失败结果自动推导？

建议：
- 明确 `hybrid` 模式中 regression 结果对 exploration 的影响策略，至少说明"regression 失败时 exploration 优先覆盖失败相关路径"。

### 5.3 Exploration 产出的候选测试与现有测试的去重没有设计

exploration 可能发现与现有测试重叠的场景，并生成重复的候选测试。文档没有提到去重策略。

建议：
- 明确候选测试的去重规则，例如基于 `scenarioId + pageUrl + actionSequence` 的相似度判断。
- 或者明确第一阶段不做去重，由人工 review 时判断。

---

## 六、仓库结构与模块映射（新问题）

### 6.1 `agent-harness` 没有对应的 `apps/` 目录

`design.md` 第 6.1 节的仓库结构中没有 `apps/agent-harness/` 目录，但 `agent-harness-design.md` 是一个独立的模块设计文档，说明它应该是一个独立的 app 或 package。

建议：
- 在仓库结构中补充 `apps/agent-harness/` 或 `packages/agent-harness/`。
- 明确 `AgentHarness` 是 app（有独立进程入口）还是 package（被其他 app 引用）。

### 6.2 `ExplorationAgent` 的代码位置没有明确

`ExplorationAgent` 是一个独立的 Agent 角色，但文档没有说明它的代码放在哪里：
- 是 `apps/ai-engine/` 的一部分？
- 还是 `apps/agent-harness/` 的一部分？
- 还是独立的 `apps/exploration-agent/`？

建议：
- 明确 `ExplorationAgent` 的代码归属，避免实现时各自放置导致依赖混乱。

---

## 七、配置体系（残留问题）

### 7.1 `exploration` 配置项在 `PersonalSettings` 中是可选的，但没有默认值

`app-services-design.md` 中 `PersonalSettings.exploration` 是可选字段，但没有说明默认值。如果用户没有配置 `exploration`，`exploration` 模式的 `maxSteps`、`maxPages`、`allowedHosts` 等参数从哪里取？

建议：
- 在 `config.default.yaml` 中补充 `exploration` 的默认值。
- 或者在 `StartRunInput.exploration` 中明确哪些字段是必填的（`startUrls` 和 `maxSteps` 应该是必填）。

### 7.2 配置热更新的观察者注册时机没有说明

`packages/config` 负责配置热更新广播，但文档没有说明各模块何时注册观察者：
- 是在 `BootstrapService.bootstrap()` 时统一注册？
- 还是各模块自行在初始化时注册？
- 如果模块在配置更新后才初始化（懒加载），如何保证它能收到最新配置？

建议：
- 明确配置观察者的注册时机和生命周期管理策略。

---

## 八、跨文档一致性问题

以下是跨文档发现的不一致，需要对齐：

### 8.1 `taskVersion` vs `attempt` 命名不统一

- `app-services-design.md` 中 `CodeTaskSummary.taskVersion` 注释说"对应持久层中的 `code_tasks.attempt`"
- `code-task-design.md` 中也使用 `taskVersion`
- 但 `design.md` 第 13.6 节的 DDL 中没有这个字段

三处文档用了不同名称，且 DDL 缺失。建议统一为一个名称，并在 DDL 中补充。

### 8.2 `SubmitReviewInput.codeTaskVersion` 与 `ReviewRecord.codeTaskVersion` 的语义

`app-services-design.md` 中 `SubmitReviewInput` 有 `codeTaskVersion` 字段，`ReviewRecord` 也有 `codeTaskVersion`。但 `code-task-design.md` 中没有提到这个字段，`reviews` 表的 DDL（`design.md` 第 13.7 节）也没有 `code_task_version` 字段。

建议：
- 在 `reviews` 表 DDL 中补充 `code_task_version INTEGER` 字段。
- 在 `code-task-design.md` 中明确 review 与 attempt 的绑定关系。

### 8.3 `RunSummary.scopeType` 在 exploration 模式下的值

`app-services-design.md` 中 `RunSummary.scopeType` 是可选的（`?`），`StartRunInput` 中 `selector` 也是可选的。但 `design.md` 第 12.1 节的 `test_runs` 表中 `scope_type` 和 `scope_value` 没有标注为可空。

建议：
- 明确 exploration 模式下 `scope_type` 的值（可以是 `'exploration'`），或者在 DDL 中标注为可空。

### 8.4 `RunDetail.findings` 与 `GET /runs/:runId/findings` 接口的关系

`app-services-design.md` 中 `RunDetail` 有 `findings` 字段（内嵌摘要），`local-ui-design.md` 中有 `GET /runs/:runId/findings` 接口（可选，可先内嵌在 RunDetail）。但 `api-contract-design.md` 中没有这个接口。

建议：
- 明确第一阶段 findings 是内嵌在 `RunDetail` 中还是独立接口。
- 如果内嵌，`api-contract-design.md` 不需要单独列出；如果独立，需要补充到 API 契约中。

---

## 九、整体缺口汇总（本轮新发现）

| 缺口 | 影响 | 优先级 |
|------|------|--------|
| `agent_sessions` 表缺少 DDL | 实现时无建表依据 | 高 |
| `findings` 表缺少 DDL | 实现时无建表依据 | 高 |
| `code_tasks` 表缺少 `attempt` 字段 | retry 语义无法落库 | 高 |
| `reviews` 表缺少 `code_task_version` 字段 | review 与 attempt 绑定无法落库 | 高 |
| Harness pause/resume 与 Orchestrator 的协调协议 | 实现时两侧各自为政 | 高 |
| 错误码列表不完整（缺少资源不存在、状态冲突类） | 前端无法覆盖所有错误场景 | 中 |
| 列表接口缺少分页规范 | 数据量大时性能问题 | 中 |
| `PLANNING_EXPLORATION` 状态职责不清 | 实现时边界模糊 | 中 |
| Hybrid 模式 exploration 与 regression 结果的关联策略 | 探测方向不明确 | 中 |
| `ExplorationAgent` 代码归属不明确 | 实现时放置混乱 | 中 |
| `agent-harness` 在仓库结构中缺失 | 项目初始化时遗漏 | 中 |
| `exploration` 配置默认值缺失 | 未配置时行为不确定 | 中 |
| `Finding` 来源（exploration vs regression）不明确 | 数据模型设计歧义 | 中 |
| `GeneratedTestDraft` 生命周期未设计 | 候选测试晋升流程缺失 | 中 |
| 超时机制缺少具体目标状态映射 | 超时后状态不确定 | 中 |
| 清理 SQL 缺少 `findings` 表 | 清理后残留孤儿数据 | 低 |
| `system_events` 查询接口未明确 | 系统事件无法通过 API 查询 | 低 |
| `Scenario` 表字段与领域模型不一致 | 存储与模型脱节 | 低 |
| 候选测试去重策略未设计 | exploration 可能产生大量重复候选 | 低 |

---

## 十、总结

本轮修订解决了上一版评审中的大多数核心问题，整体设计质量已达到较高水平。新增的 `agent-harness-design.md` 和 `api-contract-design.md` 填补了两个重要空白，exploration 模式的引入也让系统的能力边界更清晰。

本轮评审发现的问题主要集中在三个方向：

1. **新增模块的细节补全**：`agent_sessions`、`findings` 表的 DDL 缺失，`code_tasks.attempt` 字段未落库，这些是开始编码前必须补充的。

2. **Exploration 模式的设计深度不足**：`PLANNING_EXPLORATION` 状态职责模糊，hybrid 模式的关联策略未设计，`ExplorationAgent` 代码归属不明确。这些问题如果不提前明确，实现时容易出现模块边界混乱。

3. **跨文档一致性**：`taskVersion/attempt` 命名不统一，`reviews` 表缺少 `code_task_version` 字段，这类问题在实现时会导致前后端对不上。

建议在开始编码前优先解决高优先级缺口（DDL 补全、Harness pause 协议、attempt 字段落库），中优先级问题可以在对应模块开发前解决。
