-- Migration 031: add project_id and site_id to test_runs

ALTER TABLE test_runs ADD COLUMN project_id TEXT;
ALTER TABLE test_runs ADD COLUMN site_id TEXT;

CREATE INDEX IF NOT EXISTS idx_test_runs_project_site ON test_runs(project_id, site_id, started_at);
