import { createServer } from 'node:http';
import type { Db } from '@zarb/storage';
import { ConfigManager } from '@zarb/config';
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
  const runSvc = new RunService(opts.db);
  const diagSvc = new DiagnosticsService(opts.db);
  const taskSvc = new CodeTaskService(opts.db);
  const settingsSvc = new ConfigManager(opts.configPath);
  const doctorSvc = new DoctorService(opts.db, settingsSvc);
  const router = buildRouter(runSvc, diagSvc, taskSvc, settingsSvc, doctorSvc);

  return createServer((req, res) => {
    void handleRequest(router, req, res);
  });
}
