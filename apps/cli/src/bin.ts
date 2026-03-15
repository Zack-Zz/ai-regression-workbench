#!/usr/bin/env node
/**
 * zarb CLI entry point.
 * Supported commands: doctor
 * Default (no args): start app server and open UI.
 */
import { openDb, runMigrations } from '@zarb/storage';
import { ConfigManager } from '@zarb/config';
import { DoctorService } from './services/doctor-service.js';
import { createAppServer } from './server.js';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const MIGRATIONS_DIR = new URL('../../scripts/sql', import.meta.url).pathname;

const DEFAULT_CONFIG_PATH = resolve('.ai-regression-workbench/config.local.yaml');

async function runDoctor(): Promise<void> {
  const configPath = existsSync(DEFAULT_CONFIG_PATH) ? DEFAULT_CONFIG_PATH : join(process.cwd(), 'config.local.yaml');
  const config = new ConfigManager(configPath);
  const settings = await config.getSettings();
  const dbPath = resolve(settings.values.storage.sqlitePath);
  const db = openDb(dbPath);
  runMigrations(db, MIGRATIONS_DIR);
  const svc = new DoctorService(db, config);
  const result = await svc.runChecks();

  for (const c of result.checks) {
    const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${icon} ${c.name}: ${c.message}`);
  }
  console.log('');
  console.log(result.healthy ? '✓ All checks passed.' : '✗ Some checks failed.');
  process.exit(result.healthy ? 0 : 1);
}

async function runServer(): Promise<void> {
  const configPath = existsSync(DEFAULT_CONFIG_PATH) ? DEFAULT_CONFIG_PATH : join(process.cwd(), 'config.local.yaml');
  const config = new ConfigManager(configPath);
  const settings = await config.getSettings();
  const dbPath = resolve(settings.values.storage.sqlitePath);
  const db = openDb(dbPath);
  runMigrations(db, MIGRATIONS_DIR);
  const port = settings.values.report.port;
  const server = createAppServer({ port, db, configPath });
  server.listen(port, '127.0.0.1', () => {
    console.log(`zarb running at http://127.0.0.1:${String(port)}`);
  });
}

const [,, cmd] = process.argv;

if (cmd === 'doctor') {
  runDoctor().catch((e: unknown) => { console.error(e); process.exit(1); });
} else {
  runServer().catch((e: unknown) => { console.error(e); process.exit(1); });
}
