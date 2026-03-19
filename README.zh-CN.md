# ai-regression-workbench

[English](./README.md) | 简体中文

`ai-regression-workbench` 是一个基于 Playwright 的本地优先回归测试、AI 辅助自主探测与受控修复系统。它的目标不是只跑测试，也不是做成无人工干预的自动修复平台，而是帮助团队在本地完成现有测试执行、预算内 AI 探测、诊断采集、AI 分析、候选测试或受控改代码、人工 review 和显式提交这一整条闭环。

CLI 命令名：

- `zarb`（`Zack AI Regression Bench`）

快速开始：

```bash
npm install -g ai-regression-workbench
zarb
```

首次运行时，`zarb` 应自动引导初始化，并在完成后打开本地工作台。

## 目标

- 在本地运行已有 Playwright 测试集。
- 在明确预算和权限边界内做 AI 自主探测。
- 为失败用例采集 artifacts、trace 摘要和日志摘要。
- 使用 AI 生成结构化失败分析。
- 生成候选测试与受控代码修复任务，而不是直接无审查改代码。
- 支持人工审批、review 和显式 commit。
- 保持架构可平滑演进到平台化形态。

## 核心流程

```text
回归执行 / AI 探测
  -> artifacts
  -> correlation context
  -> trace 查询
  -> 日志查询
  -> AI 分析
  -> 候选测试 / CodeTask 草稿
  -> 审批
  -> agent harness 执行
  -> verify
  -> review
  -> commit
```

## 核心特性

- 本地优先：单机即可运行。
- 可中断：支持 pause、resume、cancel、retry。
- 可观测：状态、事件、产物、诊断信息全链路可追踪。
- 人在回路：不会隐式执行改代码或自动提交。
- 平台化预留：runner、trace、logs、AI、storage、code agent 都做接口抽象。

## 当前运行时行为

- exploration 在本地浏览器工具链可用时，会优先走 Playwright-backed harness 路径；只有该路径无法启动时才降级。
- `LOGIN_FAILED`、`LOGIN_AI_FAILED`、`AUTH_RETRY_EXCEEDED` 这类 exploration 致命错误会让 Run 总状态进入 `FAILED`；同时仍保留机器可读的 failure code，供前端多语言文案映射。
- 执行报告同时暴露 `status` 和 `currentStage`，本地 UI 中的“阶段结果”以动态进度视图展示，而不是静态表格快照。

## 仓库结构

```text
apps/
  cli/
  orchestrator/
  test-runner/
  trace-bridge/
  log-bridge/
  ai-engine/
  review-manager/
  local-ui/
packages/
  agent-harness/
  shared-types/
  shared-utils/
  config/
  storage/
  event-store/
  logger/
  test-assets/
.zarb/
  config.local.yaml
  data/
    sqlite/
    runs/
    artifacts/
    diagnostics/
    analysis/
    code-tasks/
    commits/
    generated-tests/
docs/
design.md
```

## 诊断模型

系统不会把 `X-Trace-Id` 写死为唯一协议，而是基于可配置的 correlation keys 提取诊断上下文，并据此查询 trace 和日志系统。

常见关联来源包括：

- 响应头
- 响应体字段
- requestId
- sessionId
- service hint
- 时间窗口

## 文档

- 详细设计文档：[docs/design.md](./docs/design.md)
- 产品收口路线图：[docs/product-completion-roadmap.md](./docs/product-completion-roadmap.md)
- 功能设计文档：
  [项目与站点管理](./docs/project-site-design.md)、
  [探索模块](./docs/exploration-design.md)、
  [CodeTask 自动化](./docs/codetask-automation-design.md)
- 模块设计文档：
  [orchestrator](./docs/orchestrator-design.md)、
  [diagnostics](./docs/diagnostics-design.md)、
  [ai-engine](./docs/ai-engine-design.md)、
  [ai-provider](./docs/ai-provider-design.md)、
  [agent-harness](./docs/agent-harness-design.md)、
  [code-task](./docs/code-task-design.md)、
  [api-contract](./docs/api-contract-design.md)、
  [local-ui](./docs/local-ui-design.md)、
  [packaging](./docs/packaging-design.md)、
  [test-assets](./docs/test-assets-design.md)、
  [observability](./docs/observability-design.md)、
  [app-services](./docs/app-services-design.md)、
  [storage-mapping](./docs/storage-mapping-design.md)
- 外部参考文档：
  [Codex CLI](https://developers.openai.com/codex/cli)、
  [Kiro CLI](https://kiro.dev/docs/cli/)
- 英文 README：[README.md](./README.md)

## 当前状态

Phase 0-16 已经完成，仓库目前已具备本地工作台基线、API/UI 流程、AI 多提供商集成（OpenAI + DeepSeek，支持运行时切换）、doctor 检查、Playwright 驱动 exploration、执行报告聚合以及 hardening 覆盖。

正在进行的设计工作 / 后续扩展方向：
- 项目与站点管理 — 多项目、多域名、按项目隔离代码仓库和数据目录
- CodeTask 自动化 — 回归失败和探索发现后自动触发修复任务

后续计划见 [docs/product-completion-roadmap.md](./docs/product-completion-roadmap.md)。
