import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db } from './db.js';

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version  TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

/**
 * Run all pending SQL migration files from the given directory.
 * Files must be named `NNN_description.sql` and are applied in lexicographic order.
 * Migrations are idempotent: already-applied versions are skipped.
 */
export function runMigrations(db: Db, migrationsDir: string): void {
  db.exec(MIGRATIONS_TABLE);

  const applied = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  );

  const dir = resolve(migrationsDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
      version,
      new Date().toISOString(),
    );
  }
}
