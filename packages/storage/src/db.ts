import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type Db = Database.Database;

/**
 * Open (or create) a SQLite database at the given path.
 * Enables WAL mode and foreign keys on every connection.
 */
export function openDb(dbPath: string): Db {
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
