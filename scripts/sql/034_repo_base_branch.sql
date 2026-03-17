-- Migration 034: add base_branch to local_repos
ALTER TABLE local_repos ADD COLUMN base_branch TEXT;
