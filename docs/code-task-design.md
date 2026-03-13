# CodeTask 与 Review 详细设计

## 1. 模块目标

该模块负责受控代码修改、审批、review 和 commit 记录。

参考文档：

- [OpenAI Codex CLI 官方文档](https://developers.openai.com/codex/cli)
- [Kiro CLI 官方文档](https://kiro.dev/docs/cli/)

## 2. 核心流程

```text
FailureAnalysis
  ->
CodeTask Draft
  ->
PENDING_APPROVAL
  ->
APPROVED
  ->
RUNNING
  ->
VERIFYING
  ->
SUCCEEDED
  ->
Review Action（accept / reject / retry）
  ->
COMMIT_PENDING
  ->
COMMITTED
```

说明：

- `REVIEW` 是动作阶段，不是 `CodeTaskStatus` 枚举值
- `CodeTaskStatus` 与总设计保持一致：
  `DRAFT -> PENDING_APPROVAL -> APPROVED -> RUNNING -> VERIFYING -> SUCCEEDED -> COMMIT_PENDING -> COMMITTED`
  异常状态：`FAILED / REJECTED / CANCELLED`

## 3. 关键对象

- `CodeTask`
- `Review`
- `CommitRecord`

`CodeTask` 必须绑定目标项目目录：

- `automationLevel`
- `workspacePath`
- `scopePaths`
- 可选 `branchName`

建议定义：

```ts
type AutomationLevel = 'headless' | 'interactive';
```

## 4. 审批与 review 原则

- `approve` 与 `execute` 分离
- review 通过不自动 commit
- commit 必须是显式动作
- 必须落盘 `raw-output.txt`、`changes.diff`、`changes.patch`、`verify.txt`

## 4.1 Agent 分工建议

- `CodexCliAgent`
  适合作为 `headless` 执行器，由 orchestrator 直接调用

- `KiroCliAgent`
  适合作为 `interactive` 执行器，用于打开用户接管的修复会话

设计要求：

- 不要假设两个 agent 都具备同样稳定的 machine-readable 输出能力
- 最终结果应以工作区 diff 和 verify 结果为准，而不只依赖 agent 的自然语言输出

## 5. 权限约束

默认允许修改：

- `packages/test-assets/**`
- `playwright/**`
- `.ai-regression-workbench/data/generated-tests/**`

默认禁止修改业务代码目录。

## 6. 目标项目目录

code agent 不能默认假设当前工具仓库就是被修改仓库。

因此执行前必须明确：

- `workspacePath`
  被搜索、被修改、被验证的项目目录

- `scopePaths`
  相对于 `workspacePath` 的允许修改范围

要求：

- `workspacePath` 必须可配置
- 执行前必须校验目录存在
- 若需要 git 操作，必须探测该目录的 git 根
- review 页面必须展示本次任务关联的目标项目目录

## 7. 推荐调用方式

### 7.1 CodexCliAgent

推荐作为非交互执行器：

```bash
codex exec \
  -C <workspacePath> \
  --json \
  -o <last-message-file> \
  --output-schema <schema-file> \
  "<prompt>"
```

适合：

- 自动生成修复计划
- 自动改代码
- 自动 verify
- 输出结构化结果

### 7.2 KiroCliAgent

推荐作为交互式修复会话入口：

```bash
kiro chat --mode agent "<prompt>" <workspacePath>
```

适合：

- 用户接管的复杂修复任务
- 需要人工参与的 spec-driven 修改

第一阶段不建议把 Kiro 设计成主自动执行器。
