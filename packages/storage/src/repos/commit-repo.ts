import type { Db } from '../db.js';
import type { CommitStatus } from '@zarb/shared-types';

export interface CommitRow {
  id: string;
  task_id: string;
  branch_name: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  status: CommitStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCommitRowInput {
  id: string;
  taskId: string;
  branchName?: string;
  commitMessage?: string;
  createdAt: string;
}

export class CommitRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateCommitRowInput): void {
    this.db
      .prepare(`
        INSERT INTO commit_records
          (id, task_id, branch_name, commit_sha, commit_message, status, created_at, updated_at)
        VALUES
          (@id, @taskId, @branchName, NULL, @commitMessage, 'pending', @createdAt, @createdAt)
      `)
      .run({
        id: input.id,
        taskId: input.taskId,
        branchName: input.branchName ?? null,
        commitMessage: input.commitMessage ?? null,
        createdAt: input.createdAt,
      });
  }

  update(
    id: string,
    fields: { status?: CommitStatus; commitSha?: string; branchName?: string; errorMessage?: string; updatedAt: string },
  ): void {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: fields.updatedAt };

    if (fields.status !== undefined) { sets.push('status = @status'); params['status'] = fields.status; }
    if (fields.commitSha !== undefined) { sets.push('commit_sha = @commitSha'); params['commitSha'] = fields.commitSha; }
    if (fields.branchName !== undefined) { sets.push('branch_name = @branchName'); params['branchName'] = fields.branchName; }
    if (fields.errorMessage !== undefined) { sets.push('error_message = @errorMessage'); params['errorMessage'] = fields.errorMessage; }

    this.db.prepare(`UPDATE commit_records SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  findByTaskId(taskId: string): CommitRow | undefined {
    return this.db
      .prepare('SELECT * FROM commit_records WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId) as CommitRow | undefined;
  }
}
