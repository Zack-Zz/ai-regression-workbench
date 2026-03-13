# ai-regression-workbench

[English](./README.md) | 简体中文

`ai-regression-workbench` 是一个基于 Playwright 的本地优先回归测试与受控修复系统。它的目标不是只跑测试，也不是做成无人工干预的自动修复平台，而是帮助团队在本地完成测试执行、诊断采集、AI 分析、受控改代码、人工 review 和显式提交这一整条闭环。

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
- 为失败用例采集 artifacts、trace 摘要和日志摘要。
- 使用 AI 生成结构化失败分析。
- 生成受控的代码修复任务，而不是直接无审查改代码。
- 支持人工审批、review 和显式 commit。
- 保持架构可平滑演进到平台化形态。

## 核心流程

```text
Playwright 执行
  -> artifacts
  -> correlation context
  -> trace 查询
  -> 日志查询
  -> AI 分析
  -> CodeTask 草稿
  -> 审批
  -> 代码修改器执行
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
  shared-types/
  shared-utils/
  config/
  storage/
  event-store/
  logger/
  test-assets/
data/
  sqlite/
  runs/
  artifacts/
  diagnostics/
  analysis/
  code-tasks/
  commits/
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
- 模块设计文档：
  [orchestrator](./docs/orchestrator-design.md)、
  [diagnostics](./docs/diagnostics-design.md)、
  [ai-engine](./docs/ai-engine-design.md)、
  [code-task](./docs/code-task-design.md)、
  [local-ui](./docs/local-ui-design.md)、
  [packaging](./docs/packaging-design.md)、
  [test-assets](./docs/test-assets-design.md)、
  [observability](./docs/observability-design.md)
- 外部参考文档：
  [Codex CLI](https://developers.openai.com/codex/cli)、
  [Kiro CLI](https://kiro.dev/docs/cli/)
- 英文 README：[README.md](./README.md)

## 当前状态

当前仓库以设计文档和实现草案为主。下一步建议初始化 monorepo，并优先实现状态机、诊断链路和受控 CodeTask 流程。
