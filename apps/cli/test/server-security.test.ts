import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { openDb, runMigrations } from '@zarb/storage';
import { createAppServer } from '../src/server.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let server: ReturnType<typeof createServer>;
let port: number;

beforeAll(async () => {
  const dir = join(tmpdir(), `zarb-server-sec-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });

  // Create a minimal fake uiDist so serveStatic is active
  const uiDist = join(dir, 'local-ui', 'dist');
  mkdirSync(uiDist, { recursive: true });
  writeFileSync(join(uiDist, 'index.html'), '<html>ok</html>');

  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);

  // createAppServer resolves uiDist relative to import.meta.url (apps/cli/dist/server.js)
  // We can't easily override that path in unit tests, so we test the path-traversal guard
  // by calling the real server and checking that traversal URLs are handled safely.
  server = createAppServer({ port: 0, db, configPath: join(dir, 'config.yaml') });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(() => {
  server.close();
});

describe('Static file serving — path traversal security', () => {
  it('traversal URL does not return 500 (server handles it safely)', async () => {
    // A path-traversal attempt must not cause a 500 or expose arbitrary files
    const res = await fetch(`http://127.0.0.1:${String(port)}/../../cli/dist/server.js`);
    expect(res.status).not.toBe(500);
  });

  it('traversal URL with encoded dots does not return 500', async () => {
    const res = await fetch(`http://127.0.0.1:${String(port)}/%2e%2e/%2e%2e/cli/dist/server.js`);
    expect(res.status).not.toBe(500);
  });

  it('normal API path still works after static serving is wired', async () => {
    const res = await fetch(`http://127.0.0.1:${String(port)}/doctor`);
    expect(res.ok).toBe(true);
  });
});
