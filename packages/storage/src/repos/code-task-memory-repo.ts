import type { Db } from '../db.js';

export type CodeTaskMemoryKind =
  | 'apply-failure'
  | 'verify-failure'
  | 'review-feedback'
  | 'retry-decision';

export interface CodeTaskMemoryRow {
  id: string;
  run_id: string;
  task_id: string;
  parent_task_id: string | null;
  testcase_id: string | null;
  attempt: number;
  kind: CodeTaskMemoryKind;
  summary: string;
  detail: string | null;
  files_json: string | null;
  commands_json: string | null;
  created_at: string;
}

export interface SaveCodeTaskMemoryInput {
  id: string;
  runId: string;
  taskId: string;
  parentTaskId?: string;
  testcaseId?: string;
  attempt: number;
  kind: CodeTaskMemoryKind;
  summary: string;
  detail?: string;
  filesJson?: string;
  commandsJson?: string;
  createdAt: string;
}

export class CodeTaskMemoryRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveCodeTaskMemoryInput): void {
    this.db.prepare(`
      INSERT INTO code_task_memories
        (id, run_id, task_id, parent_task_id, testcase_id, attempt, kind, summary, detail, files_json, commands_json, created_at)
      VALUES
        (@id, @runId, @taskId, @parentTaskId, @testcaseId, @attempt, @kind, @summary, @detail, @filesJson, @commandsJson, @createdAt)
    `).run({
      id: input.id,
      runId: input.runId,
      taskId: input.taskId,
      parentTaskId: input.parentTaskId ?? null,
      testcaseId: input.testcaseId ?? null,
      attempt: input.attempt,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail ?? null,
      filesJson: input.filesJson ?? null,
      commandsJson: input.commandsJson ?? null,
      createdAt: input.createdAt,
    });
  }

  listByTask(taskId: string): CodeTaskMemoryRow[] {
    return this.db.prepare(`
      SELECT *
      FROM code_task_memories
      WHERE task_id = ? OR parent_task_id = ?
      ORDER BY created_at DESC
    `).all(taskId, taskId) as CodeTaskMemoryRow[];
  }

  listRelevant(runId: string, testcaseId?: string, limit = 20): CodeTaskMemoryRow[] {
    if (testcaseId) {
      return this.db.prepare(`
        SELECT *
        FROM code_task_memories
        WHERE run_id = ? AND (testcase_id = ? OR testcase_id IS NULL)
        ORDER BY created_at DESC
        LIMIT ?
      `).all(runId, testcaseId, limit) as CodeTaskMemoryRow[];
    }
    return this.db.prepare(`
      SELECT *
      FROM code_task_memories
      WHERE run_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(runId, limit) as CodeTaskMemoryRow[];
  }
}
