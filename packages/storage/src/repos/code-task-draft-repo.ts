import type { Db } from '../db.js';

export interface CodeTaskDraftRow {
  id: string;
  run_id: string;
  analysis_id: string | null;
  goal: string;
  target: string;
  workspace_path: string;
  scope_paths_json: string | null;
  constraints_json: string | null;
  verification_commands_json: string | null;
  prompt_template_version: string;
  status: string;
  created_at: string;
}

export interface SaveCodeTaskDraftInput {
  id: string;
  runId: string;
  analysisId?: string;
  goal: string;
  target: string;
  workspacePath: string;
  scopePathsJson?: string;
  constraintsJson?: string;
  verificationCommandsJson?: string;
  promptTemplateVersion: string;
  status?: string;
  createdAt: string;
}

export class CodeTaskDraftRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveCodeTaskDraftInput): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO code_task_drafts
          (id, run_id, analysis_id, goal, target, workspace_path,
           scope_paths_json, constraints_json, verification_commands_json,
           prompt_template_version, status, created_at)
        VALUES
          (@id, @runId, @analysisId, @goal, @target, @workspacePath,
           @scopePathsJson, @constraintsJson, @verificationCommandsJson,
           @promptTemplateVersion, @status, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        analysisId: input.analysisId ?? null,
        goal: input.goal,
        target: input.target,
        workspacePath: input.workspacePath,
        scopePathsJson: input.scopePathsJson ?? null,
        constraintsJson: input.constraintsJson ?? null,
        verificationCommandsJson: input.verificationCommandsJson ?? null,
        promptTemplateVersion: input.promptTemplateVersion,
        status: input.status ?? 'draft',
        createdAt: input.createdAt,
      });
  }

  findByRun(runId: string): CodeTaskDraftRow[] {
    return this.db
      .prepare('SELECT * FROM code_task_drafts WHERE run_id = ? ORDER BY created_at DESC')
      .all(runId) as CodeTaskDraftRow[];
  }

  findById(id: string): CodeTaskDraftRow | undefined {
    return this.db
      .prepare('SELECT * FROM code_task_drafts WHERE id = ?')
      .get(id) as CodeTaskDraftRow | undefined;
  }
}
