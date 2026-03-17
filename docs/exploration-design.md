# Exploration 模块设计文档

## 1. 现状与问题

当前 exploration 实现是一个骨架：`ExplorationAgent.explore()` 用 `fetch` 抓 HTML，
对 JS 渲染的 SPA 完全无效，且绕过了 `ToolRegistry`，导致 tool-level 的 audit、
budget、approval 全部失效。具体表现：

- 探索立即完成，findings 为 0
- 步骤明细只写文件，前端无法查阅
- 网络请求/响应没有持久化
- 不支持登录认证
- LLM 决策输入只有 `formCount`/`linkCount`，无法真正"看到"页面

---

## 2. 目标架构

```
ExplorationAgent
  └─ 通过 ToolRegistry 调用 playwright.* 工具
       └─ PlaywrightToolProvider（持有 browser context）
            ├─ playwright.navigate(url)
            ├─ playwright.click(selector)
            ├─ playwright.fill(selector, value)
            ├─ playwright.screenshot()
            └─ playwright.getPageState()  ← DOM摘要 + console errors + network errors
```

关键原则：
- Agent 不直接持有 Playwright 实例，只通过 `ToolRegistry.call()` 调用
- `ToolRegistry` 负责 host 白名单、budget、audit、approval
- `PlaywrightToolProvider` 持有 browser context 生命周期，在 session 内保持状态（cookie、登录态）

---

## 3. 认证与凭据注入（Q1）

### 3.1 问题

探索需要登录的站点时，必须在 browser context 里完成认证。
凭据（账号密码、cookie、token）不能持久化到 DB，只在 session 生命周期内存活。

### 3.2 设计

**凭据来源**：从 `SiteCredential` 表读取，持久化存储跟随站点配置。
启动探索时选择一组账号（默认第一组），凭据在 session 内存中使用。

`ExplorationConfig` 不再携带 `credentials` 字段，改为传入 `credentialId`：

```ts
interface ExplorationConfig {
  startUrls: string[];
  allowedHosts?: string[];   // 默认从 site.baseUrl 自动提取，可追加额外子域名
  maxSteps?: number;
  maxPages?: number;
  focusAreas?: string[];
  persistAsCandidateTests?: boolean;
  credentialId?: string;     // 指向 site_credentials.id，运行时从 DB 读取凭据
}
```

**allowedHosts 说明**：探索时允许访问的域名白名单，防止 AI 跑到外部域名
（第三方 CDN、支付页面等）。系统自动从 `site.baseUrl` 提取域名作为默认值，
用户可在站点配置里追加额外允许的子域名。

**认证流程**：
1. `PlaywrightToolProvider` 初始化时，根据 `credentialId` 从 DB 读取凭据
2. 在 browser context 创建后执行认证（填表单 / 注入 cookie / 设置 header）
3. 认证完成后 browser context 保持登录态，后续所有 `playwright.*` 调用共享此 context
4. 认证步骤记录到 `steps.jsonl`，密码字段替换为 `[REDACTED]`

**认证失效重试策略**：

探索过程中若检测到认证失效（HTTP 401/403、跳转到登录页），自动重新执行认证流程。

失效检测条件（满足任一）：
- 当前页面 URL 包含 `/login`、`/signin`、`/auth` 等登录路径特征
- 连续两个 step 的 network errors 中出现 401 或 403

重试规则：
- 在任意 30 分钟滑动窗口内，若认证失效并重试超过 3 次，中断 session
- 中断时记录原因：`AUTH_RETRY_EXCEEDED`，写入 `steps.jsonl` 和 session summary
- 前端在 session 概览中展示停止原因

```ts
interface AuthRetryState {
  attempts: Array<{ timestamp: string }>;  // 滑动窗口内的失效记录
  windowMs: number;   // 默认 30 * 60 * 1000
  maxAttempts: number; // 默认 3
}
```

**UI 交互**：
- "启动探索"对话框新增"认证配置"折叠区
- 支持三种模式：无需登录 / 账号密码 / Cookie/Token
- 凭据只在前端内存和本次 HTTP 请求中存在，不缓存

---

## 4. 步骤与网络明细持久化（Q2）

### 4.1 步骤明细

每个 exploration step 对应一次 `ToolRegistry.call()`，记录到：

```
agent-traces/<sessionId>/steps.jsonl
```

每行格式：
```json
{
  "stepIndex": 0,
  "action": "navigate",
  "url": "https://example.com/home",
  "timestamp": "2026-03-17T05:00:00.000Z",
  "outcome": "ok",
  "pageTitle": "首页",
  "screenshotPath": "agent-traces/<sessionId>/screenshots/step-0.png",
  "findingsCount": 2,
  "durationMs": 1200
}
```

### 4.2 网络请求明细

在 `PlaywrightToolProvider` 里通过 Playwright 的 `page.on('request')` /
`page.on('response')` 收集，每次 navigate 后写入：

```
agent-traces/<sessionId>/network.jsonl
```

每行格式（完整记录，本地测试环境不做脱敏）：
```json
{
  "stepIndex": 0,
  "url": "https://api.example.com/user/info",
  "method": "GET",
  "requestHeaders": { "Authorization": "Bearer xxx", "Content-Type": "application/json" },
  "requestBody": null,
  "status": 200,
  "responseHeaders": { "Content-Type": "application/json", "X-Trace-Id": "abc123" },
  "responseBody": "{\"id\":1,\"name\":\"test\"}",
  "durationMs": 45,
  "timestamp": "2026-03-17T05:00:01.000Z"
}
```

`responseBody` 超过 50KB 时截断并追加 `\n[TRUNCATED: original size Xbytes]`。

### 4.3 截图

每个 navigate/click step 后自动截图，存储路径：
```
agent-traces/<sessionId>/screenshots/step-<N>.png
```

---

## 5. 前端查阅明细（Q3）

### 5.1 当前缺口

`RunDetailPage` 只展示 findings 列表，没有 session trace 入口。
API 层没有 session/step/network 相关端点。

### 5.2 新增 API 端点

```
GET /runs/:runId/sessions
  → 返回该 run 下的所有 agent sessions（含 status、stepCount、findingCount）

GET /runs/:runId/sessions/:sessionId/steps
  → 返回 steps.jsonl 解析后的步骤列表（分页）

GET /runs/:runId/sessions/:sessionId/steps/:stepIndex/network
  → 返回该 step 的 network.jsonl 条目列表

GET /runs/:runId/sessions/:sessionId/steps/:stepIndex/screenshot
  → 返回截图文件（image/png）
```

### 5.3 前端页面设计

在 `RunDetailPage` 的 exploration 区域新增"探索明细"入口，
点击进入 `ExplorationSessionPage`：

```
ExplorationSessionPage
├─ Session 概览（状态、步骤数、findings 数、耗时、停止原因）
├─ 步骤时间线
│   ├─ Step 0: navigate → https://example.com/home  [1200ms]
│   │   ├─ 截图缩略图
│   │   ├─ 发现 2 个 findings
│   │   └─ 网络请求列表（表格，列：URL、Method、Status、耗时）
│   │       点击某行 → 弹出详情窗口（不跳转页面）
│   ├─ Step 1: click → button[data-testid="login"]  [300ms]
│   └─ ...
└─ Findings 汇总（按 severity 分组）
```

**网络请求详情弹窗**（点击列表行触发，可关闭）：
```
┌─────────────────────────────────────────────┐
│ POST /api/order/create              [×关闭]  │
├─────────────────────────────────────────────┤
│ Status: 500   Duration: 1200ms              │
│                                             │
│ Request Headers                             │
│   Content-Type: application/json            │
│   Authorization: Bearer xxx                 │
│                                             │
│ Request Body                                │
│   {"items":[...],"userId":1}                │
│                                             │
│ Response Headers                            │
│   Content-Type: application/json            │
│   X-Trace-Id: abc123                        │
│                                             │
│ Response Body                               │
│   {"error":"Internal Server Error",...}     │
└─────────────────────────────────────────────┘
```

**执行日志面板**（Run 详情页底部，实时轮询）：
```
[13:00:01] ExplorationAgent  navigate started → https://example.com/home
[13:00:02] ExplorationAgent  navigate completed (1200ms) — title: 管理后台
[13:00:02] ExplorationAgent  getPageState — 12 requests, 0 errors, 2 findings
[13:00:03] ExplorationAgent  LLM decision: click button[data-testid="login"]
[13:00:03] ExplorationAgent  click started → button[data-testid="login"]
```

---

## 6. Agent 架构重构（Q4）

### 6.1 当前问题

`ExplorationAgent.explore()` 直接接受外部注入的 `probe` 函数，
完全绕过 `ToolRegistry`，导致：
- tool-level audit 失效（`tool-calls.jsonl` 为空）
- host 白名单不生效
- budget 控制不生效
- 无法扩展 click/fill 等交互动作

### 6.2 重构目标架构

```
RunService.runExploration()
  └─ 创建 PlaywrightToolProvider（持有 browser context + credentials）
  └─ 创建 ToolRegistry，注册 playwright.* 工具
  └─ 创建 ExplorationAgent(db, provider, toolRegistry)
  └─ agent.explore(runId, config, dataRoot)
       └─ 内部通过 toolRegistry.call('playwright.navigate', { url })
       └─ 内部通过 toolRegistry.call('playwright.getPageState')
       └─ 内部通过 toolRegistry.call('playwright.click', { selector })
```

### 6.3 PlaywrightToolProvider 接口

```ts
interface PlaywrightToolProvider {
  /** 初始化 browser context，执行认证（如有） */
  init(credentials?: ExplorationCredentials): Promise<void>;
  /** 注册所有 playwright.* 工具到 registry */
  registerTools(registry: ToolRegistry): void;
  /** 关闭 browser context */
  close(): Promise<void>;
}
```

注册的工具：

| 工具名 | 输入 | 输出 |
|---|---|---|
| `playwright.navigate` | `{ url: string }` | `{ title, url, ok }` |
| `playwright.getPageState` | `{}` | `{ title, url, domSummary, consoleErrors, networkErrors, formCount, linkCount, screenshotPath }` |
| `playwright.click` | `{ selector: string }` | `{ ok, newUrl? }` |
| `playwright.fill` | `{ selector: string, value: string }` | `{ ok }` |
| `playwright.screenshot` | `{}` | `{ path: string }` |

### 6.4 ExplorationAgent 重构后接口

```ts
class ExplorationAgent {
  constructor(
    db: Db,
    provider: AIProvider,
    toolRegistry: ToolRegistry,  // 替换 probe 函数
  ) {}

  async explore(
    runId: string,
    config: ExplorationConfig,
    dataRoot: string,
  ): Promise<ExplorationResult> {}
}
```

LLM 决策输入基于 DOM 文本摘要 + 当前页 network 摘要，不使用截图：

```
You are an AI site exploration agent. Decide the next action.

Current page: https://example.com/home (title: "管理后台")
DOM summary: [nav: 首页, 用户管理, 设置] [button: 退出登录] [link: 查看订单]
Network this step: 12 requests — 200:11, 4xx:0, 5xx:1
  ⚠ POST /api/stats → 500 ({"error":"db timeout"})
Console errors: 1 — TypeError: Cannot read 'id' of undefined
Focus areas: console-errors, network-errors
Already visited: (none)  Step: 0 / 20

Respond with JSON only:
{"action":"navigate"|"click"|"fill"|"done","targetUrl":"...","selector":"...","value":"...","reasoning":"..."}
```

### 6.5 LLM 故障分析策略

**触发时机**：session 完成后，对每个 finding 单独触发分析。

**输入裁剪**：不把全量 network.jsonl 丢给 LLM，先提取出错片段：
- 筛选：status >= 400，或 responseBody 含 `error`/`exception`/`fail`
- 关联上下文：该请求所在 step 的前后各 1 step 的 network 记录
- 裁剪后通常不超过 10 条，控制 token 消耗

**分析输入格式**：
```
Finding: [HTTP 500] POST /api/order/create
Page: https://example.com/order

Error network trace:
[step 3] GET /api/cart/items → 200 (45ms)
[step 3] POST /api/order/create → 500 (1200ms)
  request body: {"items":[...],"userId":1}
  response body: {"error":"Internal Server Error","traceId":"abc123"}
[step 4] GET /api/order/list → 200 (80ms)

Console errors at step 3:
  - Uncaught TypeError: Cannot read property 'id' of undefined

Analyze the root cause and suggest a fix.
```

### 6.6 全局步骤日志要求

**所有执行步骤都必须记录**，不限于 exploration，包括：
- regression：每个 testcase 的 start/pass/fail
- exploration：每个 navigate/click/fill/LLM decision
- AI 分析：触发、完成、失败
- CodeTask：plan/apply/verify 各阶段

每条日志格式：
```json
{
  "timestamp": "2026-03-17T05:00:00.000Z",
  "runId": "run-xxx",
  "sessionId": "sess-xxx",
  "stepIndex": 0,
  "component": "ExplorationAgent",
  "action": "navigate",
  "detail": "Navigating to https://example.com/home",
  "status": "started | completed | failed",
  "durationMs": 1200
}
```

存储：
- exploration/CodeTask：`agent-traces/<sessionId>/steps.jsonl`（已有）
- regression/AI：`runs/<runId>/execution-log.jsonl`（新增）

前端在 Run 详情页底部展示执行日志面板，轮询刷新，实时可见当前系统在做什么。

---

## 7. 实现阶段划分

### Phase A：Playwright 探针接入（解决"立即完成"问题）
1. 实现 `PlaywrightToolProvider`，注册 `playwright.navigate` / `getPageState` / `click` / `fill`
2. 重构 `ExplorationAgent` 使用 `ToolRegistry`，移除 `probe` 函数参数
3. `RunService.runExploration()` 创建 `PlaywrightToolProvider` 并注入
4. 步骤明细写 `steps.jsonl`，截图写 `screenshots/`，network 写 `network.jsonl`

### Phase B：认证支持
1. `ExplorationConfig` 新增 `credentials` 字段（不持久化）
2. `PlaywrightToolProvider.init()` 支持 userpass / cookie / token 三种认证
3. 认证失效重试策略（30min 窗口内超 3 次中断）
4. UI 新增认证配置区

### Phase C：前端明细查阅
1. 新增 API 端点（sessions、steps、network、screenshot）
2. 新增 `ExplorationSessionPage`，步骤时间线 + 网络请求列表 + 详情弹窗
3. Run 详情页新增执行日志面板（轮询）

### Phase D：LLM 故障分析接入
1. session 完成后对每个 finding 触发分析
2. 实现 network.jsonl 出错片段裁剪逻辑
3. 分析结果关联到 finding，前端可查阅

---

## 8. 安全约束

- 凭据不写 DB，不写日志文件，只在内存中存活
- `allowedHosts` 在 `ToolRegistry` 层强制执行，Agent 无法绕过
- exploration 默认 `allowedWriteScopes: []`（只读）
