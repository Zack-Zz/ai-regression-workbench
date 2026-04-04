# CodeTask 自动化设计文档

## 1. 目标

本文档描述 CodeTask 的自动触发、自动审批和自动执行边界。

它关注的是：

- 什么时候生成 `CodeTaskDraft`
- 什么条件下可以自动进入执行
- 自动执行之后系统如何衔接 verify、review 和 commit

它不再描述已经废弃的阶段拆分和旧状态名。

---

## 2. 触发源

### 2.1 Regression 失败后自动创建

```text
regression run 完成（failed > 0）
  -> AI 分析每个失败 testcase
  -> 生成 CodeTaskDraft
  -> 若 autoApprove=false -> PENDING_APPROVAL
  -> 若 autoApprove=true 且风险允许 -> APPROVED 并触发执行
```

### 2.2 Exploration finding 后自动创建

exploration session 完成后，可按页面和问题类型聚合 findings，再生成 CodeTaskDraft。

聚合维度建议保持：

- `pageUrl`
- `category`

目标是避免把同一类问题切成大量碎任务。

### 2.3 测试草稿生成

探索生成的测试草稿不强制走 CodeTask 主链。

它们更适合作为：

- generated test candidate
- 后续人工 review 后再纳入回归集

---

## 3. 自动审批策略

项目级可配置：

```yaml
codeTask:
  autoApprove: false
  autoApproveMaxRiskLevel: low
```

建议风险口径：

- `low`
  只改测试、配置或局部低风险代码
- `medium`
  小范围业务逻辑修改
- `high`
  核心逻辑、多文件或高影响变更

推荐默认值：

- `autoApprove: false`
- 即使开启自动审批，也只自动通过 `low` 风险任务

---

## 4. 自动执行链

当前自动执行链路：

```text
PENDING_APPROVAL
  -> APPROVED
  -> RUNNING
  -> CodeRepairAgent staged execution
    -> ReadOnlyPlanAgent
    -> transport.apply
  -> VERIFYING
  -> VerificationAgent verdict / retry decision
  -> SUCCEEDED / FAILED
  -> 人工 review
  -> COMMIT_PENDING
  -> 人工 commit
  -> COMMITTED
```

说明：

- `SUCCEEDED` 表示 apply 和 verify 已通过
- `FAILED` 表示 transport 执行失败或系统 verify 失败
- verify 失败不会进入旧文档中的 `VERIFY_FAILED`
- verify 通过也不会进入旧文档中的 `READY_TO_REVIEW`

当前真实状态名以 `CodeTaskStatus` 为准：

- `DRAFT`
- `PENDING_APPROVAL`
- `APPROVED`
- `RUNNING`
- `VERIFYING`
- `SUCCEEDED`
- `COMMIT_PENDING`
- `COMMITTED`
- `FAILED`
- `REJECTED`
- `CANCELLED`

---

## 5. 当前与 Agent Runtime 的关系

自动执行阶段并不是直接把 `goal` 丢给 CLI，而是：

```text
CodeTaskService
  -> CodeRepairAgent
    -> memory selection
    -> context assembly
    -> ReadOnlyPlanAgent
    -> staged prompts
    -> transport.run()
  -> ArtifactWriter.generateArtifacts()
  -> VerificationAgent
```

所以这里的自动化应理解为：

- 自动准备上下文
- 自动准备只读计划和 verification review
- 自动执行 apply
- 自动做系统 verify
- 在单个 `CodeTask` 内按预算自动 retry

但它还不是：

- 带 auto compact、side agent 的长流程自治修复系统

当前 verify 失败后，系统会先在同一个 `CodeTask` 内消费 retry decision 并尝试下一轮 apply；只有预算耗尽后，任务才会落到 `FAILED`。这里的预算既包括 attempt budget，也包括近似 token budget。预算耗尽后的后续 retry 仍由业务链路和人工决策推进。

另外，自动 retry 并不是机械跑满预算：

- 如果连续失败但 verify 输出和改动范围没有新信号，runtime 会触发 no-progress stop
- 如果近似 token budget 紧张，runtime 会先 auto compact 前序失败上下文；compact 后仍超预算才会停止下一轮自动 retry
- `retry-decision` 会明确记录最终自动化结论，而不是只保留“建议重试”

---

## 6. 选择器缓存

选择器缓存设计仍然有效，保留如下目标：

- 避免每次启动都重新扫描大型测试仓库
- 为 UI 提供 `suite / scenario / tag / testcase` 下拉值

推荐表：

```sql
CREATE TABLE test_selector_cache (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 7. 当前推荐口径

后续文档和 UI 文案应统一使用：

- `CodeRepairAgent`
- `CodeRepair`
- `CodeTask`

不再使用：

- `CodeAgent`
- `READY_TO_REVIEW`
- `VERIFY_FAILED`
