import type { Db } from '../db.js';

export interface GeneratedTestRow {
  id: string;
  run_id: string;
  testcase_id: string | null;
  session_id: string | null;
  title: string;
  file_path: string;
  prompt_template_version: string;
  status: string;
  created_at: string;
}

export interface SaveGeneratedTestInput {
  id: string;
  runId: string;
  testcaseId?: string;
  sessionId?: string;
  title: string;
  filePath: string;
  promptTemplateVersion: string;
  status?: string;
  createdAt: string;
}

export class GeneratedTestRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveGeneratedTestInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO generated_tests
          (id, run_id, testcase_id, session_id, title, file_path, prompt_template_version, status, created_at)
        VALUES
          (@id, @runId, @testcaseId, @sessionId, @title, @filePath, @promptTemplateVersion, @status, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        testcaseId: input.testcaseId ?? null,
        sessionId: input.sessionId ?? null,
        title: input.title,
        filePath: input.filePath,
        promptTemplateVersion: input.promptTemplateVersion,
        status: input.status ?? 'draft',
        createdAt: input.createdAt,
      });
  }

  findByRun(runId: string): GeneratedTestRow[] {
    return this.db
      .prepare('SELECT * FROM generated_tests WHERE run_id = ? ORDER BY created_at DESC')
      .all(runId) as GeneratedTestRow[];
  }

  findById(id: string): GeneratedTestRow | undefined {
    return this.db
      .prepare('SELECT * FROM generated_tests WHERE id = ?')
      .get(id) as GeneratedTestRow | undefined;
  }
}
