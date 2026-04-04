# Exploration 模块设计文档

## 1. 现状与问题

exploration 最初是一个 `fetch` 骨架：`ExplorationAgent.explore()` 直接抓 HTML，
对 JS 渲染的 SPA 基本无效，也绕过了 `ToolRegistry`。当前实现已经补齐了
Playwright-backed `ToolRegistry` 调用、步骤日志、网络日志、登录认证、prompt
模板外置与 diagnostics 采样，但本文档仍保留当初暴露出的核心约束，作为设计背景。

历史问题主要包括：

- 探索立即完成，findings 为 0
- 步骤明细只写文件，前端无法查阅
- 网络请求/响应没有持久化
- 不支持登录认证
- LLM 决策输入只有 `formCount`/`linkCount`，无法真正"看到"页面

当前补齐点：

- `ExplorationAgent` 优先通过 `PlaywrightToolProvider + ToolRegistry` 执行 `navigate/click/fill`
- 本地 UI 已可查看两类轨迹：
  - run 级 `steps.ndjson / network / prompt samples`
  - session 级 replay（`context refs / steps / tool calls / prompt samples`）
- 支持 static / ai 两类登录策略，以及认证失效重试
- 登录失败、AI 登录失败、认证失效重试超限会让 Run fail fast
- 增加 `Brain v1`（planner + policy guard + executor）编排，避免回登录页循环并提升探索稳定性

### Brain v1（2026-03）

`Brain v1` 不是替换 executor，而是把探索从“纯单步反应式”升级为“短期规划 + 执行 + 护栏”：

1. `planner`：生成阶段目标（phase/objective）和 guardrail（candidateUrls/avoidUrls）。
2. `executor`：基于当前页面执行 `click/fill/navigate/done` 决策。
3. `policy guard`：对 executor 动作做硬约束检查（如已登录后避免回到 `/login`）。

当前 planner 触发条件：

- 第 0 步
- 强制重规划（状态漂移、动作失败、登录态变化）
- 每 3 步周期性重规划
- 连续无新 finding 接近停滞时

新增步骤日志动作：

- `brain.plan`
- `brain.replan`
- `policy.guard`

新增 prompt 模板：

- `exploration-plan/default@v1`

---

## 2. 目标架构

```
ExplorationAgent
  └─ 通过 ToolRegistry 调用 playwright.* 工具
       └─ PlaywrightToolProvider（持有 browser context）
            ├─ playwright.navigate(url)
            ├─ playwright.click(selector)
            ├─ playwright.fill(selector, value)
            ├─ playwright.getState()
            └─ playwright.close()
```

关键原则：
- Agent 不直接持有 Playwright 实例，只通过 `ToolRegistry.call()` 调用
- `ToolRegistry` 负责 host 白名单、budget、audit、approval
- `PlaywrightToolProvider` 持有 browser context 生命周期，在 session 内保持状态（cookie、登录态）
- DOM snapshot 通过 provider 的 `collectDomSnapshot()` 直接提供给 AI 登录与决策，不额外注册独立 tool

---

## 3. 认证与凭据注入（Q1）

### 3.1 问题

探索需要登录的站点时，必须在 browser context 里完成认证。
运行时不应在 replay / steps / prompt samples 中暴露凭据正文，但系统当前通过 `credentialId` 引用 `site_credentials` 中已配置的凭据。

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
  approxTokenBudget?: number;
  enableAutoCompact?: boolean;
  maxCompactions?: number;
  browserMode?: 'headless' | 'headed';
  focusAreas?: string[];
  persistAsCandidateTests?: boolean;
  credentialId?: string;     // 指向 site_credentials.id，运行时从 DB 读取凭据
  loginStrategy?: 'none' | 'static' | 'ai';
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
- "启动探索"对话框当前通过 `credentialId` 选择已配置凭据
- 登录策略通过 `loginStrategy` 指定：`none / static / ai`
- UI 不直接回显凭据正文，只展示 credential label

---

## 4. 步骤与网络明细持久化（Q2）

### 4.1 步骤明细

当前 exploration 同时保留两类步骤轨迹：

- session 级步骤：`agent-traces/<sessionId>/steps.jsonl`
- run 级执行日志：`runs/<runId>/steps.ndjson`

session 级步骤用于 replay，run 级日志用于 `StepLogPanel` 的实时查阅。

session 级步骤每行示意：
```json
{
  "stepIndex": 0,
  "description": "navigate: https://example.com/home",
  "timestamp": "2026-03-17T05:00:00.000Z",
  "outcome": "findings: 2, errors: 1"
}
```

### 4.2 网络请求明细

在 `PlaywrightToolProvider` 里通过 Playwright 的 `page.on('request')` /
`page.on('response')` 收集，在 exploration run 收尾时统一 flush 到：

```
runs/<runId>/network.jsonl
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

### 4.3 当前边界

当前 replay 入口已经覆盖：

- context refs
- session steps
- tool calls
- prompt samples

截图与统一的 session-level network replay 仍属于后续增强项，不应写成当前已完成能力。

---

## 5. 前端查阅明细（Q3）

### 5.1 当前状态

`RunDetailPage` 现在已经有 session replay 入口：

- 展示 run 下的 agent sessions 列表
- 可打开单个 session 的 replay 明细
- replay 明细当前至少包含 context refs、session steps、tool calls、prompt samples

原有 run 级 `steps / network / prompt-samples` 面板仍保留，用于快速查看 exploration 主链过程。

### 5.2 新增 API 端点

```
GET /runs/:runId/sessions
  → 返回该 run 下的所有 agent sessions（含 agentName、kind、status、summary）

GET /runs/:runId/sessions/:sessionId/replay
  → 返回该 session 的 context refs、steps、tool calls、prompt samples
```

### 5.3 前端页面设计

当前先不单独做 `ExplorationSessionPage`，而是在 `RunDetailPage` 内以 replay modal 方式打开：

```
RunDetailPage
├─ Agent Sessions
│   ├─ Session 概览（agentName、kind、status、startedAt、summary）
│   └─ Open Replay
└─ Session Replay Modal
    ├─ Session Context
    ├─ Session Steps
    ├─ Tool Calls
    └─ Prompt Samples
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
[13:00:02] ExplorationAgent  getState — 12 requests, 0 errors, 2 findings
[13:00:03] ExplorationAgent  LLM decision: click button[data-testid="login"]
[13:00:03] ExplorationAgent  click started → button[data-testid="login"]
```

---

## 6. Agent Runtime 集成（当前实现）

### 6.1 当前运行方式

exploration 主链现在已经不再绕开 `ToolRegistry`。

当前执行顺序：

```text
RunService.runExploration()
  -> 创建 PlaywrightToolProvider（持有 browser context）
  -> 创建 Harness session + ToolRegistry
  -> 创建 ExplorationAgent(db, provider, playwrightProvider)
  -> agent.explore(runId, config, fallbackProbe, dataRoot)
       -> handleNavigationPass()
       -> persistPageFindings()
       -> handleAuthGate()
       -> runExplorationPlanning()
       -> handleRequiredLogin()
       -> runExplorationDecision()
       -> handleNavigateDecision() / handleInteractiveAction()
       -> commitExplorationStep()
       -> finalizeExplorationRun()
```

说明：

- 主路径已经是 `PlaywrightToolProvider + ToolRegistry`
- 只有在 Playwright 无法启动时，才会回退到 `probe` 兼容路径
- tool-level audit、host 白名单、近似 budget 控制都已经在主路径生效

### 6.2 当前模块分层

当前 exploration 已经不是一个大类，而是由 `ExplorationAgent` 调度这些模块：

- `brain.ts`
- `brain-runner.ts`
- `auth-flow.ts`
- `execution.ts`
- `orchestration.ts`
- `budget.ts`
- `lifecycle.ts`
- `heuristics.ts`
- `recent-context.ts`
- `action-utils.ts`
- `page-state.ts`
- `finding-extractor.ts`
- `browser-adapter.ts`
- `prompt-builder.ts`
- `types.ts`

其中：

- `ExplorationAgent` 主要保留顶层 loop、fallback probe 兼容层和最终调度粘合
- 计划、决策、登录、副作用执行、budget、step commit、finalize 都已经迁入子模块

### 6.3 PlaywrightToolProvider 当前能力

当前 provider 暴露的是“注册工具 + DOM 快照 + browser 生命周期”，而不是让 agent 直接持有 Playwright 实例。

```ts
interface PlaywrightToolProvider {
  launch(opts?: { headless?: boolean }): Promise<void>;
  registerTools(registry: ToolRegistry): void;
  collectDomSnapshot(): Promise<DomSnapshot>;
  applyCredential(cred: SiteCredentialRow, baseUrl: string): Promise<void>;
  close(): Promise<void>;
}
```

当前注册的工具：

| 工具名 | 输入 | 输出 |
|---|---|---|
| `playwright.navigate` | `{ url: string }` | `PageProbe` |
| `playwright.getState` | `{}` | `PageProbe` |
| `playwright.click` | `{ selector: string }` | `{ ok: true }` |
| `playwright.fill` | `{ selector: string, value: string }` | `{ ok: true }` |
| `playwright.close` | `{}` | `void` |

补充：

- DOM snapshot 通过 `collectDomSnapshot()` 提供给 AI 登录与决策，不是单独的 registry tool
- screenshot / network 采样由 provider 内部收集与持久化，不作为额外交互工具暴露

### 6.4 ExplorationAgent 当前接口

```ts
class ExplorationAgent {
  constructor(
    db: Db,
    provider: AIProvider,
    playwrightProvider?: PlaywrightToolProvider,
  ) {}

  async explore(
    runId: string,
    config: ExplorationConfig,
    probe: (url: string) => Promise<PageProbe>,
    dataRoot?: string,
    onStep?: () => void,
  ): Promise<ExplorationResult> {}
}
```

这里保留 `probe` 参数，只是为了浏览器不可用时的 fallback 兼容，不再代表主路径设计。

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

### 6.5 后续增强：LLM 故障分析策略

这部分目前仍是增强方向，不应当成现有 exploration 主链能力。目标是：session 完成后，对每个 finding 单独触发分析。

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

## 7. 当前落地与后续增强

### 7.1 当前已落地

- Playwright-backed exploration 主链已经接入 `ToolRegistry`
- `ExplorationAgent` 已模块化为 `brain / auth-flow / execution / orchestration / budget / lifecycle`
- 支持 `credentialId + loginStrategy` 的 static / ai 登录
- 支持 auth gate 检测与认证失效重试
- exploration 已具备近似 token budget、一次 auto compact、budget snapshot
- `RunDetailPage` 已可查看 agent session replay
- `StepLogPanel` 仍可查看 run 级步骤、network、prompt samples

### 7.2 当前仍待增强

- 将 `ExplorationAgent` 继续收成更薄的 orchestration shell
- 在 session replay 中统一纳入 screenshot / network 回放
- 更强的 compact 策略与长流程恢复
- 更强的 turn-end hooks 与 pause / resume checkpoint

---

## 9. 登录策略设计

### 9.1 概述

登录分两种策略，通过 `ExplorationConfig.loginStrategy` 控制：

| 策略 | 适用场景 | 实现方式 |
|------|---------|---------|
| `static` | 测试集场景，凭据已知 | `applyCredential()` 预置认证，exploration 前完成 |
| `ai` | AI 探索场景，页面结构未知 | AI 识别登录表单，交互式完成登录 |
| `none`（默认） | 无需登录的公开站点 | 跳过认证 |

```ts
interface ExplorationConfig {
  // ...existing fields...
  loginStrategy?: 'none' | 'static' | 'ai';  // 默认 'none'
  credentialId?: string;  // static/ai 模式均需要
}
```

---

### 9.2 静态凭据登录（static）

**流程**：

```
PlaywrightToolProvider.launch()
  → applyCredential(cred, baseUrl)
       ├─ cookie 模式：ctx.addCookies()
       ├─ token 模式：ctx.setExtraHTTPHeaders()
       └─ userpass 模式：
            navigate(loginUrl)
            fill(usernameSelector, username)
            fill(passwordSelector, password)
            click(submitSelector)
            waitForNavigation()
  → verifyLoginSuccess()   ← 新增
       ├─ 检查当前 URL 不再是 loginUrl
       ├─ 检查页面不含登录表单特征（input[type=password]）
       └─ 失败则抛出 LoginFailedError，run fail fast
```

**改动点**：
- `applyCredential()` 末尾新增 `verifyLoginSuccess()` 验证
- 验证失败时记录步骤日志 `status: 'error'`，Run 状态进入 `FAILED`，并在 `summary` 写 `LOGIN_FAILED`
- 密码字段在步骤日志中替换为 `[REDACTED]`

---

### 9.3 AI 驱动交互式登录（ai）

**核心问题**：AI 需要"看到"页面才能识别登录表单。

**方案：DOM 快照（不用截图）**

用 `page.evaluate()` 提取页面关键交互元素，结构化成 JSON 传给 LLM：

```ts
interface DomSnapshot {
  url: string;
  title: string;
  inputs: Array<{
    type: string;        // text / password / email / hidden
    name?: string;
    id?: string;
    placeholder?: string;
    label?: string;      // 关联 <label> 的文字
  }>;
  buttons: Array<{
    text: string;
    type?: string;       // submit / button
    selector: string;    // 用于 click
  }>;
  links: Array<{
    text: string;
    href: string;
  }>;
  forms: Array<{
    action?: string;
    method?: string;
    inputCount: number;
  }>;
}
```

**AI 登录流程**：

```
navigate(startUrl 或 loginUrl)
  → collectDomSnapshot()
  → LLM 判断：当前页面是否是登录页？
       ├─ 否：继续正常 exploration
       └─ 是：
            LLM 决策：fill username selector + value
            fill(selector, username)
            LLM 决策：fill password selector + value
            fill(selector, password)
            LLM 决策：click submit selector
            click(selector)
            waitForNavigation()
            → verifyLoginSuccess()
                 ├─ 成功：继续 exploration
                 └─ 失败：记录 LOGIN_AI_FAILED，停止 exploration
```

**LLM Prompt 设计**：

```
You are an AI login agent. Analyze the page and decide the next action.

Page: https://example.com/login (title: "用户登录")
DOM snapshot:
  inputs: [
    { type: "email", name: "email", placeholder: "请输入邮箱" },
    { type: "password", name: "password", placeholder: "请输入密码" }
  ]
  buttons: [
    { text: "登录", type: "submit", selector: "button[type=submit]" }
  ]

Credentials available: username=<email>, password=<available>

Respond with JSON only:
{
  "isLoginPage": true,
  "action": "fill" | "click" | "done" | "skip",
  "selector": "input[name=email]",
  "value": "<username>",
  "reasoning": "..."
}
```

**多轮交互**：AI 登录是多轮的（fill username → fill password → click submit），
每轮 LLM 返回一个 action，最多执行 `maxLoginSteps`（默认 10）步，
超出则记录 `LOGIN_AI_STEP_EXCEEDED` 并停止。

---

### 9.4 认证失效重试（两种策略共用）

exploration 过程中若检测到认证失效，自动重新执行登录流程：

**失效检测条件**（满足任一）：
- 当前页面 URL 包含 `/login`、`/signin`、`/auth`、`/sso` 等特征
- 连续两步 network errors 中出现 401 或 403

**重试规则**：
- 30 分钟滑动窗口内超过 3 次 → 中断，Run 状态进入 `FAILED`，`summary` 写 `AUTH_RETRY_EXCEEDED`
- 重试时重新执行对应策略的登录流程（static 重新 `applyCredential`，ai 重新走 AI 登录）

---

### 9.5 步骤日志记录规范

登录相关步骤统一记录到 `steps.jsonl`：

| action | status | detail |
|--------|--------|--------|
| `login.start` | `pending` | 登录策略 + credentialId |
| `login.fill` | `ok` | selector（value 替换为 `[REDACTED]`） |
| `login.click` | `ok` | selector |
| `login.verify` | `ok` / `error` | 验证结果 |
| `login.retry` | `warn` | 第 N 次重试 |
| `login.failed` | `error` | 失败原因 code |

---

### 9.6 Run Failure Code 扩展

| Code | 含义 |
|------|------|
| `LOGIN_FAILED` | 静态凭据登录验证失败 |
| `LOGIN_AI_FAILED` | AI 登录验证失败 |
| `LOGIN_AI_STEP_EXCEEDED` | AI 登录步骤超出上限 |
| `AUTH_RETRY_EXCEEDED` | 认证失效重试超出限制 |

约束：

- 这些 code 仍写入 Run 的 `summary` 字段，供前端多语言文案映射
- 同时 Run 总状态必须进入 `FAILED`，不能继续收敛到 `COMPLETED`

---

### 9.7 当前状态

当前已经落地：

- `collectDomSnapshot()` 已用于 AI 登录判断
- `loginStrategy` 已进入 `ExplorationConfig`
- static / ai 登录都已经接入主链
- 认证失效重试和 `AUTH_RETRY_EXCEEDED` 已接入 run failure 语义

当前仍待增强：

- 更强的登录后状态验证与恢复策略
- checkpoint 恢复后如何续接 auth state
- replay 视图里更完整的登录上下文回放

---

## 10. 安全约束

- 凭据正文当前存储在 `site_credentials`，运行时只通过 `credentialId` 引用并在 session 内使用
- API / replay / steps / prompt samples 中不能回传明文密码或 token
- `allowedHosts` 在 `ToolRegistry` 层强制执行，Agent 无法绕过
- exploration 默认 `allowedWriteScopes: []`（只读）
- AI 登录时密码字段在步骤日志中替换为 `[REDACTED]`，不会写入 replay 明细
