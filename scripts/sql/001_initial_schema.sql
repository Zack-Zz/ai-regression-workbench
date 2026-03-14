-- Migration 001: initial schema
-- All path fields store paths relative to <tool-workspace>/data
-- Schema aligned with docs/design.md §13

CREATE TABLE IF NOT EXISTS test_runs (
  run_id                  TEXT PRIMARY KEY,
  run_mode                TEXT NOT NULL DEFAULT 'regression',
  trigger_type            TEXT,
  environment             TEXT,
  scope_type              TEXT NOT NULL,
  scope_value             TEXT,
  selector_json           TEXT NOT NULL DEFAULT '{}',
  exploration_config_json TEXT,
  status                  TEXT NOT NULL DEFAULT 'CREATED',
  pause_requested         INTEGER NOT NULL DEFAULT 0,
  current_stage           TEXT,
  paused_at               TEXT,
  workspace_path          TEXT NOT NULL,
  timeout_at              TEXT,
  started_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  ended_at                TEXT,
  total                   INTEGER,
  passed                  INTEGER,
  failed                  INTEGER,
  skipped                 INTEGER,
  summary                 TEXT,
  report_path             TEXT
);

CREATE TABLE IF NOT EXISTS test_results (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id       TEXT NOT NULL,
  scenario_id       TEXT,
  status            TEXT NOT NULL,
  error_type        TEXT,
  error_message     TEXT,
  duration_ms       INTEGER,
  screenshot_path   TEXT,
  video_path        TEXT,
  trace_path        TEXT,
  html_report_path  TEXT,
  network_log_path  TEXT,
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE(run_id, testcase_id)
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id     TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  entry_urls_json TEXT NOT NULL DEFAULT '[]',
  risk_tags_json  TEXT NOT NULL DEFAULT '[]',
  owner           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correlation_contexts (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id         TEXT,
  trace_ids_json      TEXT,
  request_ids_json    TEXT,
  session_ids_json    TEXT,
  service_hints_json  TEXT,
  from_time           TEXT,
  to_time             TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostic_fetches (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id   TEXT,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL,
  provider      TEXT,
  request_json  TEXT,
  summary_json  TEXT,
  raw_link      TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS failure_analysis (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id         TEXT,
  category            TEXT,
  suspected_layer     TEXT,
  confidence          REAL,
  summary             TEXT,
  probable_cause      TEXT,
  trace_summary_json  TEXT,
  log_summary_json    TEXT,
  suggestions_json    TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id        TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES test_runs(run_id),
  task_id           TEXT,
  kind              TEXT NOT NULL,
  agent_name        TEXT,
  status            TEXT NOT NULL,
  policy_json       TEXT,
  context_refs_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_id     TEXT,
  trace_path        TEXT,
  started_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  ended_at          TEXT,
  summary           TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES test_runs(run_id),
  session_id       TEXT,
  scenario_id      TEXT,
  category         TEXT NOT NULL,
  severity         TEXT NOT NULL,
  page_url         TEXT,
  title            TEXT NOT NULL,
  summary          TEXT,
  evidence_json    TEXT,
  promoted_task_id TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_tasks (
  task_id                   TEXT PRIMARY KEY,
  parent_task_id            TEXT,
  attempt                   INTEGER NOT NULL DEFAULT 1,
  run_id                    TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id               TEXT,
  analysis_id               TEXT,
  analysis_version          INTEGER,
  status                    TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  agent_name                TEXT,
  harness_session_id        TEXT,
  automation_level          TEXT NOT NULL DEFAULT 'headless',
  mode                      TEXT NOT NULL DEFAULT 'apply',
  target                    TEXT NOT NULL DEFAULT 'app',
  workspace_path            TEXT NOT NULL,
  scope_paths_json          TEXT,
  goal                      TEXT NOT NULL,
  constraints_json          TEXT,
  verification_commands_json TEXT,
  summary                   TEXT,
  changed_files_json        TEXT,
  diff_path                 TEXT,
  patch_path                TEXT,
  raw_output_path           TEXT,
  verify_passed             INTEGER,
  verify_override_used      INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES code_tasks(task_id),
  reviewer          TEXT,
  decision          TEXT NOT NULL,
  comment           TEXT,
  diff_hash         TEXT,
  patch_hash        TEXT,
  code_task_version INTEGER,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_records (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES code_tasks(task_id),
  branch_name    TEXT,
  commit_sha     TEXT,
  commit_message TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id                     TEXT PRIMARY KEY,
  run_id                 TEXT NOT NULL REFERENCES test_runs(run_id),
  entity_type            TEXT NOT NULL,
  entity_id              TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json           TEXT,
  created_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_events (
  id                     TEXT PRIMARY KEY,
  event_type             TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json           TEXT,
  created_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_call_records (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id      TEXT NOT NULL,
  flow_step_id     TEXT,
  ui_action_id     TEXT,
  method           TEXT,
  url              TEXT NOT NULL,
  status_code      INTEGER,
  response_summary TEXT,
  success          INTEGER NOT NULL,
  error_type       TEXT,
  error_message    TEXT,
  trace_id         TEXT,
  request_id       TEXT,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  duration_ms      INTEGER
);

CREATE TABLE IF NOT EXISTS ui_action_records (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id     TEXT NOT NULL,
  flow_step_id    TEXT,
  action_type     TEXT NOT NULL,
  locator         TEXT,
  page_url        TEXT,
  success         INTEGER NOT NULL,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  duration_ms     INTEGER,
  api_call_count  INTEGER,
  failed_api_count INTEGER
);

CREATE TABLE IF NOT EXISTS flow_step_records (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id      TEXT NOT NULL,
  flow_id          TEXT NOT NULL,
  step_name        TEXT NOT NULL,
  success          INTEGER NOT NULL,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  duration_ms      INTEGER,
  ui_action_count  INTEGER,
  api_call_count   INTEGER,
  failed_api_count INTEGER
);

CREATE TABLE IF NOT EXISTS execution_reports (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES test_runs(run_id),
  status       TEXT NOT NULL,
  report_path  TEXT NOT NULL,
  totals_json  TEXT,
  generated_at TEXT NOT NULL,
  UNIQUE(run_id)
);

-- Indexes (from storage-mapping-design.md §6)
CREATE INDEX IF NOT EXISTS idx_test_results_run_case_status
  ON test_results (run_id, testcase_id, status);

CREATE INDEX IF NOT EXISTS idx_correlation_contexts_run_case
  ON correlation_contexts (run_id, testcase_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_fetches_run_case_type_status
  ON diagnostic_fetches (run_id, testcase_id, type, status);

CREATE INDEX IF NOT EXISTS idx_api_call_records_run_case_started
  ON api_call_records (run_id, testcase_id, started_at);

CREATE INDEX IF NOT EXISTS idx_ui_action_records_run_case_started
  ON ui_action_records (run_id, testcase_id, started_at);

CREATE INDEX IF NOT EXISTS idx_flow_step_records_run_case_flow
  ON flow_step_records (run_id, testcase_id, flow_id);

CREATE INDEX IF NOT EXISTS idx_code_tasks_run_case_status_updated
  ON code_tasks (run_id, testcase_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_reviews_task_id
  ON reviews (task_id);

CREATE INDEX IF NOT EXISTS idx_commit_records_task_id
  ON commit_records (task_id);

CREATE INDEX IF NOT EXISTS idx_run_events_run_created
  ON run_events (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_system_events_created
  ON system_events (created_at);

CREATE INDEX IF NOT EXISTS idx_execution_reports_run_generated
  ON execution_reports (run_id, generated_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_run_task_status
  ON agent_sessions (run_id, task_id, status, started_at);
