# SQL Scripts

## Files

- `010_storage_indexes.sql`
  Initialize recommended indexes for run detail, telemetry, timeline, and report queries.
- `020_cleanup_run_by_id.sql`
  Cleanup one run's database rows by `run_id` in a single transaction.

## Usage

Apply indexes:

```bash
sqlite3 ./.zarb/data/sqlite/app.db < scripts/sql/010_storage_indexes.sql
```

Cleanup one run:

```bash
sqlite3 ./.zarb/data/sqlite/app.db <<'SQL'
.parameter init
.parameter set :run_id run_20260313_001
.read scripts/sql/020_cleanup_run_by_id.sql
SQL
```

## Notes

- Run DB cleanup first, then remove run files under:
  - `.zarb/data/artifacts/<runId>`
  - `.zarb/data/diagnostics/<runId>`
  - `.zarb/data/analysis/<runId>`
  - `.zarb/data/agent-traces/<sessionId>`（与该 run 关联的 session）
  - `.zarb/data/runs/<runId>.json`
  - `.zarb/data/runs/<runId>-execution-report.json`
- `system_events` 不属于 run 级清理范围。
- If DB cleanup fails, do not remove files.
