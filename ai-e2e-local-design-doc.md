# AI 自动化回归测试本地版设计文档（Local-First, Platform-Ready）

## 1. 文档信息

- 文档名称：AI 自动化回归测试本地版设计文档
- 文档版本：v1.1
- 目标形态：本地单体部署、模块化代码结构、轻量数据存储、平台化可演进
- 主要用途：作为 Codex / 开发者的实施输入，直接用于项目初始化与第一阶段开发

---

## 2. 项目目标

### 2.1 背景

当前希望基于 Playwright 构建一个本地可运行的 AI 自动化测试工作台，用于本地环境或开发环境下的回归测试。系统需要能够：

1. 执行已有 Playwright 测试集。
2. 为未来接入 AI 自动生成测试、AI 自动探测页面、AI 失败归因预留能力边界。
3. 在接口异常时抓取 traceId，并联动追踪系统定位问题。
4. 保留未来演进为平台化测试系统的可能性。

### 2.2 目标

本阶段不直接构建“企业级测试平台”，而是构建一个：

- 本地单机可运行
- 可稳定执行回归测试
- 可沉淀测试资产
- 可产出可追踪的失败报告
- 可基于 traceId 反查后端链路
- 可逐步升级为平台的系统骨架

### 2.3 非目标

当前阶段不做以下内容：

- 多租户能力
- 团队协作与权限体系
- 在线 SaaS 平台化
- 分布式测试调度
- 云端对象存储
- 复杂任务编排系统
- 自动发布审批流
- 完整自愈式自动修复上线

---

## 3. 核心设计原则

### 3.1 Local-First

第一阶段优先本地运行体验，单机即可启动、执行、调试和查看结果。

### 3.2 Platform-Ready

虽然部署形态是本地单体，但代码形态按模块拆分设计，核心边界通过接口抽象，避免未来平台化时推倒重来。

### 3.3 先闭环，后智能

优先打通：

测试执行 → 失败识别 → traceId 提取 → trace 查询 → AI 失败分析 → 报告展示

而不是一开始追求“全自动 AI 探测”。

### 3.4 资产化优先

无论是人工维护的测试用例，还是 AI 生成的候选测试，都必须以“测试资产”的形式进行管理，而不是一次性脚本。

### 3.5 可替换能力边界

将以下能力抽象为独立接口：

- 测试执行器
- trace 查询器
- AI 引擎
- 资产存储
- 产物存储
- 配置加载

未来本地实现可以替换成平台实现。

---

## 4. 系统总体架构

### 4.1 架构概览

本地版本整体采用“单体进程 + 模块化分层”的结构。

逻辑模块包括：

1. CLI：命令入口
2. Orchestrator：任务编排
3. Test Runner：Playwright 执行器
4. Asset Center：测试资产中心
5. Trace Bridge：追踪查询桥接模块
6. AI Engine：AI 分析与生成模块
7. Local Report UI：本地报告查看界面
8. Storage：轻量数据与文件存储

### 4.2 高层执行链路

```text
CLI / UI 发起执行请求
    ↓
Orchestrator 创建一次 TestRun
    ↓
Test Runner 执行 Playwright 测试集
    ↓
收集 artifacts（trace / screenshot / video / report / network）
    ↓
提取失败接口 traceId
    ↓
Trace Bridge 查询追踪系统并生成摘要
    ↓
AI Engine 进行失败归因分析
    ↓
落库并写入本地报告目录
    ↓
Local UI 展示执行结果
```

### 4.3 部署形态

本阶段部署形态：

- 单仓库
- 本地 Node.js 进程
- 本地 SQLite
- 本地文件存储
- 本地 UI

未来平台化演进方向：

- Orchestrator 独立服务
- Runner 独立 worker
- SQLite 替换为 PostgreSQL
- 本地文件替换为对象存储
- Local UI 升级为平台 UI

---

## 5. 技术选型

### 5.1 主语言

建议主语言使用 **TypeScript**。

原因：

- Playwright 原生生态成熟
- 浏览器自动化和测试生成天然适配 TS
- CLI、服务端、本地 UI 可以共享类型定义
- 未来接入 AI agent / MCP / 代码生成更方便

### 5.2 核心框架与组件

- 测试执行：Playwright
- 后端运行时：Node.js
- CLI：Commander 或自定义命令入口
- 本地 UI：React + Vite
- 本地数据库：SQLite
- ORM / DB 访问：Drizzle ORM 或 Prisma（建议优先轻量方案）
- 配置管理：YAML + 环境变量
- 日志：Pino
- HTTP 调用：fetch / axios
- AI 接口层：统一封装 provider adapter

### 5.3 数据与文件存储

- 结构化数据：SQLite
- 测试产物：本地文件系统
- 测试场景：YAML / JSON
- Playwright 用例：TypeScript 文件

### 5.4 可选追踪后端适配

通过抽象接口支持：

- Jaeger
- SkyWalking
- Tempo
- 其他 APM / Trace API

当前版本先实现一种即可。

---

## 6. 仓库结构设计

```text
ai-e2e-local/
  apps/
    cli/                    # 命令行入口
    orchestrator/           # 任务编排层
    test-runner/            # Playwright 执行模块
    trace-bridge/           # trace 查询桥接
    ai-engine/              # AI 分析/生成模块
    local-ui/               # 本地报告 UI
  packages/
    test-assets/            # 测试资产：场景、用例、page objects、fixtures
    shared-types/           # 公共类型定义
    shared-utils/           # 通用工具
    config/                 # 配置解析与加载
    storage/                # SQLite 与文件存储适配
    logger/                 # 日志封装
  data/
    sqlite/                 # 本地 SQLite 文件
    runs/                   # run 元数据快照
    artifacts/              # screenshot/video/trace/report 等
    scenarios/              # YAML/JSON 场景文件
    generated-tests/        # AI 生成测试
  scripts/
    dev.sh
    init.sh
  docs/
    architecture.md
    roadmap.md
  playwright.config.ts
  package.json
  pnpm-workspace.yaml
```

### 6.1 结构设计说明

- `apps/*`：代表未来可能拆成独立服务的模块。
- `packages/*`：共享能力，避免横向重复依赖。
- `data/*`：本地运行时数据，不进入核心源码目录。
- `generated-tests/`：明确区分 AI 生成测试与正式测试资产。

---

## 7. 模块设计

## 7.1 CLI 模块

### 职责

- 接收命令行参数
- 发起测试执行任务
- 初始化环境
- 触发场景同步、报告查看等操作

### 建议命令

```bash
pnpm app run --suite smoke
pnpm app run --scenario order-create-smoke
pnpm app run --tag core
pnpm app report open
pnpm app scenario list
pnpm app scenario sync
pnpm app trace fetch --trace-id <traceId>
pnpm app ai analyze --run-id <runId>
```

### 输出要求

- 终端展示简明执行摘要
- 失败时输出 runId 与报告位置
- 可打印 traceId 与 trace 链接

---

## 7.2 Orchestrator 模块

### 职责

- 创建和管理 TestRun
- 调用 Test Runner 执行测试
- 管理任务生命周期
- 调用 Trace Bridge 和 AI Engine
- 汇总最终执行结果

### 关键能力

- run 创建
- run 状态流转
- 失败触发链路分析
- 生成摘要报告

### 状态流转

```text
CREATED -> RUNNING -> ANALYZING -> COMPLETED
                        └-> FAILED
```

### 设计要求

- 不直接依赖 Playwright 细节
- 通过 `TestRunner` 接口调用测试执行
- 通过 `TraceProvider` 接口调用 trace 查询
- 通过 `AIEngine` 接口调用分析能力

---

## 7.3 Test Runner 模块

### 职责

- 执行 Playwright 测试
- 产出 Playwright trace、video、screenshot
- 捕获网络请求与响应
- 提取候选 traceId

### 执行模式

支持以下粒度：

- 按 suite 执行
- 按 scenario 执行
- 按 tag 执行
- 按 testcase 执行

### 产物要求

每个 testcase 至少能产生：

- status
- duration
- screenshot（失败时）
- video（可选）
- trace.zip
- playwright html report 引用
- network log
- response 中提取到的 traceId 集合

### 扩展要求

未来允许：

- 切换本地 runner / 远程 runner
- Docker runner
- K8s runner

---

## 7.4 Asset Center 模块

### 职责

- 管理测试场景
- 管理测试用例元数据
- 管理 AI 生成的候选用例
- 管理审核状态
- 支持测试资产查询

### 管理对象

1. Scenario
2. TestCase
3. GeneratedTest
4. ReviewRecord

### 资产来源

- 手工编写
- Playwright 录制后整理
- AI 生成
- 历史回归脚本迁移

### 审核策略

AI 生成的测试默认为 `PENDING_REVIEW`，审核通过后再纳入正式回归集。

---

## 7.5 Trace Bridge 模块

### 职责

- 根据 traceId 查询链路追踪系统
- 将 trace 原始信息转成统一的结构化摘要
- 提供给报告层与 AI 分析层使用

### 输入

- traceId
- trace backend 配置

### 输出

统一的 TraceSummary 对象，建议包含：

- traceId
- rootService
- rootOperation
- duration
- hasError
- errorSpans
- topSlowSpans
- relatedHttpCalls
- relatedDbCalls
- rawLink

### 说明

不同 trace 系统的 API 不同，因此该模块要做 provider 抽象，不在业务逻辑中写死具体后端实现。

---

## 7.6 AI Engine 模块

### 职责

- 分析测试失败结果
- 生成故障归因摘要
- 生成测试草稿（后续阶段）
- 提供 locator 修复建议（后续阶段）

### 第一阶段只实现

- `analyzeFailure()`

### 第二阶段预留

- `generateTestFromScenario()`
- `generateTestFromPageSnapshot()`
- `suggestLocatorFix()`

### 约束

- AI 结果只作为建议，不自动修改正式测试资产
- 所有 AI 输出都要结构化持久化，便于审计

---

## 7.7 Local Report UI 模块

### 职责

- 查看 TestRun 列表
- 查看单次运行详情
- 展示 testcase 通过失败情况
- 展示 screenshot / video / trace / HTML report 链接
- 展示 traceId 与 trace 分析结果
- 展示 AI 失败分析

### 页面建议

1. Run 列表页
2. Run 详情页
3. TestCase 详情页
4. Scenario 管理页（简化版）
5. 系统配置页（可后置）

---

## 8. 核心接口抽象

本项目最关键的是接口边界抽象。部署可以先本地，边界必须先稳定。

## 8.1 TestRunner 接口

```ts
export interface TestRunner {
  run(request: RunRequest): Promise<RunResult>;
}
```

### 本地实现

- LocalPlaywrightRunner

### 未来实现

- DockerPlaywrightRunner
- RemoteWorkerRunner
- K8sRunner

---

## 8.2 TraceProvider 接口

```ts
export interface TraceProvider {
  getTrace(traceId: string): Promise<TraceSummary | null>;
}
```

### 本地实现

- JaegerTraceProvider
- SkyWalkingTraceProvider

---

## 8.3 AIEngine 接口

```ts
export interface AIEngine {
  analyzeFailure(input: FailureContext): Promise<FailureAnalysis>;
  generateTestFromScenario?(input: Scenario): Promise<GeneratedTest>;
  suggestLocatorFix?(input: LocatorFailureContext): Promise<LocatorSuggestion>;
}
```

---

## 8.4 ArtifactStore 接口

```ts
export interface ArtifactStore {
  saveArtifact(input: SaveArtifactInput): Promise<ArtifactRef>;
  readArtifact(path: string): Promise<Buffer | string>;
}
```

### 本地实现

- LocalFileArtifactStore

### 平台实现

- S3ArtifactStore
- MinioArtifactStore

---

## 8.5 AssetRepository 接口

```ts
export interface AssetRepository {
  saveScenario(scenario: Scenario): Promise<void>;
  getScenario(id: string): Promise<Scenario | null>;
  listScenarios(query?: ScenarioQuery): Promise<Scenario[]>;
  saveTestRun(run: TestRun): Promise<void>;
  saveTestResult(result: TestResult): Promise<void>;
}
```

### 本地实现

- SqliteAssetRepository

### 平台实现

- PostgresAssetRepository

---

## 9. 数据模型设计

## 9.1 Scenario

业务测试场景定义。

### 建议字段

- id
- name
- module
- description
- priority
- tags
- entryUrl
- preconditions
- steps
- assertions
- relatedApis
- status
- owner
- sourceType
- createdAt
- updatedAt

### 示例

```json
{
  "id": "order-create-smoke",
  "name": "订单创建冒烟",
  "module": "order",
  "description": "验证订单创建主流程是否正常",
  "priority": "P0",
  "tags": ["smoke", "core"],
  "entryUrl": "/orders/create",
  "preconditions": ["已登录", "存在有效商品"],
  "steps": [
    "进入订单创建页面",
    "填写基础信息",
    "提交订单"
  ],
  "assertions": [
    "页面显示创建成功",
    "接口返回 200"
  ],
  "relatedApis": ["/api/order/create"],
  "status": "ACTIVE",
  "owner": "default",
  "sourceType": "MANUAL"
}
```

---

## 9.2 TestCase

一个具体可执行的测试单元。

### 建议字段

- id
- scenarioId
- name
- filePath
- sourceType（MANUAL / RECORDED / GENERATED / HEALED）
- reviewStatus
- tags
- owner
- enabled
- createdAt
- updatedAt

---

## 9.3 TestRun

表示一次完整的执行任务。

### 建议字段

- runId
- triggerType（LOCAL / CI / MANUAL）
- environment
- suite
- startedAt
- endedAt
- status
- total
- passed
- failed
- skipped
- summary

---

## 9.4 TestResult

表示某个 testcase 在某次 run 中的结果。

### 建议字段

- id
- runId
- testcaseId
- scenarioId
- status
- errorType
- errorMessage
- durationMs
- screenshotPath
- videoPath
- tracePath
- htmlReportPath
- networkLogPath
- traceIds（JSON）
- createdAt

---

## 9.5 FailureAnalysis

### 建议字段

- id
- runId
- testcaseId
- category
- suspectedLayer
- confidence
- summary
- probableCause
- traceSummaryJson
- suggestionsJson
- createdAt

---

## 10. SQLite 表设计建议

## 10.1 scenarios

```sql
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  module TEXT,
  description TEXT,
  priority TEXT,
  tags TEXT,
  entry_url TEXT,
  preconditions TEXT,
  steps TEXT,
  assertions TEXT,
  related_apis TEXT,
  status TEXT,
  owner TEXT,
  source_type TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

## 10.2 test_cases

```sql
CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  scenario_id TEXT,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_type TEXT,
  review_status TEXT,
  tags TEXT,
  owner TEXT,
  enabled INTEGER,
  created_at TEXT,
  updated_at TEXT
);
```

## 10.3 test_runs

```sql
CREATE TABLE test_runs (
  run_id TEXT PRIMARY KEY,
  trigger_type TEXT,
  environment TEXT,
  suite TEXT,
  started_at TEXT,
  ended_at TEXT,
  status TEXT,
  total INTEGER,
  passed INTEGER,
  failed INTEGER,
  skipped INTEGER,
  summary TEXT
);
```

## 10.4 test_results

```sql
CREATE TABLE test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  scenario_id TEXT,
  status TEXT,
  error_type TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  screenshot_path TEXT,
  video_path TEXT,
  trace_path TEXT,
  html_report_path TEXT,
  network_log_path TEXT,
  trace_ids TEXT,
  created_at TEXT
);
```

## 10.5 failure_analysis

```sql
CREATE TABLE failure_analysis (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  testcase_id TEXT,
  category TEXT,
  suspected_layer TEXT,
  confidence REAL,
  summary TEXT,
  probable_cause TEXT,
  trace_summary_json TEXT,
  suggestions_json TEXT,
  created_at TEXT
);
```

---

## 11. 文件系统存储规范

建议结构如下：

```text
/data
  /artifacts
    /<runId>
      /<testcaseId>
        screenshot.png
        video.webm
        trace.zip
        network.json
        report-link.json
  /runs
    /<runId>.json
  /generated-tests
    /<scenarioId>
      draft.spec.ts
  /scenarios
    scenario-order-create-smoke.yaml
```

### 设计要求

- 所有 artifacts 按 runId / testcaseId 分层存放
- 数据库存路径，不直接存大文件内容
- 删除历史 run 时可整体清理对应目录

---

## 12. 配置体系设计

## 12.1 配置来源

按优先级覆盖：

1. 环境变量
2. 本地配置文件 `config.local.yaml`
3. 默认配置 `config.default.yaml`

## 12.2 配置项示例

```yaml
app:
  name: ai-e2e-local
  baseUrl: http://localhost:8080

storage:
  sqlitePath: ./data/sqlite/app.db
  artifactRoot: ./data/artifacts

playwright:
  headless: true
  browser: chromium
  trace: retain-on-failure
  video: retain-on-failure
  screenshot: only-on-failure

trace:
  provider: jaeger
  endpoint: http://localhost:16686/api/traces
  responseTraceHeader: X-Trace-Id

ai:
  provider: openai
  model: gpt-5.4-thinking
  enabled: true

report:
  port: 3910
```

---

## 13. 测试场景与用例组织规范

## 13.1 测试分层

建议将测试分为：

1. `smoke`：核心主流程，发布前必须通过
2. `regression`：模块级回归
3. `generated`：AI 生成候选用例，默认非阻断
4. `experimental`：自动探测、草稿、临时验证

## 13.2 命名规范

### scenario id

格式建议：

```text
<module>-<action>-<level>
```

例如：

- `order-create-smoke`
- `user-login-smoke`
- `device-edit-regression`

### testcase file

```text
<scenario-id>.spec.ts
```

### page object

```text
<module>.page.ts
```

---

## 14. Playwright 设计规范

## 14.1 建议目录

```text
packages/test-assets/
  tests/
    smoke/
    regression/
    generated/
  pages/
    login.page.ts
    order.page.ts
  fixtures/
    auth.fixture.ts
  data/
    users.json
  helpers/
    trace-helper.ts
    network-helper.ts
```

## 14.2 关键规范

- 尽量使用语义化 locator
- 公共操作封装为 page object
- traceId 抓取逻辑封装为通用 helper
- 每个测试必须绑定 scenarioId / testcaseId 元数据
- 避免在测试中硬编码环境依赖

## 14.3 traceId 抓取建议

通过 Playwright network hook 拦截 response：

- 优先从响应头中读取 `X-Trace-Id`
- 其次从响应体中解析 traceId（如果业务约定存在）
- 最后记录失败请求 URL、状态码、响应摘要

建议封装：

- `captureTraceIds(page)`
- `attachNetworkLogs(testInfo)`

---

## 15. 失败分类体系

为了支持 AI 分析与平台化统计，建议先定义统一失败分类。

### 一级分类

- UI_LOCATOR_FAILURE
- UI_ASSERTION_FAILURE
- API_ERROR
- BACKEND_TRACE_ERROR
- DATA_ERROR
- ENVIRONMENT_ERROR
- AUTH_ERROR
- TIMEOUT_ERROR
- UNKNOWN

### 二级维度

- suspectedLayer：ui / api / backend / data / env / auth
- confidence：0 ~ 1

---

## 16. Trace 联动设计

## 16.1 目标

在接口失败时，自动把测试失败与后端链路追踪关联起来。

## 16.2 设计要求

- 测试执行时捕获失败接口
- 提取 traceId
- 查询 trace backend
- 获取错误 span 与慢 span
- 将 trace 摘要展示到报告中

## 16.3 推荐数据流

```text
Response failed (500/4xx)
   ↓
读取响应头 X-Trace-Id
   ↓
生成 trace query task
   ↓
Trace Bridge 查询链路
   ↓
输出 TraceSummary
   ↓
写入 failure_analysis / 报告页面
```

## 16.4 TraceSummary 结构建议

```ts
export interface TraceSummary {
  traceId: string;
  rootService?: string;
  rootOperation?: string;
  durationMs?: number;
  hasError: boolean;
  errorSpans: Array<{
    spanId: string;
    service?: string;
    operation?: string;
    message?: string;
    durationMs?: number;
  }>;
  topSlowSpans: Array<{
    spanId: string;
    service?: string;
    operation?: string;
    durationMs?: number;
  }>;
  rawLink?: string;
}
```

---

## 17. AI 失败分析设计

## 17.1 输入上下文

AI 分析输入建议包含：

- testcase 基本信息
- 场景信息
- 失败信息
- 网络请求摘要
- trace 摘要
- screenshot 路径或摘要说明

## 17.2 输出结构

建议输出结构化对象：

```json
{
  "category": "API_ERROR",
  "suspectedLayer": "backend",
  "confidence": 0.86,
  "summary": "订单创建接口返回 500，且 trace 中 order-service 的 DB span 报错。",
  "probableCause": "订单落库逻辑存在数据库约束冲突或 SQL 异常。",
  "suggestions": [
    "查看 order-service 中 create order 相关 span 的 error tag",
    "检查数据库唯一约束与入参",
    "对比最近一次通过版本的接口返回与 SQL 变更"
  ]
}
```

## 17.3 行为约束

- AI 输出只做建议，不直接改代码
- 所有 AI 输出入库保存
- UI 中明确标注为“AI 建议”

---


## 17.4 AI 代码修改引擎设计

在当前本地版中，AI 不仅可以做失败分析，还应当预留“受控改代码”能力，用于修复测试脚本、补充断言、生成新用例，以及未来在严格约束下尝试修复业务代码。

设计原则：

- 代码修改能力必须与主流程解耦，不允许在 Orchestrator 中写死某个具体 CLI。
- 第一阶段优先接入 **Codex CLI** 与 **Kiro CLI**，并通过统一适配器为未来接入 **Claude Code** 预留能力边界。
- 默认先修改测试相关代码，再逐步开放业务代码修改。
- 所有改动必须可审计、可回滚、可验证。

### 17.4.1 为什么优先接入 CLI 型 coding agent

本项目中的“代码修改”并不是单次生成代码，而是完整的软件工程闭环：

- 读取仓库上下文
- 搜索相关文件
- 修改一个或多个文件
- 运行命令或测试验证
- 根据验证结果再次修复
- 输出 diff / patch / 变更说明

因此，本地版主路径更适合接入终端型 coding agent，而不是只依赖一次性的 LLM 函数调用。官方资料显示：

- Codex CLI 可以在本地目录中读取、修改并运行代码。citeturn164661search0turn164661search3
- Kiro CLI 提供面向终端的 agentic development，支持自然语言驱动的构建、测试、部署与代码修改，并支持自定义 agent 配置与 skills。citeturn164661search1turn164661search4turn164661search13turn164661search15turn164661search7
- Claude Code 生态同时提供 CLI / 子代理能力 / Agent SDK，适合作为后续扩展目标。citeturn164661search2turn164661search8

### 17.4.2 能力分层

建议将“AI 改代码”分成两层：

#### A. Analysis Layer（分析层）

负责：

- 失败归类
- 修复计划生成
- 变更范围建议
- 风险评估
- 生成验证清单

这一层可以由统一的 AIEngine 或纯 SDK provider 实现。

#### B. Execution Layer（执行层）

负责：

- 读取项目文件
- 搜索代码上下文
- 实际改动文件
- 执行测试和脚本
- 生成 diff / patch / 说明

这一层优先通过 CLI 型 coding agent 完成。

### 17.4.3 统一抽象：CodeAgent

```ts
export interface CodeTask {
  taskId: string;
  mode: 'suggest' | 'apply' | 'verify';
  target: 'test' | 'app' | 'mixed';
  scopePaths: string[];
  goal: string;
  contextFiles?: string[];
  diagnostics?: string[];
  constraints?: string[];
  verificationCommands?: string[];
  branchName?: string;
}

export interface CodeChangeResult {
  success: boolean;
  summary: string;
  changedFiles: string[];
  diffPath?: string;
  patchPath?: string;
  verification?: {
    passed: boolean;
    outputs: string[];
  };
  rawOutputPath?: string;
}

export interface CodeAgent {
  name: string;
  isAvailable(): Promise<boolean>;
  plan(task: CodeTask): Promise<string>;
  apply(task: CodeTask): Promise<CodeChangeResult>;
  verify(task: CodeTask): Promise<CodeChangeResult>;
}
```

说明：

- `CodeAgent` 只定义行为，不绑定具体厂商。
- `plan` 用于生成修复方案或执行计划。
- `apply` 负责实际修改代码。
- `verify` 负责运行指定验证命令。

### 17.4.4 第一阶段实现：CodexCliAgent + KiroCliAgent

建议在 `apps/ai-engine` 下增加 `code-agents/` 子模块，至少包含：

```text
apps/
  ai-engine/
    src/
      code-agents/
        CodeAgent.ts
        CodexCliAgent.ts
        KiroCliAgent.ts
        ClaudeCodeCliAgent.ts      # 先定义接口适配骨架，可暂不启用
        CodeAgentRegistry.ts
        CodeTaskPolicy.ts
```

#### CodexCliAgent 适合的任务

- 根据失败日志修复 Playwright locator
- 生成或改写测试用例、page object、fixture
- 在受控目录中进行多文件修改
- 执行本地测试并迭代修复

官方文档说明 Codex CLI 是本地终端中的 coding agent，可读、改、运行代码，且支持配置和命令参考文档。citeturn164661search0turn164661search3turn164661search9

#### KiroCliAgent 适合的任务

- 按规格说明生成测试模块或子系统骨架
- 根据设计文档进行 spec-driven 实现
- 在复杂任务中利用 agent / skill 组织工作流
- 将团队规范沉淀为 skills 或 agent 配置

官方文档强调 Kiro CLI 面向 spec-driven development，且具备 skills、自定义 agent 配置和命令参考。citeturn164661search1turn164661search4turn164661search7turn164661search13turn164661search15turn164661search10

### 17.4.5 预留能力：ClaudeCodeCliAgent

第一阶段不强制实现 Claude Code，但应预留一个适配器骨架：

- 预留 `ClaudeCodeCliAgent` 类
- 预留 `provider: claude-code` 的配置项
- 预留子代理或后续 SDK 化扩展位

这样未来若需要接入 Claude Code，只需要补齐：

- 可用性探测
- 命令行调用封装
- 输出解析器
- 验证与结果归一化

Claude 官方文档显示 Claude Code 既支持 CLI 形态，也支持 sub-agents 和 Agent SDK。citeturn164661search2turn164661search8turn164661search14

### 17.4.6 CodeAgentRegistry

为了在任务类型和 agent 之间做路由，建议增加注册中心：

```ts
export interface CodeAgentRegistry {
  getPreferred(taskType: 'fix-test' | 'generate-test' | 'implement-feature' | 'fix-app'): Promise<CodeAgent | null>;
  listAvailable(): Promise<string[]>;
}
```

推荐的默认路由策略：

- `fix-test` → 优先 CodexCliAgent
- `generate-test` → 优先 CodexCliAgent
- `implement-feature` → 优先 KiroCliAgent
- `fix-app` → 优先 KiroCliAgent，其次 CodexCliAgent
- `claude-code` 暂不默认选中，但保留可配置能力

### 17.4.7 权限分级与策略控制

必须增加策略层，禁止 agent 在未受控情况下修改任意代码。

建议分三级：

#### L1：建议级（默认最安全）

- 只输出修复计划
- 不落盘
- 不改文件

#### L2：测试代码修改级（第一阶段主路径）

允许修改：

- `tests/**`
- `playwright/**`
- `packages/test-assets/**`
- `data/generated-tests/**`

禁止修改业务代码目录。

#### L3：业务代码修复级（后续能力）

允许修改业务代码，但必须满足：

- 新建 git 分支
- 明确 scopePaths
- 强制执行验证命令
- 输出 diff / patch / 变更说明
- 默认要求人工 review

建议增加策略接口：

```ts
export interface CodeTaskPolicy {
  check(task: CodeTask): {
    allowed: boolean;
    reason?: string;
    normalizedScope?: string[];
  };
}
```

### 17.4.8 标准执行流程

```text
TestResult 失败
  ↓
AIEngine 进行失败分析
  ↓
生成 CodeTask（目标、范围、约束、验证命令）
  ↓
CodeTaskPolicy 审核
  ↓
CodeAgentRegistry 选择合适的 agent
  ↓
CLI agent 执行代码修改
  ↓
保存 raw output / diff / patch
  ↓
执行 verify
  ↓
写入 CodeChangeResult
  ↓
在 Local UI 中展示修改摘要与验证结果
```

### 17.4.9 与当前 MVP 的关系

第一阶段建议只落地以下能力：

1. 定义 `CodeAgent` 接口
2. 实现 `CodexCliAgent`
3. 实现 `KiroCliAgent`
4. 实现 `CodeAgentRegistry`
5. 实现 `CodeTaskPolicy`
6. 支持“根据失败结果生成测试修复任务”
7. 改动范围只允许测试代码目录
8. 改完后自动执行 `pnpm test` 或指定 Playwright case 验证

不建议第一阶段实现：

- 自动修改生产业务代码并直接提交主分支
- 多 agent 协作编排
- 自动发起 PR
- 无人工 review 的上线动作


## 18. Local UI 设计

## 18.1 页面 1：Run 列表

展示：

- runId
- 开始时间
- suite
- 总数 / 通过 / 失败
- 状态
- 查看详情按钮

## 18.2 页面 2：Run 详情

展示：

- 本次执行的总览统计
- 失败 testcase 列表
- 产物链接
- trace 命中数
- AI 分析摘要

## 18.3 页面 3：TestCase 详情

展示：

- 场景信息
- 错误信息
- screenshot
- video
- trace.zip
- traceId 列表
- trace 摘要
- AI 建议

## 18.4 页面 4：Scenario 列表

展示：

- 场景名称
- module
- priority
- tags
- 是否启用
- 关联 testcase

---

## 19. 执行时序设计

## 19.1 基础执行时序

```text
用户执行 CLI 命令
  ↓
CLI 构造 RunRequest
  ↓
Orchestrator 创建 run 记录
  ↓
调用 TestRunner.run()
  ↓
Playwright 执行测试
  ↓
保存 artifacts + network logs
  ↓
写入 TestResult
  ↓
若失败且存在 traceId，则调用 TraceProvider.getTrace()
  ↓
生成 TraceSummary
  ↓
调用 AIEngine.analyzeFailure()
  ↓
落库 FailureAnalysis
  ↓
更新 TestRun 汇总状态
  ↓
CLI 输出摘要，UI 可查看详情
```

---

## 20. 未来平台化演进设计

虽然当前部署是单体，但下列边界必须保证未来可拆。

## 20.1 拆分方向

### 本地阶段

- 单体 orchestrator
- 本地 Playwright runner
- SQLite
- Local UI

### 平台阶段

- Scheduler Service
- Runner Worker Pool
- Asset Service
- Report Service
- Trace Integration Service
- AI Analysis Service
- Web Console

## 20.2 替换矩阵

| 当前实现 | 平台化替换 |
|---|---|
| SQLite | PostgreSQL |
| Local File Store | MinIO / S3 |
| LocalPlaywrightRunner | Remote Runner / K8s Worker |
| Local UI | Web Console |
| 本地配置文件 | 配置中心 |
| 单进程 orchestrator | 调度服务 |

## 20.3 不应耦合的内容

以下内容严禁直接写死在业务主流程中：

- 本地文件路径
- 某个 trace 后端 API 细节
- 某个 AI provider 的调用细节
- Playwright 命令行细节
- 单一数据库实现

---

## 21. 第一阶段 MVP 范围

## 21.1 必做

1. 项目基础骨架初始化
2. CLI 命令入口
3. Playwright runner 封装
4. SQLite 基础表
5. 本地文件 artifacts 存储
6. run / result 持久化
7. 失败截图与 trace.zip 存储
8. response traceId 抓取
9. trace 查询桥接（先支持一种 provider）
10. AI 失败分析接口与基础实现
11. Local UI 展示 run 与 testcase 结果
12. CodeAgent 接口与策略层
13. CodexCliAgent / KiroCliAgent 基础接入
14. 测试代码受控修改与本地验证

## 21.2 可后置

1. 场景编辑 UI
2. AI 生成测试
3. 自动页面探测
4. locator 自动修复建议
5. ClaudeCodeCliAgent 适配器落位
6. CI 集成
7. 回归门禁策略

---

## 22. 开发分阶段计划

## 阶段 1：项目骨架与基础执行

目标：能跑测试，能记录结果。

交付物：

- monorepo 初始化
- CLI
- Playwright runner
- SQLite 表
- artifact 目录
- Run 记录与摘要输出

## 阶段 2：失败产物与 trace 联动

目标：失败可定位到后端链路。

交付物：

- response traceId 提取
- Trace Bridge
- TraceSummary 模型
- 报告中展示 trace 数据

## 阶段 3：AI 分析闭环

目标：失败有自动归因建议。

交付物：

- AIEngine 接口
- 分析 prompt 方案
- FailureAnalysis 落库
- UI 展示 AI 建议
- CodeTask 模型
- CodeTaskPolicy 初版

## 阶段 4：资产中心与场景管理

目标：测试具备资产化管理能力，并初步具备受控改测试代码能力。

交付物：

- Scenario 仓储
- TestCase 元数据管理
- generated-tests 目录与状态管理
- CodeAgent 接口
- CodeAgentRegistry
- CodexCliAgent
- KiroCliAgent

## 阶段 5：AI 生成与平台化预备

目标：开始进入智能化扩展，并预留 Claude Code 扩展位。

交付物：

- generateTestFromScenario
- candidate test review 流程
- 更清晰的 runner 抽象
- ClaudeCodeCliAgent 骨架
- 更细的权限策略与审计模型

---

## 23. 风险与规避建议

## 23.1 风险：一开始做成“大而全平台”

### 后果

开发复杂度过高，迟迟无法形成闭环。

### 建议

严格收敛到本地 MVP。

## 23.2 风险：AI 生成测试不稳定

### 后果

大量不可维护脚本。

### 建议

AI 生成内容默认进入 `generated-tests/`，不直接进入正式回归集。

## 23.3 风险：traceId 获取不稳定

### 后果

难以自动关联后端问题。

### 建议

推动网关或后端统一返回响应头 `X-Trace-Id`。

## 23.4 风险：测试资产和执行结果混在一起

### 后果

后续很难治理。

### 建议

明确区分：

- 测试资产
- 执行结果
- AI 生成产物
- 报告与 artifacts

---

## 24. 编码约束建议

### 24.1 代码风格

- 使用 TypeScript 严格模式
- 核心模型与 DTO 独立定义
- 各模块之间只通过接口交互
- 禁止跨模块直接引用实现细节

### 24.2 日志要求

关键阶段必须打印结构化日志：

- run 创建
- runner 开始/结束
- testcase 失败
- trace 查询结果
- AI 分析结果

### 24.3 错误处理

- 外部依赖失败时要降级，不可导致整体 run 崩溃
- trace 查询失败时仍保存原始测试结果
- AI 分析失败时只标记分析失败，不影响主流程完成

---

## 25. 建议的首批 CLI 命令清单

```bash
# 初始化
pnpm app init

# 执行 smoke
pnpm app run --suite smoke

# 执行某个 scenario
pnpm app run --scenario order-create-smoke

# 按标签执行
pnpm app run --tag core

# 查看本地报告 UI
pnpm app report open

# 列出场景
pnpm app scenario list

# 查看某次 run 详情
pnpm app run show --run-id <runId>

# 单独查询 trace
pnpm app trace fetch --trace-id <traceId>

# 触发 AI 分析
pnpm app ai analyze --run-id <runId>

# 使用 Codex 修复某个失败用例（仅测试代码）
pnpm app code fix-test --run-id <runId> --testcase <testcaseId> --agent codex

# 使用 Kiro 按场景生成测试草稿
pnpm app code generate-test --scenario order-create-smoke --agent kiro

# 验证最近一次代码修改结果
pnpm app code verify --task-id <taskId>

# 查看可用 code agents
pnpm app code agents
```

---

## 26. 给 Codex 的实施建议

建议按以下顺序生成和开发：

1. 初始化 monorepo 与 workspace
2. 创建 `shared-types`、`config`、`storage` 包
3. 创建 `orchestrator` 与 `test-runner` 基础骨架
4. 接入 Playwright 基础执行
5. 建立 SQLite schema 与 repository
6. 落地 artifacts 存储规范
7. 添加 traceId 提取与 Trace Bridge
8. 添加 AIEngine 接口与本地占位实现
9. 定义 CodeAgent / CodeTask / CodeTaskPolicy
10. 接入 CodexCliAgent 与 KiroCliAgent
11. 开发 Local UI 基础页面
12. 逐步补 Scenario/Asset Center
13. 预留 ClaudeCodeCliAgent 扩展骨架

建议让 Codex 每一轮只完成一个清晰子目标，不要让它一次性生成整个系统全部代码。

---

## 27. 本阶段最终结论

本项目第一阶段的正确定位不是“全功能测试平台”，而是：

**一个本地可运行、具备稳定回归能力、具备 trace 联动和 AI 分析能力、并且在架构上能平滑升级为平台的 AI 自动化测试工作台。**

建议第一阶段优先打通的最小闭环为：

**Playwright 执行 → artifacts 落地 → traceId 提取 → trace 查询 → AI 分析 → 本地报告展示**

只要这个闭环跑通，系统就已经具备很高价值，也能为后续平台化、CI/CD、AI 生成测试提供坚实基础。

