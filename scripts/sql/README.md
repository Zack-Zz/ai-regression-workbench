# SQL Scripts

## Files

- `010_storage_indexes.sql`
  Initialize recommended indexes for run detail, telemetry, timeline, and report queries.
- `020_cleanup_run_by_id.sql`
  Cleanup one run's database rows by `run_id` in a single transaction.

## Usage

Apply indexes:

```bash
sqlite3 ./.ai-regression-workbench/data/sqlite/app.db < scripts/sql/010_storage_indexes.sql
```

Cleanup one run:

```bash
sqlite3 ./.ai-regression-workbench/data/sqlite/app.db <<'SQL'
.parameter init
.parameter set :run_id run_20260313_001
.read scripts/sql/020_cleanup_run_by_id.sql
SQL
```

## Notes

- Run DB cleanup first, then remove run files under:
  - `.ai-regression-workbench/data/artifacts/<runId>`
  - `.ai-regression-workbench/data/diagnostics/<runId>`
  - `.ai-regression-workbench/data/analysis/<runId>`
  - `.ai-regression-workbench/data/agent-traces/<sessionId>`（与该 run 关联的 session）
  - `.ai-regression-workbench/data/runs/<runId>.json`
  - `.ai-regression-workbench/data/runs/<runId>-execution-report.json`
- `system_events` 不属于 run 级清理范围。
- If DB cleanup fails, do not remove files.
