import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveProjectInput {
  id?: string;
  name: string;
  description?: string;
}

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  create(input: SaveProjectInput): ProjectRow {
    const id = input.id ?? `project-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (@id, @name, @description, @now, @now)`
    ).run({ id, name: input.name, description: input.description ?? null, now });
    return this.findById(id)!;
  }

  update(id: string, input: Partial<Pick<SaveProjectInput, 'name' | 'description'>>): void {
    const sets: string[] = ['updated_at = @now'];
    const params: Record<string, unknown> = { id, now: new Date().toISOString() };
    if (input.name !== undefined) { sets.push('name = @name'); params['name'] = input.name; }
    if (input.description !== undefined) { sets.push('description = @description'); params['description'] = input.description; }
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  findById(id: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }

  list(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as ProjectRow[];
  }
}
