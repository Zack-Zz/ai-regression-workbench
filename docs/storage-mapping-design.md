# 存储映射设计（字段级）

## 1. 目标

给出统一的存储映射规范，明确每类数据：

- 由谁写入
- 写到哪张 SQLite 表
- 对应哪些文件路径
- 在什么时机写入
- 由哪些 API/UI 读取（CLI 读取为未来扩展）

该文档用于约束实现与排障，避免“数据已落盘但无法检索”或“表结构与产物路径脱节”。

## 2. 总体原则

- 所有可写运行数据统一落在 `<tool-workspace>/data` 下。
- SQLite 负责结构化状态、索引和路径引用，不存大文件正文。
- 大文件与明细产物落文件系统，数据库保存路径和关键摘要。
- 以 `runId`、`testcaseId`、`taskId` 为主分区键，保证可按 run 清理和回放。
- 接口错误默认降级继续；仅关键阻断错误终止流程；run 终态必须产出执行报告。

## 3. 存储根目录

项目内模式：

```text
<repo>/.ai-regression-workbench/data
```

用户目录模式：

```text
~/.ai-regression-workbench/data
```

## 4. 字段级映射矩阵

| 领域对象 | 写入模块 | SQLite 表（关键字段） | 文件系统路径 | 写入时机 | 查询入口 |
| --- | --- | --- | --- | --- | --- |
| Run | Orchestrator / RunService | `test_runs`（`run_id`,`scope_type`,`scope_value`,`selector_json`,`status`） | `runs/<runId>.json`（可选快照） | `startRun` 创建、状态迁移、终态汇总 | `GET /runs`、`GET /runs/:runId` |
| TestResult | Test Runner | `test_results`（`run_id`,`testcase_id`,`status`,`duration_ms`） | `artifacts/<runId>/<testcaseId>/` 下 screenshot/video/trace/network | 用例执行完成后 | Run detail / failure report |
| CorrelationContext | Test Runner / Diagnostics | `correlation_contexts`（`trace_ids_json`,`request_ids_json`,`from_time`,`to_time`） | `diagnostics/<runId>/<testcaseId>/correlation-context.json` | 失败用例诊断前 | Failure report / diagnostics |
| DiagnosticFetch（Trace/Log） | Trace Bridge / Log Bridge | `diagnostic_fetches`（`type`,`status`,`provider`,`summary_json`,`raw_link`） | `diagnostics/<runId>/<testcaseId>/trace-summary.json`、`log-summary.json` | Trace/Log 查询后 | Diagnostics detail |
| ApiCallRecord | Test Runner | `api_call_records`（`run_id`,`testcase_id`,`flow_step_id`,`ui_action_id`,`url`,`status_code`,`duration_ms`） | `diagnostics/<runId>/<testcaseId>/api-calls.jsonl` | 网络请求完成时流式写入 | Execution profile / failure report |
| UiActionRecord | Test Runner | `ui_action_records`（`run_id`,`testcase_id`,`flow_step_id`,`action_type`,`duration_ms`） | `diagnostics/<runId>/<testcaseId>/ui-actions.jsonl` | 每个 UI 动作完成后 | Execution profile |
| FlowStepRecord | Test Runner / Orchestrator | `flow_step_records`（`run_id`,`testcase_id`,`flow_id`,`step_name`,`api_call_count`） | `diagnostics/<runId>/<testcaseId>/flow-steps.json` | 每个流程步骤完成后 | Execution profile / execution report |
| FailureAnalysis | AI Engine | `failure_analysis`（`run_id`,`testcase_id`,`category`,`summary`,`suggestions_json`） | `analysis/<runId>/<testcaseId>.json`（可选完整版） | AI 分析完成后 | Failure report / code-task draft |
| CodeTask | Orchestrator / CodeTaskService | `code_tasks`（`task_id`,`run_id`,`testcase_id`,`status`,`workspace_path`,`diff_path`,`patch_path`） | `code-tasks/<taskId>/input.json`、`raw-output.txt`、`changes.diff`、`changes.patch`、`verify.txt` | 任务创建、执行、verify 更新 | `GET /code-tasks/:taskId` |
| Review | ReviewService | `reviews`（`task_id`,`decision`,`comment`） | 可选附加到 `code-tasks/<taskId>/` | review 提交时 | `GET /code-tasks/:taskId/review` |
| CommitRecord | CommitService | `commit_records`（`task_id`,`branch_name`,`commit_sha`,`commit_message`） | `commits/<taskId>.json` | commit 成功后 | `GET /code-tasks/:taskId/commit` |
| RunEvent | Orchestrator / Services | `run_events`（`run_id`,`entity_type`,`entity_id`,`event_type`,`payload_json`） | 无（仅 DB） | 所有关键动作和状态迁移 | `GET /runs/:runId/events` |
| SettingsSnapshot | SettingsService / ConfigManager | `run_events`（`event_type=SETTINGS_UPDATED/SETTINGS_APPLIED`，不强依赖独立 settings 表） | `<tool-workspace>/config.local.yaml` | 设置保存与生效时 | `GET /settings`、`PUT /settings` |
| ExecutionReport | Orchestrator / RunService | `execution_reports`（`run_id`,`status`,`report_path`,`totals_json`,`generated_at`） | `runs/<runId>-execution-report.json` | Run 进入 `COMPLETED/FAILED/CANCELLED` | `GET /runs/:runId/execution-report` |
| Generated Tests | AI Engine / CodeAgent | 可选索引到 `code_tasks` 或后续 `generated_tests` 表 | `generated-tests/<taskId>/candidate.spec.ts` | 生成候选测试时 | Test assets 管理 / 后续执行选择 |

## 5. 写入顺序与一致性规则

### 5.1 文件与数据库双写

- 原子目标：DB 记录与文件路径一致可读。
- 推荐顺序：先写文件（临时文件 + rename），成功后写 DB 路径字段。
- 若文件写成功但 DB 失败：写 `RUN_STEP_DEGRADED`，重试 DB；不可恢复时记录 warning 并在执行报告体现。
- 若 DB 成功但文件缺失：标记产物损坏，在 `warnings` 标注并允许流程继续。

### 5.2 幂等与去重

- 主键采用稳定 ID（`runId/testcaseId/taskId` 组合 + 事件 UUID）。
- 同一阶段重试时允许 UPSERT 或版本更新，不产生重复终态记录。
- `execution_reports` 每个 `runId` 只保留最后一次有效报告路径。

## 6. 查询与索引建议

建议索引：

- `test_results(run_id, testcase_id, status)`
- `correlation_contexts(run_id, testcase_id)`
- `diagnostic_fetches(run_id, testcase_id, type, status)`
- `api_call_records(run_id, testcase_id, started_at)`
- `ui_action_records(run_id, testcase_id, started_at)`
- `flow_step_records(run_id, testcase_id, flow_id)`
- `code_tasks(run_id, testcase_id, status, updated_at)`
- `run_events(run_id, created_at)`
- `execution_reports(run_id, generated_at)`

目标查询延迟：

- Run 列表、Run 详情：`p95 < 300ms`
- 单 testcase 执行明细（接口/点击/流程）：`p95 < 500ms`
- Web UI 事件时间线增量读取：`p95 < 200ms`

## 7. 生命周期与清理策略

- 最小清理单元：`runId`。
- 清理 run 时必须同时删除：
  - `artifacts/<runId>`
  - `diagnostics/<runId>`
  - `analysis/<runId>`
  - `runs/<runId>.json`
  - `runs/<runId>-execution-report.json`
  - 相关 DB 行（`test_runs`、`test_results`、`run_events` 等）
- `code-tasks`、`commits` 可以按任务保留周期单独清理，避免误删审计数据。

## 8. 验收清单

- 同一 `runId` 能从 DB 反查到完整文件路径集合。
- `GET /runs/:runId/execution-report` 返回与 `runs/<runId>-execution-report.json` 一致。
- `GET /runs/:runId/testcases/:testcaseId/execution-profile` 能关联到 `api-calls.jsonl`、`ui-actions.jsonl`、`flow-steps.json`。
- 降级场景下仍能生成执行报告，并在 `warnings/degradedSteps` 明确缺失项。
- 清理命令执行后，不残留 run 相关孤儿文件或孤儿行。

补充说明：

- 当前业务操作与查看由 HTML Web UI 承载；CLI 的 `run/report/watch/settings` 读取能力为后续可选扩展，不作为第一阶段一致性要求。

## 9. SQL 草案（可执行）

### 9.1 索引 DDL

```sql
-- test results
CREATE INDEX IF NOT EXISTS idx_test_results_run_case_status
ON test_results (run_id, testcase_id, status);

-- correlation
CREATE INDEX IF NOT EXISTS idx_correlation_contexts_run_case
ON correlation_contexts (run_id, testcase_id);

-- diagnostics fetch
CREATE INDEX IF NOT EXISTS idx_diagnostic_fetches_run_case_type_status
ON diagnostic_fetches (run_id, testcase_id, type, status);

-- telemetry records
CREATE INDEX IF NOT EXISTS idx_api_call_records_run_case_started
ON api_call_records (run_id, testcase_id, started_at);

CREATE INDEX IF NOT EXISTS idx_ui_action_records_run_case_started
ON ui_action_records (run_id, testcase_id, started_at);

CREATE INDEX IF NOT EXISTS idx_flow_step_records_run_case_flow
ON flow_step_records (run_id, testcase_id, flow_id);

-- code task and review/commit related lookups
CREATE INDEX IF NOT EXISTS idx_code_tasks_run_case_status_updated
ON code_tasks (run_id, testcase_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_reviews_task_id
ON reviews (task_id);

CREATE INDEX IF NOT EXISTS idx_commit_records_task_id
ON commit_records (task_id);

-- timeline and reports
CREATE INDEX IF NOT EXISTS idx_run_events_run_created
ON run_events (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_execution_reports_run_generated
ON execution_reports (run_id, generated_at);
```

### 9.2 按 `runId` 清理 SQL（事务版）

```sql
-- 输入参数:
--   :run_id -> 要清理的 runId

BEGIN IMMEDIATE;

-- 1) 先删依赖 run 的明细表
DELETE FROM api_call_records
WHERE run_id = :run_id;

DELETE FROM ui_action_records
WHERE run_id = :run_id;

DELETE FROM flow_step_records
WHERE run_id = :run_id;

DELETE FROM diagnostic_fetches
WHERE run_id = :run_id;

DELETE FROM correlation_contexts
WHERE run_id = :run_id;

DELETE FROM test_results
WHERE run_id = :run_id;

DELETE FROM failure_analysis
WHERE run_id = :run_id;

DELETE FROM execution_reports
WHERE run_id = :run_id;

-- 2) 删除 code task 关联记录（先子后父）
DELETE FROM reviews
WHERE task_id IN (
  SELECT task_id
  FROM code_tasks
  WHERE run_id = :run_id
);

DELETE FROM commit_records
WHERE task_id IN (
  SELECT task_id
  FROM code_tasks
  WHERE run_id = :run_id
);

DELETE FROM code_tasks
WHERE run_id = :run_id;

-- 3) 删除事件与 run 主记录
DELETE FROM run_events
WHERE run_id = :run_id;

DELETE FROM test_runs
WHERE run_id = :run_id;

COMMIT;
```

### 9.3 清理后文件系统删除清单

```text
<tool-workspace>/data/artifacts/<runId>
<tool-workspace>/data/diagnostics/<runId>
<tool-workspace>/data/analysis/<runId>
<tool-workspace>/data/runs/<runId>.json
<tool-workspace>/data/runs/<runId>-execution-report.json
```

### 9.4 失败回滚与补偿建议

- SQL 事务失败时必须 `ROLLBACK`，禁止执行任何文件删除。
- SQL `COMMIT` 成功后再删文件，文件删除失败需记录 `RUN_STEP_DEGRADED` 并重试。
- 若发生“DB 已删、文件未删”，将 runId 放入清理补偿队列，后台重试。

### 9.5 对应脚本

- `scripts/sql/010_storage_indexes.sql`
- `scripts/sql/020_cleanup_run_by_id.sql`
- `scripts/sql/README.md`
