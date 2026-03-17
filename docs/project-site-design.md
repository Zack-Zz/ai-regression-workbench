# 项目与站点管理设计文档

## 1. 背景

当前系统使用全局配置 `workspace.targetProjectPath` 绑定单一代码目录，
所有 Run 共用同一个工作区。这个设计无法支持多项目、多域名、多代码仓库的场景。

本文档定义项目（Project）和站点（Site）模型，以及相关的配置体系、UI 导航、
数据目录结构的重设计。

---

## 2. 核心数据模型

### 2.1 Project（项目）

逻辑命名空间，由用户自定义，用于区分不同业务。

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,   -- project-<uuid>
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 2.2 Site（站点）

一个项目下的具体域名/网站。一个域名属于一个项目，一个项目包含多个站点。

```sql
CREATE TABLE sites (
  id          TEXT PRIMARY KEY,   -- site-<uuid>
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,      -- 显示名，如"管理后台"
  base_url    TEXT NOT NULL,      -- 如 https://manager.example.com
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 2.2.1 SiteCredential（站点账号）

每个站点可配置多组账号，用于探索或回归测试时的认证。持久化存储，密码明文保存（本地工具，不做加密）。

```sql
CREATE TABLE site_credentials (
  id           TEXT PRIMARY KEY,   -- cred-<uuid>
  site_id      TEXT NOT NULL REFERENCES sites(id),
  label        TEXT NOT NULL,      -- 账号标识，如"管理员"、"普通用户"
  login_url    TEXT,               -- 登录页 URL（userpass 模式）
  username_selector TEXT,          -- 用户名输入框 selector
  password_selector TEXT,          -- 密码输入框 selector
  submit_selector   TEXT,          -- 提交按钮 selector
  username     TEXT,
  password     TEXT,
  cookies_json TEXT,               -- cookie 模式：JSON 数组
  headers_json TEXT,               -- token/header 模式：JSON 对象
  auth_type    TEXT NOT NULL DEFAULT 'userpass',  -- userpass | cookie | token
  sort_order   INTEGER NOT NULL DEFAULT 0,        -- 排序，第一个为默认
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

启动运行时，选择完项目→站点后，可选择一组账号（默认第一组，`sort_order` 最小）。不选则使用默认。

### 2.3 LocalRepo（本地代码仓库）

项目绑定的本地代码目录，CodeTask 执行时使用。替代全局 `workspace.targetProjectPath`。

```sql
CREATE TABLE local_repos (
  id           TEXT PRIMARY KEY,   -- repo-<uuid>
  project_id   TEXT NOT NULL REFERENCES projects(id),
  name         TEXT NOT NULL,      -- 如"前端工程"、"BFF 服务"
  path         TEXT NOT NULL,      -- 本地绝对路径
  description  TEXT,               -- AI 可读的描述，用于 CodeTask 自动选择工程目录
  test_output_dir TEXT,            -- AI 生成测试文件的写入目录，如 tests/ai-generated
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

**CodeTask 工程目录选择策略**：
- CodeTask 创建时自动关联项目下所有 LocalRepo（含 `description`）
- AI 根据 finding/failure 内容 + 各 repo 的 `description` 前置判断目标工程
- 实际执行由 kiro-cli 在目标目录内自主处理
- `description` 建议填写：技术栈、负责的业务模块、主要文件结构

**AI 生成测试文件写入位置**：
- 写入 `LocalRepo.test_output_dir`（可配置，默认 `tests/ai-generated`）
- 按站点子目录区分：`<test_output_dir>/<siteId>/`
- 同域名同流程文件覆盖更新

### 2.4 Run 新增字段

```sql
ALTER TABLE test_runs ADD COLUMN project_id TEXT;
ALTER TABLE test_runs ADD COLUMN site_id TEXT;
```

历史数据迁移：归入系统自动创建的"默认项目"（`project-default`）。

---

## 3. 配置体系调整

### 3.1 移除全局字段

`config.local.yaml` 中以下字段**移除**：
- `workspace.targetProjectPath`
- `workspace.allowOutsideToolWorkspace`

这两个字段改为跟着 `LocalRepo` 走，在项目管理页面配置。

### 3.2 保留全局字段

真正全局的配置保留：
- `ai`（AI provider 配置）
- `trace`（trace provider）
- `logs`（log provider）
- `diagnostics`
- `codeAgent`（engine 类型）

### 3.3 Doctor 检查调整

`doctor` 不再检查全局 `workspace.targetProjectPath`，
改为检查"是否存在至少一个项目和站点"。

---

## 4. 数据目录结构

按项目 ID 划分，避免不同项目数据串混：

```
.ai-regression-workbench/data/
  projects/
    <projectId>/           ← 使用 project ID，不用项目名
      runs/
        <runId>/
          artifacts/
          diagnostics/
          analysis/
          code-tasks/
      agent-traces/
        <sessionId>/
          context-summary.json
          steps.jsonl
          tool-calls.jsonl
          network.jsonl
          screenshots/
            step-0.png
      generated-tests/
        <siteId>/
          <flow-name>.spec.ts
  sqlite/
    zarb.db               ← 数据库仍全局共享
```

`RunService` 的 `dataRoot` 从全局改为 `data/projects/<projectId>/`。

---

## 5. UI 导航结构

### 5.1 一级导航

```
首页 | 项目 | 运行 | 代码任务 | 设置
```

### 5.2 各页面职责

**首页**
- 快速启动入口（选择项目 → 站点 → 运行）
- 待审批 CodeTask 提醒
- 最近运行摘要

**项目页（一级导航）**
- 项目列表，每个项目卡片显示：站点数、最近运行状态、代码仓库数
- 点击项目 → 项目详情页
  - 站点列表（含最近运行状态、快速启动按钮）
  - 本地代码仓库列表（路径、状态）
  - 该项目的运行历史（跳转到运行列表并按项目筛选）
  - 该项目的测试集列表
  - 删除项目按钮（需二次确认）

**运行页（一级导航）**
- 运行列表，支持按项目、站点、模式、状态筛选
- 每条运行可删除

**代码任务页（一级导航，现有）**
- 保持现有结构，新增按项目筛选

**设置页**
- 移除 workspace 配置区
- 保留 AI、trace、log、codeAgent 全局配置

---

## 6. 启动运行流程（UI 重设计）

### 6.1 启动运行时的认证选择

选择完项目→站点后，若该站点有配置账号，显示账号选择下拉（默认第一组）：

```
Step 2: 选择站点  [管理后台 ▼]
Step 2.1: 选择账号  [管理员 (admin@example.com) ▼]  ← 有账号时显示
```

### 6.2 正常流程（已有项目）

```
首页"快速启动"
  Step 1: 选择项目（下拉）
  Step 2: 选择站点（下拉，跟随项目）
  Step 3: 选择模式（regression / exploration / hybrid）
  Step 4a（regression）:
    - 选择器类型（suite / scenario / tag / testcase）
    - 选择器值（下拉，从测试文件扫描 + 历史记录聚合）
  Step 4b（exploration）:
    - 起始 URL（自动填入 site.baseUrl，可修改）
    - 认证配置（折叠区，见 exploration-design.md §3）
    - maxSteps / maxPages / focusAreas
  启动
```

### 6.2 首次使用引导（无项目时）

点击"启动运行"时检测到无项目，弹出引导弹窗：

```
┌─────────────────────────────────────┐
│  欢迎使用 zarb                  [×] │
├─────────────────────────────────────┤
│  还没有项目，先创建一个吧           │
│                                     │
│  项目名称  [________________]       │
│  描述      [________________]       │
│                                     │
│  站点名称  [________________]       │
│  站点 URL  [________________]       │
│                                     │
│  本地代码目录（可选）               │
│  [________________]  [选择目录]     │
│                                     │
│  [跳过]              [创建并继续]   │
└─────────────────────────────────────┘
```

### 6.3 新域名归属弹窗

exploration 时输入的 URL 域名不属于任何已有站点，弹出：

```
┌─────────────────────────────────────┐
│  新站点                         [×] │
├─────────────────────────────────────┤
│  检测到新域名：manager.example.com  │
│  请选择归属项目或新建项目           │
│                                     │
│  ● 归入已有项目  [项目下拉▼]        │
│  ○ 新建项目      [项目名称输入框]   │
│                                     │
│  站点名称  [管理后台__________]     │
│                                     │
│  [取消]              [确认]         │
└─────────────────────────────────────┘
```

---

## 7. 测试集管理

### 7.1 存储

AI 生成的测试文件存储路径：
```
data/projects/<projectId>/generated-tests/<siteId>/<flow-name>.spec.ts
```

文件头部标注 AI 生成标识：
```ts
// @zarb-generated
// site: https://manager.example.com
// flow: user-login
// generated-at: 2026-03-17T05:00:00.000Z
// DO NOT EDIT — regenerate via zarb
```

### 7.2 测试集列表页

在项目详情页内展示，按站点分组：

```
项目：电商平台
├─ 站点：管理后台 (manager.example.com)
│   ├─ 🤖 user-login.spec.ts        [AI生成] 最近运行: ✓ 2026-03-17
│   ├─ 🤖 order-management.spec.ts  [AI生成] 最近运行: ✗ 2026-03-16
│   └─ 📝 smoke.spec.ts             [手动]   最近运行: ✓ 2026-03-17
└─ 站点：用户端 (www.example.com)
    └─ 🤖 checkout-flow.spec.ts     [AI生成] 最近运行: -
```

点击文件名 → 弹窗查看文件内容（代码高亮，只读）。

### 7.3 生成时机

`ExplorationConfig.persistAsCandidateTests`（默认 `true`）控制是否在 exploration 完成后自动生成。

生成流程：
1. exploration session 完成
2. AI 分析 `steps.jsonl` + `network.jsonl`，识别业务流程
3. 为每个流程生成 `GeneratedTestDraft`（已有表）
4. 写入 `data/projects/<projectId>/generated-tests/<siteId>/` 目录
5. 同域名同流程的文件**覆盖更新**（不重复创建）

---

## 8. 删除操作

所有删除均需二次确认弹窗，说明级联影响：

| 删除对象 | 级联删除 |
|---|---|
| 项目 | 该项目下所有站点、本地仓库、运行记录、生成测试、数据目录 |
| 站点 | 该站点下所有运行记录、生成测试 |
| 本地仓库 | 仅删除仓库记录，不删除本地文件 |
| 运行记录 | 该 run 的 artifacts、分析结果、关联 CodeTask |

---

## 9. Schema 迁移策略

启动时 `runMigrations()` 自动执行，新增 migration 文件：

```
scripts/sql/030_projects_sites.sql     ← projects / sites / local_repos 表
scripts/sql/031_runs_project_site.sql  ← test_runs 新增 project_id / site_id
scripts/sql/032_default_project.sql    ← 插入默认项目，历史 run 归入
```

迁移幂等，重复执行安全。

---

## 10. 实现阶段

### Phase 1：数据模型与 API
- 新增 `projects` / `sites` / `local_repos` 表和 migration
- `test_runs` 新增 `project_id` / `site_id`
- 新增 CRUD API：`/projects`、`/projects/:id/sites`、`/projects/:id/repos`
- 运行 API 新增 `projectId` / `siteId` 参数
- `RunService` 的 `dataRoot` 改为按项目路径

### Phase 2：UI 项目管理页
- 项目列表页（一级导航）
- 项目详情页（站点、仓库、运行历史、测试集）
- 首次使用引导弹窗
- 新域名归属弹窗

### Phase 3：启动流程重设计
- `QuickRunPanel` 改为项目 → 站点 → 模式 → 选择器的级联选择
- 选择器值改为下拉（扫描测试文件 + 历史聚合）
- 全局配置移除 workspace 字段

### Phase 4：测试集管理
- 生成测试文件写入按项目分目录
- 项目详情页测试集列表
- 文件内容查看弹窗
