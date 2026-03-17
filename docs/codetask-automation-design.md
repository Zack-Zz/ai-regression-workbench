# CodeTask 自动化设计文档

## 1. 背景

当前 CodeTask 只能手动创建。本文档定义 CodeTask 的自动触发机制，
覆盖 regression 失败、exploration finding、测试草稿生成三个触发源。

---

## 2. 触发源

### 2.1 Regression 失败后自动创建

Run 完成且有失败用例时，AI 分析每个失败用例，生成 CodeTask draft。

```
regression run 完成（failed > 0）
  → AI 分析每个失败 testcase（已有 analyzeFailure()）
  → 生成 CodeTaskDraft
  → 若 autoApprove: false（默认）→ 状态 PENDING_APPROVAL，等待人工审批
  → 若 autoApprove: true → 直接进入 APPROVED，触发执行
```

### 2.2 Exploration finding 后自动创建

Exploration session 完成，对 findings 按页面+类型聚合后生成 CodeTask。

**聚合规则**：同一页面（`pageUrl`）+ 同一类型（`category`）的 findings 合并为一个 CodeTask，
避免产生大量细碎任务。

```
exploration session 完成
  → 按 (pageUrl, category) 分组聚合 findings
  → 每组提取出错 network 片段（见 §6.5）
  → AI 分析聚合后的 finding 组，生成一个 CodeTaskDraft
  → 同上 autoApprove 逻辑
```

聚合示例：
```
页面 /order，network-error × 3  → 1 个 CodeTask："修复 /order 页面网络请求错误"
页面 /order，console-error × 2  → 1 个 CodeTask："修复 /order 页面 JS 错误"
页面 /user，network-error × 1   → 1 个 CodeTask："修复 /user 页面网络请求错误"
```

### 2.3 测试草稿生成（不走 CodeTask）

Exploration 生成的测试文件（`.spec.ts`）不走 CodeTask 路径，
直接写入 `data/projects/<projectId>/generated-tests/<siteId>/`，
用户在测试集列表 review 后可手动触发"加入回归测试"（复制到目标项目 tests/ 目录）。

---

## 3. 自动审批配置

### 3.1 配置字段

在项目级别配置（`LocalRepo` 或全局 `config.local.yaml`）：

```yaml
codeTask:
  autoApprove: false          # 默认需要人工审批
  autoApproveMaxRiskLevel: low  # autoApprove: true 时，只自动审批 risk <= low 的任务
```

### 3.2 风险级别

CodeTask 创建时 AI 评估风险级别：

| 级别 | 含义 | 例子 |
|---|---|---|
| `low` | 只改测试文件或配置 | 修复 selector、更新 mock 数据 |
| `medium` | 改业务逻辑，影响范围小 | 修复单个 API handler |
| `high` | 改核心逻辑或多文件 | 修复数据库查询、重构模块 |

`autoApprove: true` + `autoApproveMaxRiskLevel: low` 时：
- `low` 风险 → 自动审批，直接执行
- `medium`/`high` 风险 → 仍需人工审批

---

## 4. 执行流程

```
PENDING_APPROVAL
  → 人工 approve（或 autoApprove）
  → APPROVED
  → 执行 CodeAgent（Codex CLI / Kiro CLI）
  → 产出：changed_files、diff、patch
  → VERIFY（运行相关测试验证修复）
  → verify 通过 → READY_TO_REVIEW
  → verify 失败 → VERIFY_FAILED（需人工决定是否强制 review）
  → 人工 review diff
  → REVIEW_ACCEPTED
  → 人工触发 commit（不自动 commit）
  → 生成真实 git commit → COMMITTED
```

---

## 5. 选择器缓存

### 5.1 问题

启动运行时选择器值（suite/scenario/tag/testcase）需要从测试文件扫描，
实时扫描大型项目慢。

### 5.2 设计

```sql
CREATE TABLE test_selector_cache (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites(id),
  repo_id     TEXT NOT NULL REFERENCES local_repos(id),
  type        TEXT NOT NULL,   -- suite | scenario | tag | testcase
  value       TEXT NOT NULL,
  source      TEXT NOT NULL,   -- scan | history
  last_seen   TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

**更新时机**（缓存失效触发重新扫描）：
- `LocalRepo.path` 变更时
- Run 完成时（从 `test_results` 聚合新的 testcaseId/scenarioId 写入缓存）
- 用户手动点击"刷新"

**扫描实现**：
- 扫描 `LocalRepo.path` 下所有 `**/*.spec.ts`
- 提取 `describe(` 名称 → `suite`
- 提取 `// @zarb-scenario-id` 注解 → `scenario`
- 提取 `test.tag(` 或 `@tag` 注解 → `tag`
- 提取 `// @zarb-testcase-id` 注解 → `testcase`

---

## 6. 实现阶段

### Phase 1：自动触发 CodeTask
- `RunService` regression 完成后自动调用 `aiEngine.analyzeFailure()` + 创建 CodeTask
- `ExplorationAgent` session 完成后触发 finding 分析 + 创建 CodeTask
- `autoApprove` 配置读取与风险级别判断

### Phase 2：选择器缓存
- 新增 `test_selector_cache` 表和 migration
- 扫描逻辑（正则提取注解）
- Run 完成时更新缓存
- API：`GET /projects/:id/sites/:siteId/selectors?type=suite`

### Phase 3：UI 接入
- 启动运行时选择器值改为下拉（调用缓存 API）
- 首页待审批 CodeTask 提醒（已有，保持）
- 设置页新增 `codeTask.autoApprove` 配置项
