-- Migration 035: add credential_id to test_runs
ALTER TABLE test_runs ADD COLUMN credential_id TEXT;
