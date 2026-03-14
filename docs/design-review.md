# 设计评估报告与处置记录

> 评审范围：`docs/` 下全部设计文档（v2.1）
> 评审日期：2026-03-14

说明：

- 本文是针对 `v2.1` 设计稿的评审记录，保留其历史价值。
- 自 `v2.2` 起，部分高优先级建议已被吸收进主设计与分设计文档。
- 读取本报告时，应结合最新文档判断问题是否仍然成立。

---

## 总体评价

整体设计质量较高，思路清晰，覆盖面广。文档体系完整，从总设计到各模块细节均有对应文档，分层合理，接口抽象到位。对于一个"本地单机 AI 辅助回归修复工作台"来说，这套设计已经具备生产级骨架的基础。

以下按维度逐一评审，并给出改进建议。

## 处置结果（v2.2）

本轮已按以下原则吸收评审意见：

- 已采纳：
  HTTP API 契约与 `errorCode`、轮询优先、`PAUSED`、超时策略、`parentTaskId`、review 绑定 diff/patch hash、commit status、`Scenario` 正式模型、prompt 构建与裁剪、`system_events`、路径相对化约定、SQLite `WAL` 与迁移、敏感配置环境变量优先、UI 错误态与大数据量约束。
- 部分采纳：
  Orchestrator 没有在文档层强制拆成独立 `CodeTaskOrchestrator`，而是通过明确 `Orchestrator / AgentHarness / ReviewManager` 边界来减重；是否进一步拆分类保留到实现阶段。
- 已调整原建议：
  `report.port` 不再要求运行时重绑和 `redirectUrl` 跳转，改为“下次启动生效”。
- 新增扩展：
  在原 review 范围之外，补充了 `Agent Harness` 抽象，以及 `regression / exploration / hybrid` 双轨运行模型。

---

## 一、架构设计

### 优点

- 分层清晰：控制层 / 状态层 / 诊断层 / 执行层职责边界明确，不互相越权。
- 接口驱动：核心模块均通过接口交互，便于替换实现和单元测试。
- 状态机设计完整：Run 和 CodeTask 两条状态机覆盖了主流程的所有节点，包括异常状态。
- 降级策略明确：trace/log 查询失败不阻断主流程，体现了"可降级"的工程意识。
- 平台化预留合理：当前单体，但模块边界已为未来服务化拆分预留了空间。

### 问题与建议

**1. Orchestrator 职责偏重**

当前 Orchestrator 同时负责：Run 状态机推进、CodeTask 状态机推进、执行报告生成、事件写入、错误分级处理。职责过于集中，随着功能增长容易变成"上帝类"。

建议：
- 将 CodeTask 生命周期管理拆分为独立的 `CodeTaskOrchestrator` 或 `CodeTaskLifecycleManager`。
- 执行报告生成逻辑抽为独立的 `ExecutionReportBuilder`，由 Orchestrator 调用而非内嵌。

**2. 缺少 API 层设计文档**

`app-services-design.md` 定义了应用服务接口，`local-ui-design.md` 列出了 REST 路由，但两者之间缺少一份明确的 HTTP API 契约文档（请求/响应结构、错误码规范、版本策略）。

建议：
- 补充一份 `api-contract-design.md` 或 OpenAPI spec，明确 HTTP 层的错误码体系（如 `4xx` 业务错误的 code/message 结构）。
- 当前 `ActionResult` 只有 `success/message`，建议增加 `errorCode` 字段，便于前端做精确错误处理。

**3. 事件驱动与轮询混用，边界不清**

文档中同时提到了 SSE（`/events/stream`）和轮询（`cursor + limit`），但没有明确说明两者的使用场景和优先级。

建议：
- 明确第一阶段只用轮询，SSE 作为可选增强。
- 或者明确 SSE 为主推送通道，轮询作为降级方案。
- 避免前端实现时两套逻辑并存导致状态不一致。

---

## 二、领域模型设计

### 优点

- 核心对象划分合理：Run / TestResult / CorrelationContext / FailureAnalysis / CodeTask / Review / CommitRecord 覆盖了主业务链路。
- 三级遥测模型（ApiCallRecord / UiActionRecord / FlowStepRecord）设计细致，关联关系清晰。
- DTO 分层（Summary / Detail）体现了良好的 API 设计意识。

### 问题与建议

**1. FailureAnalysis 与 CodeTask 的关系过于线性**

当前设计是"一个 testcase 失败 -> 一次 FailureAnalysis -> 一个 CodeTask"。但实际场景中：
- 同一个 testcase 可能多次分析（retry-analysis）
- 同一次分析可能产生多个修复方向（如同时修复测试代码和业务代码）
- 一个 CodeTask 失败后 retry 会产生新的执行记录

建议：
- 明确 `FailureAnalysis` 与 `CodeTask` 是 1:N 关系（一次分析可产生多个 CodeTask）。
- `CodeTask` 增加 `parentTaskId` 字段，支持 retry 时的版本追溯。
- `FailureAnalysis` 增加 `version` 或 `retryCount` 字段，区分多次分析结果。

**2. Review 模型过于简单**

当前 `Review` 只有 `decision / comment`，缺少：
- 审查的具体内容快照（diff hash 或 patch hash），避免"审查的是 A，提交的是 B"。
- 多轮 review 的版本关联（retry 后的新 diff 对应新的 review 记录）。

建议：
- `Review` 增加 `diffHash` 或 `patchHash` 字段，与实际审查内容绑定。
- `Review` 增加 `codeTaskVersion` 字段，关联到具体执行轮次。

**3. CommitRecord 缺少状态字段**

当前 `CommitRecord` 没有 `status` 字段，无法区分"commit 命令已发出"和"commit 实际成功落到 git"。

建议：
- 增加 `status: 'pending' | 'committed' | 'failed'` 字段。
- 增加 `errorMessage` 字段，记录 git commit 失败原因。

**4. 缺少 Scenario 模型的正式定义**

`test-assets-design.md` 提到了 `Scenario` 元数据模型，但 `design.md` 的核心领域模型章节没有包含它。`TestResult` 中有 `scenarioId` 字段，但 Scenario 本身的结构没有在主设计文档中定义。

建议：
- 在主设计文档的领域模型章节补充 `Scenario` 的正式定义。
- 明确 `Scenario` 与 `TestCase` 的关系（1:N）。

---

## 三、状态机设计

### 优点

- Run 状态机覆盖了完整的执行链路，包括降级路径（trace/log 失败继续）。
- CodeTask 状态机的 `COMMIT_PENDING -> COMMITTED` 分离设计很好，避免了 review 通过即自动提交的风险。
- 控制动作（pause/resume/cancel/retry）定义清晰。

### 问题与建议

**1. Run 状态机缺少 PAUSED 状态**

文档中提到了 `pause` 控制动作，但 `RunStatus` 枚举中没有 `PAUSED` 状态。当前设计通过 `pauseRequested` 字段标记暂停意图，但这意味着 UI 无法直接从状态字段判断 run 是否处于暂停中。

建议：
- 增加 `PAUSED` 状态，或者明确说明"暂停"是通过 `pauseRequested=true + 当前步骤完成后停止"来实现的，并在 UI 层做好状态展示的映射逻辑。

**2. CodeTask retry 路径不够清晰**

`AWAITING_REVIEW -> RUNNING_CODE_TASK`（review retry）这条路径在 Run 状态机中存在，但 CodeTask 状态机中 `SUCCEEDED -> RUNNING`（review retry）这条路径意味着 CodeTask 会从 `SUCCEEDED` 回退到 `RUNNING`，这在语义上有些奇怪——一个已经"成功"的任务被重新执行。

建议：
- retry 时创建新的 CodeTask 记录（带 `parentTaskId`），而不是让同一个 CodeTask 状态回退。
- 这样可以保留每次执行的完整历史，也更符合审计要求。

**3. 缺少超时机制设计**

状态机中没有提到超时处理：
- AI 分析超时怎么处理？
- Code Agent 执行超时怎么处理？
- 用户长时间不审批，run 是否会自动过期？

建议：
- 补充超时策略设计，至少明确：哪些步骤有超时限制、超时后进入什么状态、是否支持超时后重试。

---

## 四、存储设计

### 优点

- SQLite + 本地文件系统的双存储策略合理：结构化数据走 DB，大文件走文件系统。
- 存储映射文档（`storage-mapping-design.md`）非常详细，字段级映射矩阵是很好的实践。
- 清理策略以 `runId` 为单元，逻辑清晰，事务版 SQL 也已提供。
- 索引建议覆盖了主要查询路径。

### 问题与建议

**1. SQLite 并发写入风险**

当前设计是单进程本地运行，但 Orchestrator 的多个步骤（trace 查询、log 查询、AI 分析）可能并发写入 SQLite。SQLite 的 WAL 模式可以支持并发读，但并发写仍有锁竞争风险。

建议：
- 明确说明 SQLite 使用 WAL 模式（`PRAGMA journal_mode=WAL`）。
- 对于高频写入的表（`api_call_records`、`ui_action_records`、`run_events`），考虑批量写入而非逐条写入。
- 明确写入队列策略，避免并发写冲突。

**2. `run_events` 表承载了 settings 变更事件，职责混用**

`storage-mapping-design.md` 中提到 settings 变更写入 `run_events` 表（`event_type=SETTINGS_UPDATED`），但 settings 变更与 run 没有直接关联，强行写入 `run_events` 会导致：
- 按 `runId` 查询事件时混入全局配置事件。
- 清理 run 时可能误删 settings 变更历史。

建议：
- 新增独立的 `system_events` 表，用于记录非 run 相关的全局事件（settings 变更、系统初始化等）。

**3. 文件路径存储为相对路径还是绝对路径未明确**

`code_tasks` 表中的 `diff_path`、`patch_path`、`raw_output_path` 等字段，以及 `test_results` 中的 `screenshot_path` 等，没有明确说明存储的是绝对路径还是相对于 `tool-workspace` 的相对路径。

建议：
- 统一规定：所有路径字段存储相对于 `<tool-workspace>/data` 的相对路径。
- 在读取时由 Repository 层统一拼接绝对路径，避免工具目录迁移后路径失效。

---

## 五、AI Engine 与 Code Agent 设计

### 优点

- AI 只负责分析和生成草稿，不直接执行修改，Human-in-the-Loop 原则落实到位。
- CodexCliAgent / KiroCliAgent 的分工定位清晰（headless vs interactive）。
- 权限分级（L1/L2/L3）设计合理，默认最小权限。
- `CodeTaskPolicy` 作为独立接口，便于扩展权限规则。

### 问题与建议

**1. AI Engine 的 prompt 工程没有设计**

文档定义了 `FailureContext` 输入结构，但没有说明如何将这些数据组织成 AI prompt，也没有提到：
- prompt 模板管理（硬编码还是可配置）
- 不同 AI provider 的 prompt 差异处理
- token 限制下的上下文裁剪策略（当 trace/log 数据量很大时）

建议：
- 补充 AI Engine 的 prompt 构建策略，至少说明上下文裁剪规则（如 log 只取最近 N 条错误）。
- 考虑将 prompt 模板外置为可配置文件，便于调优。

**2. Code Agent 的输出解析依赖不稳定**

文档提到"不要假设两个 agent 都具备同样稳定的 machine-readable 输出能力"，但 `CodeChangeResult` 接口中的 `changedFiles`、`diffPath` 等字段需要从 agent 输出中解析。如果 agent 输出格式不稳定，这些字段可能为空。

建议：
- 明确"以工作区 diff 为准"的实现方案：agent 执行完成后，由系统自行执行 `git diff` 生成 diff，而不依赖 agent 自报的 changedFiles。
- 这样即使 agent 输出格式变化，diff 和 patch 的生成仍然可靠。

**3. verify 命令的失败处理不明确**

`verificationCommands` 执行失败时，CodeTask 应该进入什么状态？文档中 `VERIFYING -> FAILED` 这条路径存在，但没有说明：
- verify 失败是否允许用户强制 review（跳过 verify）？
- verify 失败后是否自动触发 retry？

建议：
- 明确 verify 失败的处理策略，至少提供"强制 review（忽略 verify 失败）"的选项，避免因 verify 命令配置错误导致整个修复流程卡死。

---

## 六、配置体系设计

### 优点

- 配置分层（环境变量 > 本地文件 > 默认值）是标准做法。
- `SettingsSnapshot` 带版本号，防并发覆盖的设计很好。
- 即时生效语义定义清晰（查询类立即生效，正在执行的 run 不回溯）。
- 诊断关联键可配置，避免了硬编码 header 名的问题。

### 问题与建议

**1. 配置热更新的广播机制没有详细设计**

文档提到"保存配置后向 trace/log/diagnostics/ai/codeAgent 广播最新快照"，但没有说明广播机制的实现方式：
- 是事件总线？直接函数调用？还是模块重新初始化？
- 广播失败怎么处理？

建议：
- 补充配置广播的实现方案，推荐使用简单的观察者模式（`ConfigManager.subscribe(module, callback)`），各模块注册回调，配置更新时依次通知。

**2. `report.port` 更新的服务重绑逻辑复杂**

文档提到端口更新后"服务端应重绑端口并返回 redirectUrl"，但端口重绑在 Node.js 中需要关闭旧 HTTP server 再启动新的，这个过程中会有短暂不可用窗口，且可能影响正在进行的 run。

建议：
- 明确端口变更只在下次启动时生效（`nextRunOnlyKeys` 包含 `report.port`），不做运行时热重绑。
- 或者明确热重绑的实现方案和不可用窗口的处理策略。

**3. 敏感配置（AI API Key）的存储安全没有提及**

`config.local.yaml` 中会包含 AI provider 的 API Key，但文档没有提到：
- API Key 是否加密存储？
- 是否支持从环境变量读取（避免明文写入文件）？

建议：
- 明确 API Key 等敏感配置优先从环境变量读取，`config.local.yaml` 中只存占位符或不存。
- 在 `zarb doctor` 中增加对敏感配置安全性的检查提示。

---

## 七、Local UI 设计

### 优点

- 定位清晰：工作台而非纯报告查看器，操作与查看统一。
- 组件拆分合理，`EventTimeline`、`ExecutionReportPanel`、`ApiCallTable` 等核心组件职责明确。
- 设置页的交互设计（先校验再保存、展示生效结果）体现了良好的用户体验意识。
- i18n 支持从第一版就纳入，避免后期改造成本。

### 问题与建议

**1. 实时刷新策略不明确**

Run 执行过程中，UI 需要实时展示状态变化和事件时间线。文档提到了轮询和 SSE 两种方式，但没有明确：
- 轮询间隔是多少？
- 哪些页面需要实时刷新（Run Detail 肯定需要，Run List 是否需要）？
- 用户离开页面后是否停止轮询？

建议：
- 明确轮询策略：Run 处于活跃状态时每 2-3 秒轮询一次，进入终态后停止。
- 第一阶段统一用轮询，SSE 作为后续优化。

**2. 错误状态的 UI 展示没有设计**

文档详细描述了正常流程的 UI，但对于错误场景（run 失败、code agent 执行失败、网络错误等）的 UI 展示没有设计：
- 错误信息如何展示？
- 用户可以做什么操作（重试、忽略、查看详情）？

建议：
- 补充错误状态的 UI 设计，至少定义统一的错误展示组件和操作入口。

**3. 大数据量下的性能没有考虑**

`ApiCallTable` 在一次 run 中可能有数百甚至数千条接口记录，`EventTimeline` 也可能有大量事件。文档没有提到分页或虚拟滚动策略。

建议：
- `ApiCallTable` 和 `EventTimeline` 需要支持分页或虚拟滚动。
- 事件时间线的增量拉取（cursor + limit）已有设计，前端需要实现懒加载。

---

## 八、打包与分发设计

### 优点

- CLI 命令名 `zarb` 简洁，首次运行自动初始化的体验设计合理。
- 两种目录模式（项目内 vs 用户目录）覆盖了主要使用场景。
- `zarb doctor` 的检查项列表全面。
- 第一阶段不做桌面壳的决策正确，避免过早引入复杂性。

### 问题与建议

**1. 多版本升级的数据迁移没有设计**

当工具升级时，SQLite schema 可能发生变化（新增表、新增字段）。文档没有提到数据库迁移策略。

建议：
- 引入数据库迁移机制（如 `better-sqlite3-migrations` 或自定义迁移脚本）。
- `zarb` 启动时自动检测并执行待执行的迁移脚本。
- 迁移脚本按版本号命名，已有 `scripts/sql/` 目录可以复用。

**2. 多个 target workspace 的切换没有设计**

当前设计假设同一时间只有一个 `targetProjectPath`，但用户可能需要在多个项目之间切换。

建议：
- 第一阶段维持单 target workspace 的设计，但在 UI 上明确展示当前 target，并提供快速切换入口（切换时更新配置）。
- 或者考虑支持"workspace profile"概念，允许保存多个配置快照并快速切换。

---

## 九、可观测性设计

### 优点

- 外部观测工具（zai-xray）只作为旁路接入，不侵入主流程，设计原则正确。
- 装饰器模式（`ObservedCodeAgent`）是接入外部观测的标准做法。
- 事件模型覆盖了主要业务节点，事件类型命名规范统一。

### 问题与建议

**1. 工具自身的可观测性不足**

文档关注的是"被测系统的 trace/log"，但对工具自身的运行状态（如 AI 调用耗时、code agent 执行耗时、SQLite 查询耗时）没有提到内部 metrics 或性能监控。

建议：
- 在结构化日志中增加关键操作的耗时记录（AI 调用、code agent 执行、DB 查询）。
- `zarb doctor` 可以增加"上次运行性能摘要"的展示。

**2. 事件 payload 结构没有定义**

`run_events` 表中的 `payload_json` 字段存储事件详情，但文档没有定义各事件类型的 payload 结构。这会导致实现时各模块自行定义 payload，后续难以统一查询和展示。

建议：
- 为每种事件类型定义标准 payload schema，至少覆盖高频事件（`TESTCASE_FAILED`、`CODE_TASK_CREATED`、`REVIEW_ACCEPTED` 等）。

---

## 十、整体设计缺口汇总

以下是跨文档的设计缺口，需要补充：

| 缺口 | 影响 | 优先级 |
|------|------|--------|
| 缺少 HTTP API 错误码规范 | 前端无法做精确错误处理 | 高 |
| CodeTask retry 应创建新记录而非状态回退 | 审计历史不完整 | 高 |
| Run 状态机缺少 PAUSED 状态 | UI 状态展示不准确 | 中 |
| 状态机缺少超时机制 | 流程可能永久卡住 | 中 |
| AI prompt 构建策略未设计 | 实现时各自为政，难以调优 | 中 |
| 事件 payload schema 未定义 | 事件数据难以统一查询 | 中 |
| 数据库迁移机制未设计 | 升级时可能破坏现有数据 | 中 |
| 敏感配置安全存储未提及 | API Key 明文存储有安全风险 | 中 |
| 路径字段相对/绝对未统一 | 工具目录迁移后路径失效 | 中 |
| settings 变更写入 run_events 职责混用 | 清理 run 时可能误删配置历史 | 低 |
| 大数据量 UI 性能未考虑 | 接口记录多时页面卡顿 | 低 |
| Scenario 模型未在主文档定义 | 领域模型不完整 | 低 |

---

## 十一、总结

这套设计文档的完整度和质量在同类项目中属于较高水平。核心设计原则（Local-First、Human-in-the-Loop、Interruptible by Design、Observable by Default）贯穿始终，没有出现原则与实现脱节的情况。

主要需要改进的方向：

1. **Orchestrator 职责拆分**：避免单点膨胀，提前做好内部分层。
2. **CodeTask retry 语义**：用新记录替代状态回退，保证审计完整性。
3. **状态机补全**：增加 PAUSED 状态和超时机制。
4. **AI prompt 工程**：补充上下文裁剪和 prompt 模板管理策略。
5. **数据库迁移**：在第一阶段就引入迁移机制，避免后期数据丢失风险。
6. **安全性**：明确敏感配置（API Key）的存储和读取方式。

这些问题大多不影响第一阶段 MVP 的启动，但建议在开始编码前先把高优先级缺口（HTTP 错误码规范、CodeTask retry 语义、数据库迁移）补充到设计文档中，避免实现后再改造的成本。
