import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

export interface LocalRepoRow {
  id: string;
  project_id: string;
  name: string;
  path: string;
  description: string | null;
  test_output_dir: string | null;
  base_branch: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveLocalRepoInput {
  id?: string;
  projectId: string;
  name: string;
  path: string;
  description?: string;
  testOutputDir?: string;
  baseBranch?: string;
}

export class LocalRepoRepository {
  constructor(private readonly db: Db) {}

  create(input: SaveLocalRepoInput): LocalRepoRow {
    const id = input.id ?? `repo-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO local_repos (id, project_id, name, path, description, test_output_dir, base_branch, created_at, updated_at)
       VALUES (@id, @projectId, @name, @path, @description, @testOutputDir, @baseBranch, @now, @now)`
    ).run({
      id, projectId: input.projectId, name: input.name, path: input.path,
      description: input.description ?? null,
      testOutputDir: input.testOutputDir ?? null,
      baseBranch: input.baseBranch ?? null,
      now,
    });
    return this.findById(id)!;
  }

  update(id: string, input: Partial<Omit<SaveLocalRepoInput, 'id' | 'projectId'>>): void {
    const sets: string[] = ['updated_at = @now'];
    const params: Record<string, unknown> = { id, now: new Date().toISOString() };
    if (input.name !== undefined) { sets.push('name = @name'); params['name'] = input.name; }
    if (input.path !== undefined) { sets.push('path = @path'); params['path'] = input.path; }
    if (input.description !== undefined) { sets.push('description = @description'); params['description'] = input.description; }
    if (input.testOutputDir !== undefined) { sets.push('test_output_dir = @testOutputDir'); params['testOutputDir'] = input.testOutputDir; }
    if (input.baseBranch !== undefined) { sets.push('base_branch = @baseBranch'); params['baseBranch'] = input.baseBranch; }
    this.db.prepare(`UPDATE local_repos SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM local_repos WHERE id = ?').run(id);
  }

  findById(id: string): LocalRepoRow | undefined {
    return this.db.prepare('SELECT * FROM local_repos WHERE id = ?').get(id) as LocalRepoRow | undefined;
  }

  findByIdAndProjectId(id: string, projectId: string): LocalRepoRow | undefined {
    return this.db.prepare('SELECT * FROM local_repos WHERE id = ? AND project_id = ?').get(id, projectId) as LocalRepoRow | undefined;
  }

  findByProjectId(projectId: string): LocalRepoRow[] {
    return this.db.prepare('SELECT * FROM local_repos WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as LocalRepoRow[];
  }
}
