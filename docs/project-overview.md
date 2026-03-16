# ai-regression-workbench 项目全景

## 一、这个项目是什么

一个**本地优先的 AI 辅助回归测试 + 受控代码修复工作台**，CLI 命令叫 `zarb`（Zack AI Regression Bench）。

核心理念：**人类始终在控制链路上**。AI 只能生成草稿和建议，所有代码执行、提交都需要人工审批。

---

## 二、完整工作流

```
1. 跑 Playwright 回归测试
        ↓ 有失败
2. 收集 artifacts（截图、trace、日志）
        ↓
3. 关联诊断（Jaeger trace + Loki 日志）
        ↓
4. AI 分析失败原因 → 生成 CodeTask 草稿
        ↓
5. 人工审批 CodeTask（approve / reject）
        ↓ approved
6. Agent Harness 执行 codex exec 修复代码
   状态机：APPROVED → RUNNING → VERIFYING → SUCCEEDED / FAILED
        ↓ SUCCEEDED
7. 人工 Review diff（accept / reject / retry）
        ↓ accepted
8. CommitManager 提交（只 stage changedFiles）
        ↓
9. COMMITTED ✓
```

---

## 三、仓库结构

```
ai-regression-workbench/
├── apps/
│   ├── cli/                       # ★ 核心：HTTP API server + zarb CLI 入口
│   │   ├── src/
│   │   │   ├── bin.ts             # zarb 命令入口（init / doctor / 默认启动）
│   │   │   ├── server.ts          # createAppServer：HTTP server + 静态 UI serving
│   │   │   ├── router.ts          # 轻量 HTTP 路由器
│   │   │   ├── handlers/index.ts  # 所有 REST 路由定义
│   │   │   └── services/
│   │   │       ├── run-service.ts
│   │   │       ├── code-task-service.ts
│   │   │       ├── diagnostics-service.ts
│   │   │       ├── settings-service.ts
│   │   │       ├── doctor-service.ts
│   │   │       └── init-service.ts
│   │   └── test/
│   │
│   ├── local-ui/                  # React Web UI（Vite 构建）
│   │   ├── src/                   # React 组件、API 调用、i18n
│   │   ├── dist/                  # 构建产物（由 server.ts 静态 serve）
│   │   └── e2e/
│   │       ├── workbench.spec.ts
│   │       └── product-loop.spec.ts
│   │
│   ├── orchestrator/              # Run / CodeTask 状态机（纯逻辑，无 IO）
│   ├── test-runner/               # 真实 Playwright 执行器
│   ├── ai-engine/                 # AI 分析 + CodeTask 草稿生成
│   ├── review-manager/            # CommitManager：git staging + commit
│   ├── trace-bridge/              # Jaeger trace 查询适配器
│   └── log-bridge/                # Loki 日志查询适配器
│
├── packages/
│   ├── shared-types/              # ★ 所有 DTO、枚举、接口定义
│   │   ├── dtos.ts                # RunDetail、CodeTaskDetail、StartRunResult 等
│   │   ├── enums.ts               # RunStatus、CodeTaskStatus 等
│   │   └── services.ts            # StartRunInput、SubmitReviewInput 等
│   ├── storage/                   # SQLite 封装 + Repository 层
│   │   ├── db.ts                  # openDb、runMigrations
│   │   └── repos/                 # RunRepo、CodeTaskRepo、CommitRepo 等
│   ├── agent-harness/             # Agent 运行时
│   │   ├── codex-cli-agent.ts     # CodexCliAgent：调用 codex exec
│   │   ├── artifact-writer.ts     # 捕获 diff / patch / untracked 文件
│   │   └── session-manager.ts     # 会话管理、policy 执行
│   ├── config/                    # 配置加载、默认值、版本快照
│   ├── event-store/               # Run 事件、系统事件持久化
│   ├── logger/                    # 日志工具
│   ├── shared-utils/              # 通用工具函数
│   └── test-assets/               # 内置 Playwright 测试用例（smoke / regression）
│
└── scripts/
    ├── sql/                       # 数据库迁移脚本（001~021）
    └── e2e-server.mjs             # e2e 测试专用 API server
```

---

## 四、数据模型（SQLite）

数据文件根目录：`.ai-regression-workbench/data/`

| 表 | 说明 |
|---|---|
| `test_runs` | Run 记录，含状态、selector、workspacePath |
| `code_tasks` | CodeTask 记录，含状态、attempt、diff_path、verify_passed |
| `commit_records` | Commit 记录，含 branchName |
| `reviews` | Review 决策记录 |
| `run_events` | Run 生命周期事件流 |
| `testcase_results` | 每个测试用例的执行结果 |
| `failure_snapshots` | 失败快照（截图、错误信息） |
| `diagnostics_records` | 诊断关联数据 |
| `analysis_records` | AI 分析结果 |
| `generated_tests` | AI 生成的候选测试 |

---

## 五、状态机

**Run 状态：**

```
CREATED → RUNNING_TESTS → ANALYZING_FAILURES → COMPLETED
                        ↘ FAILED
       ↘ CANCELLED（任意阶段可 cancel）
```

**CodeTask 状态：**

```
DRAFT → PENDING_APPROVAL → APPROVED → RUNNING → VERIFYING → SUCCEEDED
                         ↘ REJECTED                        ↘ FAILED ──(forceReview)──↗
                                                                    ↘ CANCELLED
SUCCEEDED → PENDING_REVIEW → COMMIT_PENDING → COMMITTED
```

---

## 六、REST API 概览

所有响应格式：`{ success: boolean, data: T }`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/runs` | 启动 Run |
| GET | `/runs` | 列表（分页） |
| GET | `/runs/:id` | Run 详情（RunDetail） |
| POST | `/runs/:id/cancel` | 取消 |
| POST | `/runs/:id/pause` | 暂停 |
| POST | `/runs/:id/resume` | 恢复 |
| GET | `/runs/:id/failure-reports` | 失败报告列表 |
| GET | `/runs/:id/testcases/:tcId/diagnostics` | 诊断数据 |
| GET | `/runs/:id/testcases/:tcId/trace` | Trace 数据 |
| GET | `/runs/:id/testcases/:tcId/logs` | 日志数据 |
| GET | `/runs/:id/testcases/:tcId/analysis` | AI 分析结果 |
| POST | `/runs/:id/testcases/:tcId/analysis/retry` | 重新触发分析 |
| GET | `/code-tasks` | CodeTask 列表 |
| GET | `/code-tasks/:id` | CodeTask 详情 |
| POST | `/code-tasks/:id/approve` | 审批通过 |
| POST | `/code-tasks/:id/reject` | 拒绝 |
| POST | `/code-tasks/:id/execute` | 触发执行（fire-and-forget） |
| POST | `/code-tasks/:id/retry` | 重试 |
| POST | `/code-tasks/:id/cancel` | 取消 |
| POST | `/reviews` | 提交 Review（accept / reject / retry） |
| POST | `/commits` | 触发 Commit |
| GET | `/settings` | 读取配置 |
| PUT | `/settings` | 更新配置 |
| POST | `/settings/validate` | 校验配置 |
| GET | `/doctor` | 环境健康检查 |

---

## 七、关键设计约束

**changedFiles 必须系统生成**
CommitManager 只 stage `code_tasks.changed_files` 里的文件，由 ArtifactWriter 通过 `git diff --name-only` 和 `git ls-files --others` 计算，不接受 agent 自报。

**taskVersion 防重放**
`submitReview` 要求 `codeTaskVersion === row.attempt`，防止对旧版本 diff 的 review 被接受。

**FAILED 状态需要 override**
verify 失败的 task 要 review 必须传 `forceReviewOnVerifyFailure=true`，且 `diff_path` 必须存在。

**路径安全**
静态文件 serving 校验 `resolve(filePath).startsWith(uiDist)`，防止路径穿越。workspace path 在 CommitManager 里也有 `resolve()` 校验。

**fire-and-forget 执行**
`executeCodeTask` 立即返回 200，后台异步跑 `runExecution`，状态通过轮询 `GET /code-tasks/:id` 获取。

---

## 八、本地开发

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 单元测试（319 tests，19 files）
pnpm test

# e2e 测试（33 tests，3 browsers）
pnpm test:e2e

# 类型检查
pnpm -r typecheck

# Lint
pnpm lint

# 启动（首次）
node apps/cli/dist/bin.js init    # 创建 .ai-regression-workbench/ 目录和默认配置
node apps/cli/dist/bin.js doctor  # 检查环境依赖
node apps/cli/dist/bin.js         # 启动服务，默认 http://127.0.0.1:3000
```

配置文件：`.ai-regression-workbench/config.local.yaml`

---

## 九、外部依赖

| 依赖 | 用途 | 必须 |
|---|---|---|
| Node.js ≥ 22 | 运行时 | ✓ |
| git | diff / patch / commit | ✓ |
| Playwright + browsers | 跑测试 | ✓（测试功能） |
| `codex` CLI | AI 代码修复执行 | ✓（修复功能） |
| OpenAI API Key | AI 分析 + 修复 | ✓（AI 功能） |
| Jaeger | Trace 查询 | 可选 |
| Loki | 日志查询 | 可选 |

---

## 十、Phase 完成状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0–10 | 基础架构、API、UI、Doctor、Hardening | ✅ pass |
| 11 | 真实 Playwright 测试执行 | ✅ pass |
| 12 | 真实 Diagnostics 集成 | ✅ pass |
| 13 | 真实 CodeTask 执行（CodexCliAgent） | ✅ pass |
| 14 | 真实 Review + Commit 控制 | ✅ pass |
| 15 | 产品打包与初始化（zarb init / doctor / UI serving） | ✅ pass |
| 16 | Release Readiness（e2e 全链路、安全、文档） | ✅ pass |
