-- Migration 003: generated_tests table
CREATE TABLE IF NOT EXISTS generated_tests (
  id                      TEXT PRIMARY KEY,
  run_id                  TEXT NOT NULL REFERENCES test_runs(run_id),
  testcase_id             TEXT,
  session_id              TEXT,
  title                   TEXT NOT NULL,
  file_path               TEXT NOT NULL,
  prompt_template_version TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',
  created_at              TEXT NOT NULL
);
