import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Db } from '@zarb/storage';
import { ConfigManager } from '@zarb/config';
import { TestRunner } from '@zarb/test-runner';
import { createTraceProvider } from '@zarb/trace-bridge';
import { createLogProvider } from '@zarb/log-bridge';
import { LocalAIEngine, createAIProvider } from '@zarb/ai-engine';
import { CodexCliAgent, KiroCliAgent } from '@zarb/agent-harness';
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
  const aiProvider = createAIProvider(cfg.ai);
  const aiEngine = new LocalAIEngine(aiProvider, opts.db, dataRoot);

  // Hot-swap AI provider when user changes settings
  settingsSvc.registerObserver({
    onConfigUpdated: async (snapshot) => {
      aiEngine.setProvider(createAIProvider(snapshot.values.ai));
    },
  });

  const runSvc = new RunService(opts.db, { dataRoot, runner, aiEngine, aiProvider });
  const diagSvc = new DiagnosticsService(opts.db, dataRoot, traceProvider, logProvider, aiEngine);
  settingsSvc.registerObserver(diagSvc);
  const taskSvc = new CodeTaskService(
    opts.db,
    dataRoot,
    cfg.codeAgent.engine === 'kiro' ? new KiroCliAgent() : new CodexCliAgent(),
  );
  const doctorSvc = new DoctorService(opts.db, settingsSvc);
  const router = buildRouter(runSvc, diagSvc, taskSvc, settingsSvc, doctorSvc);

  // Resolve local-ui dist relative to this file (apps/cli/dist/server.js → apps/local-ui/dist)
  const uiDist = resolve(dirname(new URL(import.meta.url).pathname), '../../local-ui/dist');

  // Known API path prefixes — these must NOT be intercepted by static serving
  const API_PREFIXES = ['/runs', '/code-tasks', '/reviews', '/commits', '/settings', '/doctor'];

  function serveStatic(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
    if (!existsSync(uiDist)) return false;
    const url = req.url ?? '/';
    // Browser navigation requests include text/html in Accept; API fetch/XHR requests do not.
    // POST/PUT/DELETE are always API calls, never browser navigation.
    const method = req.method ?? 'GET';
    const accept = req.headers['accept'] ?? '';
    const isBrowserNav = method === 'GET' && accept.includes('text/html');
    if (!isBrowserNav && API_PREFIXES.some(p => url === p || url.startsWith(p + '/') || url.startsWith(p + '?'))) return false;
    const ext = url.split('.').pop() ?? '';
    const mimeMap: Record<string, string> = { js: 'application/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', ico: 'image/x-icon' };
    const filePath = url === '/' || !ext || !mimeMap[ext] ? join(uiDist, 'index.html') : join(uiDist, url);
    // Security: reject path traversal — resolved path must stay inside uiDist
    if (!resolve(filePath).startsWith(uiDist + '/') && resolve(filePath) !== uiDist) {
      const fallback = join(uiDist, 'index.html');
      if (!existsSync(fallback)) return false;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(fallback));
      return true;
    }
    if (!existsSync(filePath)) {
      const fallback = join(uiDist, 'index.html');
      if (!existsSync(fallback)) return false;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(fallback));
      return true;
    }
    const fileExt = filePath.split('.').pop() ?? '';
    const mime = mimeMap[fileExt] ?? 'text/html';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
    return true;
  }

  return createServer((req, res) => {
    // Strip /api prefix so the UI's fetch('/api/runs') hits the same routes as /runs
    if (req.url?.startsWith('/api/')) req.url = req.url.slice(4);
    if (!serveStatic(req, res)) {
      void handleRequest(router, req, res);
    }
  });
}
