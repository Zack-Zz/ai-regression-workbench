import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

export type SelectorType = 'suite' | 'scenario' | 'tag' | 'testcase';
export type SelectorSource = 'scan' | 'history';

export interface SelectorCacheRow {
  id: string;
  site_id: string;
  repo_id: string;
  type: SelectorType;
  value: string;
  source: SelectorSource;
  last_seen: string;
  updated_at: string;
}

export class SelectorCacheRepository {
  constructor(private readonly db: Db) {}

  upsert(siteId: string, repoId: string, type: SelectorType, value: string, source: SelectorSource): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO test_selector_cache (id, site_id, repo_id, type, value, source, last_seen, updated_at)
      VALUES (@id, @siteId, @repoId, @type, @value, @source, @now, @now)
      ON CONFLICT(site_id, repo_id, type, value) DO UPDATE SET
        source = excluded.source, last_seen = excluded.last_seen, updated_at = excluded.updated_at
    `).run({ id: randomUUID(), siteId, repoId, type, value, source, now });
  }

  find(siteId: string, repoId: string, type?: SelectorType): SelectorCacheRow[];
  find(siteId: string, repoId: string, type: SelectorType | undefined, ignoreKeys: true): SelectorCacheRow[];
  find(siteId: string, repoId: string, type?: SelectorType, ignoreKeys?: boolean): SelectorCacheRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!ignoreKeys && siteId) { conditions.push('site_id = ?'); params.push(siteId); }
    if (!ignoreKeys && repoId) { conditions.push('repo_id = ?'); params.push(repoId); }
    if (type) { conditions.push('type = ?'); params.push(type); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(
      `SELECT * FROM test_selector_cache ${where} ORDER BY type, value`
    ).all(...params) as SelectorCacheRow[];
  }

  db_findAll(): SelectorCacheRow[] {
    return this.db.prepare('SELECT * FROM test_selector_cache ORDER BY type, value').all() as SelectorCacheRow[];
  }

  db_findByType(type: SelectorType): SelectorCacheRow[] {
    return this.db.prepare('SELECT * FROM test_selector_cache WHERE type = ? ORDER BY value').all(type) as SelectorCacheRow[];
  }

  deleteByRepo(repoId: string): void {
    this.db.prepare('DELETE FROM test_selector_cache WHERE repo_id = ?').run(repoId);
  }
}
