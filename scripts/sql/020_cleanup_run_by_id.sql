-- Cleanup script for one run
-- Required sqlite3 parameter:
--   :run_id  -> target run id
--
-- Example:
--   sqlite3 ./.zarb/data/sqlite/app.db <<'SQL'
--   .parameter init
--   .parameter set :run_id run_20260313_001
--   .read scripts/sql/020_cleanup_run_by_id.sql
--   SQL

BEGIN IMMEDIATE;

-- 1) delete run-scoped detail rows
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

DELETE FROM findings
WHERE run_id = :run_id;

DELETE FROM execution_reports
WHERE run_id = :run_id;

-- 2) delete code-task-linked rows (children first)
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

-- 3) delete harness session rows
DELETE FROM agent_sessions
WHERE run_id = :run_id;

-- 4) delete timeline and run root row
DELETE FROM run_events
WHERE run_id = :run_id;

DELETE FROM test_runs
WHERE run_id = :run_id;

COMMIT;
