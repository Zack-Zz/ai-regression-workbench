-- Migration 002: add timeout_at to code_tasks
ALTER TABLE code_tasks ADD COLUMN timeout_at TEXT;
