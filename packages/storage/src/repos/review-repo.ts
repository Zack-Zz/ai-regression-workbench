import type { Db } from '../db.js';
import type { ReviewDecision } from '@zarb/shared-types';

export interface ReviewRow {
  id: string;
  task_id: string;
  reviewer: string | null;
  decision: ReviewDecision;
  comment: string | null;
  diff_hash: string | null;
  patch_hash: string | null;
  code_task_version: number | null;
  created_at: string;
}

export interface CreateReviewInput {
  id: string;
  taskId: string;
  reviewer?: string;
  decision: ReviewDecision;
  comment?: string;
  diffHash?: string;
  patchHash?: string;
  codeTaskVersion?: number;
  createdAt: string;
}

export class ReviewRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateReviewInput): void {
    this.db
      .prepare(`
        INSERT INTO reviews
          (id, task_id, reviewer, decision, comment, diff_hash, patch_hash, code_task_version, created_at)
        VALUES
          (@id, @taskId, @reviewer, @decision, @comment, @diffHash, @patchHash, @codeTaskVersion, @createdAt)
      `)
      .run({
        id: input.id,
        taskId: input.taskId,
        reviewer: input.reviewer ?? null,
        decision: input.decision,
        comment: input.comment ?? null,
        diffHash: input.diffHash ?? null,
        patchHash: input.patchHash ?? null,
        codeTaskVersion: input.codeTaskVersion ?? null,
        createdAt: input.createdAt,
      });
  }

  findByTaskId(taskId: string): ReviewRow | undefined {
    return this.db
      .prepare('SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId) as ReviewRow | undefined;
  }
}
