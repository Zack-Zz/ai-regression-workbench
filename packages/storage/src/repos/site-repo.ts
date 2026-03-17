import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

export interface SiteRow {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  created_at: string;
  updated_at: string;
}

export interface SaveSiteInput {
  id?: string;
  projectId: string;
  name: string;
  baseUrl: string;
}

export class SiteRepository {
  constructor(private readonly db: Db) {}

  create(input: SaveSiteInput): SiteRow {
    const id = input.id ?? `site-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at)
       VALUES (@id, @projectId, @name, @baseUrl, @now, @now)`
    ).run({ id, projectId: input.projectId, name: input.name, baseUrl: input.baseUrl, now });
    return this.findById(id)!;
  }

  update(id: string, input: Partial<Pick<SaveSiteInput, 'name' | 'baseUrl'>>): void {
    const sets: string[] = ['updated_at = @now'];
    const params: Record<string, unknown> = { id, now: new Date().toISOString() };
    if (input.name !== undefined) { sets.push('name = @name'); params['name'] = input.name; }
    if (input.baseUrl !== undefined) { sets.push('base_url = @baseUrl'); params['baseUrl'] = input.baseUrl; }
    this.db.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  }

  findById(id: string): SiteRow | undefined {
    return this.db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as SiteRow | undefined;
  }

  findByProjectId(projectId: string): SiteRow[] {
    return this.db.prepare('SELECT * FROM sites WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as SiteRow[];
  }

  findByBaseUrl(baseUrl: string): SiteRow | undefined {
    const host = (() => { try { return new URL(baseUrl).hostname; } catch { return baseUrl; } })();
    return this.db.prepare("SELECT * FROM sites WHERE base_url LIKE '%' || ? || '%' LIMIT 1").get(host) as SiteRow | undefined;
  }
}
