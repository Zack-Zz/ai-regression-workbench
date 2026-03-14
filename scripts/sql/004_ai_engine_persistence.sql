-- Migration 004: prompt traceability and CodeTaskDraft persistence

ALTER TABLE failure_analysis ADD COLUMN prompt_template_version TEXT;

CREATE TABLE IF NOT EXISTS code_task_drafts (
  id                        TEXT PRIMARY KEY,
  run_id                    TEXT NOT NULL REFERENCES test_runs(run_id),
  analysis_id               TEXT,
  goal                      TEXT NOT NULL,
  target                    TEXT NOT NULL DEFAULT 'app',
  workspace_path            TEXT NOT NULL DEFAULT '',
  scope_paths_json          TEXT,
  constraints_json          TEXT,
  verification_commands_json TEXT,
  prompt_template_version   TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'draft',
  created_at                TEXT NOT NULL
);
