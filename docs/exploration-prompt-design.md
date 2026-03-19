# Exploration Prompt / Context 设计文档

## 1. 目标

当前 exploration 的主要问题不是单个参数太小，而是：

- prompt 没有稳定模板和版本化
- LLM 看到的页面上下文过于贫瘠
- agent 无法持续利用近期步骤、近期发现、剩余预算做决策
- Playwright 的页面结构能力没有真正进入 prompt

本设计补齐 exploration 的 prompt/context 工程，让 AI 探索具备可演进、可测试、可审计的基础。

---

## 2. 设计原则

1. prompt 模板化，不在主逻辑里长期硬编码大段文本
2. context 预算化，只提供高价值、有限长度的信息
3. page state 结构化，优先提供 DOM/交互摘要而不是原始 HTML
4. 近期记忆显式化，带上 recent steps / recent findings / remaining budget
5. prompt 版本化，后续可以安全迭代

---

## 3. 模块布局

在 `packages/agent-harness` 内新增本地轻量能力：

```txt
packages/agent-harness/
  src/
    prompt-loader.ts
    exploration-agent.ts
    playwright-tool-provider.ts
  prompts/
    exploration-decision/
      default@v1.txt
    exploration-login/
      default@v1.txt
```

说明：

- 不直接依赖 `apps/ai-engine`
- 复用的是 loader 机制，不复用运行时依赖边界
- 后续若 prompt 机制需要统一，可再抽 shared prompting package

---

## 4. Prompt 模板

### 4.1 exploration-decision

用途：决定下一步探索动作。

输入变量：

- `startUrls`
- `allowedHosts`
- `stepIndex`
- `remainingBudget`
- `focusAreas`
- `currentPage`
- `observedCounts`
- `consoleErrors`
- `networkErrors`
- `availableControls`
- `visitedPages`
- `recentSteps`
- `recentFindings`

输出 JSON：

```json
{
  "action": "click|fill|navigate|done",
  "selector": "...",
  "value": "...",
  "targetUrl": "...",
  "reasoning": "..."
}
```

运行时约束：

- 使用 `response_format: { type: "json_object" }`
- 使用 function tool schema（`decide_exploration_action`），`tool_choice: "required"`
- 空响应自动重试（最多 2 次）

### 4.2 exploration-login

用途：辅助 AI 登录流程。

输入变量：

- `currentPage`
- `inputs`
- `buttons`
- `forms`
- `username`

输出 JSON：

```json
{
  "isLoginPage": true,
  "action": "fill|click|done",
  "selector": "...",
  "value": "...",
  "reasoning": "..."
}
```

运行时约束：

- 使用 `response_format: { type: "json_object" }`
- 使用 function tool schema（`decide_login_action`），`tool_choice: "required"`
- 空响应自动重试（最多 2 次）

密码值不直接写入 prompt，只允许返回 `__PASSWORD__` 占位符。

---

## 5. Context 工程

### 5.1 决策上下文

`ExplorationAgent.decideNextStep()` 应至少带入：

- 当前页面 URL / title
- form/link/error counts
- DOM 摘要
- 最近 8 条 steps
- 最近 8 条 findings
- 最近 8 条 tool results
- 最近 6 条 network highlights
- 已访问页面尾部列表
- 剩余 steps/pages budget
- focus area 指令

### 5.2 DOM 摘要

`PlaywrightToolProvider.collectState()` 额外提供：

- `headings`
- `primaryButtons`
- `navLinks`
- `ctaCandidates`
- `inputHints`
- `textSnippet`

这些摘要用于给 LLM 一个稳定、短小、可操作的页面理解层。

`ctaCandidates` 是经过轻量排序后的候选交互项，用于帮助模型优先点击“更像主流程”的按钮/链接，而不是平均对待页面上所有控件。

### 5.3 去重

exploration findings 以：

```txt
category + severity + pageUrl + summary
```

作为轻量去重 key，避免 agent 在重复页面状态下持续刷同类 finding。

---

## 6. 动作空间

探索主链路不再只支持：

- `navigate`
- `done`

而是扩展为：

- `click`
- `fill`
- `navigate`
- `done`

执行规则：

1. `navigate`：加入 pending URL 队列
2. `click` / `fill`：立即调用 `playwright.*` 工具
3. 动作执行后调用 `playwright.getState`
4. 新状态继续进入下一轮 prompt 决策

---

## 7. Session 上下文

创建 exploration session 时，将以下信息写入 `contextRefs`：

- `startUrls`
- `allowedHosts`
- `maxSteps`
- `maxPages`
- `focusAreas`
- `credentialId`
- `loginStrategy`
- `promptTemplates`

这样后续回放、调试和评估都能看到当时的探索约束。

---

## 8. Prompt 元数据落盘

步骤日志需要额外保留：

- `promptTemplateVersion`
- `promptContextSummary`
- `pageState.headings`
- `pageState.primaryButtons`
- `pageState.navLinks`
- `pageState.ctaCandidates`
- `pageState.inputHints`
- `pageState.textSnippet`

另外，Harness 应按采样策略把 prompt 原文落到：

- `agent-traces/<sessionId>/prompt-samples.jsonl`

建议策略：

- 第 0 步必采样
- 每 5 步采样一次
- LLM 调用失败时强制采样

单条样本建议字段：

- `phase`
- `templateVersion`
- `prompt`
- `response`
- `promptContextSummary`
- `sampledBy`
- `metadata`

用途：

- 明确每一步用了哪个模板版本
- 在不泄露完整 prompt 的前提下，保留足够的调试摘要
- 便于后续做 prompt 回归、效果对比与 drift 分析

---

## 9. 测试要求

至少覆盖：

1. prompt builder 含关键上下文字段
2. `click/fill` 决策可被正确解析
3. prompt 模板缺失时给出明确错误
4. page state DOM 摘要与 CTA 候选字段存在
5. recent tool results / recent network highlights 能进入 prompt
6. findings 去重生效
7. 步骤日志含 prompt template 元数据与页面摘要

---

## 10. 后续演进

下一阶段优先做：

1. 完整 prompt 原文按采样策略落调试文件，而不是只留 summary
2. exploration prompt 支持外部覆盖目录
3. page state 引入更强的可见区域摘要与 CTA ranking
4. tool-call 结果自动回流到 recent context
5. network highlights 自动回流到 exploration decision prompt
