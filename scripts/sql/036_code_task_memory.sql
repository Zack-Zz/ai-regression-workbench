CREATE TABLE IF NOT EXISTS code_task_memories (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES test_runs(run_id),
  task_id TEXT NOT NULL REFERENCES code_tasks(task_id),
  parent_task_id TEXT REFERENCES code_tasks(task_id),
  testcase_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  files_json TEXT,
  commands_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_task_memories_run_case_created
ON code_task_memories (run_id, testcase_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_task_memories_task_created
ON code_task_memories (task_id, created_at DESC);
