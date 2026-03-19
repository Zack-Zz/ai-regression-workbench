import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

export interface SiteCredentialRow {
  id: string;
  site_id: string;
  label: string;
  auth_type: string;
  login_url: string | null;
  username_selector: string | null;
  password_selector: string | null;
  submit_selector: string | null;
  username: string | null;
  password: string | null;
  cookies_json: string | null;
  headers_json: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SaveCredentialInput {
  id?: string;
  siteId: string;
  label: string;
  authType?: 'userpass' | 'cookie' | 'token';
  loginUrl?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  username?: string;
  password?: string;
  cookiesJson?: string;
  headersJson?: string;
  sortOrder?: number;
}

export class SiteCredentialRepository {
  constructor(private readonly db: Db) {}

  create(input: SaveCredentialInput): SiteCredentialRow {
    const id = input.id ?? `cred-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO site_credentials
         (id, site_id, label, auth_type, login_url, username_selector, password_selector,
          submit_selector, username, password, cookies_json, headers_json, sort_order, created_at, updated_at)
       VALUES
         (@id, @siteId, @label, @authType, @loginUrl, @usernameSelector, @passwordSelector,
          @submitSelector, @username, @password, @cookiesJson, @headersJson, @sortOrder, @now, @now)`
    ).run({
      id, siteId: input.siteId, label: input.label,
      authType: input.authType ?? 'userpass',
      loginUrl: input.loginUrl ?? null,
      usernameSelector: input.usernameSelector ?? null,
      passwordSelector: input.passwordSelector ?? null,
      submitSelector: input.submitSelector ?? null,
      username: input.username ?? null,
      password: input.password ?? null,
      cookiesJson: input.cookiesJson ?? null,
      headersJson: input.headersJson ?? null,
      sortOrder: input.sortOrder ?? 0,
      now,
    });
    return this.findById(id)!;
  }

  update(id: string, input: Partial<Omit<SaveCredentialInput, 'id' | 'siteId'>>): void {
    const sets: string[] = ['updated_at = @now'];
    const params: Record<string, unknown> = { id, now: new Date().toISOString() };
    const fields: Array<[keyof typeof input, string]> = [
      ['label', 'label'], ['authType', 'auth_type'], ['loginUrl', 'login_url'],
      ['usernameSelector', 'username_selector'], ['passwordSelector', 'password_selector'],
      ['submitSelector', 'submit_selector'], ['username', 'username'], ['password', 'password'],
      ['cookiesJson', 'cookies_json'], ['headersJson', 'headers_json'], ['sortOrder', 'sort_order'],
    ];
    for (const [key, col] of fields) {
      if (input[key] !== undefined) { sets.push(`${col} = @${key}`); params[key] = input[key] as unknown; }
    }
    this.db.prepare(`UPDATE site_credentials SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM site_credentials WHERE id = ?').run(id);
  }

  findById(id: string): SiteCredentialRow | undefined {
    return this.db.prepare('SELECT * FROM site_credentials WHERE id = ?').get(id) as SiteCredentialRow | undefined;
  }

  findByIdAndSiteId(id: string, siteId: string): SiteCredentialRow | undefined {
    return this.db.prepare('SELECT * FROM site_credentials WHERE id = ? AND site_id = ?').get(id, siteId) as SiteCredentialRow | undefined;
  }

  findBySiteId(siteId: string): SiteCredentialRow[] {
    return this.db.prepare('SELECT * FROM site_credentials WHERE site_id = ? ORDER BY sort_order ASC').all(siteId) as SiteCredentialRow[];
  }

  findDefaultForSite(siteId: string): SiteCredentialRow | undefined {
    return this.db.prepare('SELECT * FROM site_credentials WHERE site_id = ? ORDER BY sort_order ASC LIMIT 1').get(siteId) as SiteCredentialRow | undefined;
  }
}
