-- Storage index initialization script
-- Usage:
--   sqlite3 ./.ai-regression-workbench/data/sqlite/app.db < scripts/sql/010_storage_indexes.sql

BEGIN;

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

-- code task and review/commit lookups
CREATE INDEX IF NOT EXISTS idx_code_tasks_run_case_status_updated
ON code_tasks (run_id, testcase_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_reviews_task_id
ON reviews (task_id);

CREATE INDEX IF NOT EXISTS idx_commit_records_task_id
ON commit_records (task_id);

-- timeline and report lookups
CREATE INDEX IF NOT EXISTS idx_run_events_run_created
ON run_events (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_execution_reports_run_generated
ON execution_reports (run_id, generated_at);

COMMIT;
