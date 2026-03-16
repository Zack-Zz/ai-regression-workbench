import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import type { Db } from '@zarb/storage';
import { ConfigManager } from '@zarb/config';
import { TestRunner } from '@zarb/test-runner';
import { createTraceProvider } from '@zarb/trace-bridge';
import { createLogProvider } from '@zarb/log-bridge';
import { RunService } from './services/run-service.js';
import { DiagnosticsService } from './services/diagnostics-service.js';
import { CodeTaskService } from './services/code-task-service.js';
import { DoctorService } from './services/doctor-service.js';
import { buildRouter, handleRequest } from './handlers/index.js';

export interface ServerOptions {
  port: number;
  db: Db;
  configPath: string;
}

export function createAppServer(opts: ServerOptions) {
  const settingsSvc = new ConfigManager(opts.configPath);

  // Derive data root from config file location:
  // config is at <workspace>/.ai-regression-workbench/config.local.yaml
  // data root is at <workspace>/.ai-regression-workbench/data/
  const dataRoot = resolve(dirname(opts.configPath), 'data');

  const runner = new TestRunner(opts.db);
  const cfg = settingsSvc.getSync();
  const traceProvider = createTraceProvider(cfg.trace);
  const logProvider = createLogProvider({ ...cfg.logs, logFields: cfg.diagnostics.correlationKeys.logFields });

  const runSvc = new RunService(opts.db, { dataRoot, runner });
  const diagSvc = new DiagnosticsService(opts.db, dataRoot, traceProvider, logProvider);
  settingsSvc.registerObserver(diagSvc);
  const taskSvc = new CodeTaskService(opts.db);
  const doctorSvc = new DoctorService(opts.db, settingsSvc);
  const router = buildRouter(runSvc, diagSvc, taskSvc, settingsSvc, doctorSvc);

  return createServer((req, res) => {
    void handleRequest(router, req, res);
  });
}
