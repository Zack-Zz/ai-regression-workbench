-- Migration 032: default project for historical runs

INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at)
VALUES ('project-default', 'Default Project', 'Auto-created for historical runs', datetime('now'), datetime('now'));

UPDATE test_runs SET project_id = 'project-default' WHERE project_id IS NULL;
