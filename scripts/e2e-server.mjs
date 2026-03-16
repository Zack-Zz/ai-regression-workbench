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

// Import storage repos for test-only seeding
const { RunRepository, CodeTaskRepository } = await import(join(root, 'packages/storage/dist/index.js'));
const { createServer } = await import('node:http');

const appServer = createAppServer({ port: PORT, db, configPath: join(dir, 'config.yaml') });

// Extract the app's request listener and wrap it
const appListener = appServer.listeners('request')[0];

const server = createServer((req, res) => {
  // Test-only seed endpoint: POST /e2e-seed/code-task
  if (req.method === 'POST' && req.url === '/e2e-seed/code-task') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { taskId, runId } = JSON.parse(body);
        // Skip run creation if the run already exists (created via real API call)
        const existingRun = db.prepare('SELECT run_id FROM test_runs WHERE run_id=?').get(runId);
        if (!existingRun) {
          new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/tmp/e2e-ws', startedAt: new Date().toISOString() });
        }
        new CodeTaskRepository(db).create({ taskId, runId, workspacePath: '/tmp/e2e-ws', goal: 'fix test', createdAt: new Date().toISOString() });
        db.prepare("UPDATE code_tasks SET status='SUCCEEDED', attempt=1, diff_path='code-tasks/' || task_id || '/changes.diff' WHERE task_id=?").run(taskId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    return;
  }
  appListener(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`zarb e2e server ready at http://127.0.0.1:${String(PORT)}\n`);
});
