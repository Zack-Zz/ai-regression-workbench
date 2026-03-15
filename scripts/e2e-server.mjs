/**
 * Minimal API server for e2e tests.
 * Uses the compiled CLI dist so all workspace deps resolve correctly.
 * Runs on port 3910 to match the Vite proxy config (/api -> :3910).
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Resolve paths relative to workspace root (this file lives in scripts/)
const root = fileURLToPath(new URL('..', import.meta.url));

const { openDb, runMigrations } = await import(join(root, 'packages/storage/dist/index.js'));
const { createAppServer } = await import(join(root, 'apps/cli/dist/server.js'));

const MIGRATIONS_DIR = join(root, 'scripts/sql');
const dir = mkdtempSync(join(tmpdir(), 'zarb-e2e-'));
const db = openDb(join(dir, 'e2e.db'));
runMigrations(db, MIGRATIONS_DIR);

const PORT = Number(process.env['E2E_API_PORT'] ?? 3910);

const server = createAppServer({ port: PORT, db, configPath: join(dir, 'config.yaml') });
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`zarb e2e server ready at http://127.0.0.1:${String(PORT)}\n`);
});
