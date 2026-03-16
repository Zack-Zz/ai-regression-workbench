#!/usr/bin/env node
/**
 * zarb CLI entry point.
 * Supported commands: init, doctor
 * Default (no args): check initialization, start API server (UI served separately via dev server).
 */
import { openDb, runMigrations } from '@zarb/storage';
import { ConfigManager } from '@zarb/config';
import { DoctorService } from './services/doctor-service.js';
import { InitService } from './services/init-service.js';
import { createAppServer } from './server.js';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const MIGRATIONS_DIR = new URL('../../scripts/sql', import.meta.url).pathname;

const DEFAULT_CONFIG_PATH = resolve('.ai-regression-workbench/config.local.yaml');

function runInit(): void {
  const svc = new InitService(MIGRATIONS_DIR);
  const result = svc.init(process.cwd());
  if (result.alreadyInitialized) {
    console.log('✓ Already initialized.');
  } else {
    console.log('✓ Initialized zarb workbench.');
    console.log(`  Config: ${result.configPath}`);
    console.log(`  Data:   ${result.dataRoot}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit .ai-regression-workbench/config.local.yaml');
  console.log('  2. Run: zarb doctor');
  console.log('  3. Run: zarb');
}

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
  // Auto-init if not yet initialized
  const initSvc = new InitService(MIGRATIONS_DIR);
  if (!initSvc.isInitialized(process.cwd())) {
    console.log('zarb: workbench not initialized — running init...');
    runInit();
    console.log('');
  }

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

if (cmd === 'init') {
  try { runInit(); } catch (e: unknown) { console.error(e); process.exit(1); }
} else if (cmd === 'doctor') {
  runDoctor().catch((e: unknown) => { console.error(e); process.exit(1); });
} else {
  runServer().catch((e: unknown) => { console.error(e); process.exit(1); });
}
