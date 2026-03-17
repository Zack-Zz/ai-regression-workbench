import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import type { RunService } from '../services/run-service.js';
import type { DiagnosticsService } from '../services/diagnostics-service.js';
import type { CodeTaskService } from '../services/code-task-service.js';
import type { DoctorService } from '../services/doctor-service.js';
import type { ConfigManager } from '@zarb/config';
import type { Db } from '@zarb/storage';
import { Router, parseQuery, readBody, ok, actionOk, notFound, badRequest, conflict, serverError, json } from '../router.js';
import type { StartRunInput, SubmitReviewInput, CreateCommitInput, UpdateSettingsInput, ListRunsQuery, ListCodeTasksQuery, RunEventsQuery, SSEEvent } from '@zarb/shared-types';
import { registerProjectRoutes } from './project-handlers.js';
import { eventBus, _buffer } from '../event-bus.js';

function q(val: string | undefined): string | undefined { return val || undefined; }
function qn(val: string | undefined): number | undefined { return val ? Number(val) : undefined; }

/** Map service errorCode to HTTP status + send response. */
function taskError(res: ServerResponse, errorCode: string | undefined, message: string): void {
  if (errorCode === 'CODE_TASK_NOT_FOUND') { notFound(res, errorCode, message); return; }
  if (errorCode === 'CODE_TASK_STATE_INVALID' || errorCode === 'CODE_TASK_VERSION_MISMATCH') { conflict(res, errorCode, message); return; }
  badRequest(res, errorCode ?? 'CODE_TASK_STATE_INVALID', message);
}

export function buildRouter(
  runSvc: RunService,
  diagSvc: DiagnosticsService,
  taskSvc: CodeTaskService,
  settingsSvc: ConfigManager,
  doctorSvc?: DoctorService,
  db?: Db,
): Router {
  const router = new Router();

  if (db) registerProjectRoutes(router, db);

  // --- SSE events ---
  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering for reverse proxy deployments
    });

    const send = (event: SSEEvent): void => {
      res.write(`id: ${event.ts}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Replay events missed since Last-Event-ID
    const lastId = req.headers['last-event-id'];
    if (lastId) {
      const since = Number(lastId);
      _buffer.filter(e => e.ts > since).forEach(send);
    }

    // Initial connected signal
    send({ type: 'run.updated', ts: Date.now() } as SSEEvent & { type: 'run.updated' });
    res.write(': connected\n\n');

    const heartbeat = setInterval(() => { res.write(': ping\n\n'); }, 25000);
    const listener = (e: SSEEvent): void => { send(e); };
    eventBus.on('sse', listener);

    req.on('close', () => {
      clearInterval(heartbeat);
      eventBus.off('sse', listener);
    });
  });

  // --- Runs ---
  router.post('/runs', async (req, res) => {
    try {
      const body = await readBody<StartRunInput>(req);
      // Inject projectPath from settings if not provided by caller
      if (!body.projectPath) {
        const cfg = settingsSvc.getSync();
        if (cfg.workspace?.targetProjectPath) body.projectPath = cfg.workspace.targetProjectPath;
      }
      const result = runSvc.startRun(body);
      if (!result.success) { badRequest(res, result.errorCode ?? 'RUN_SELECTOR_INVALID', result.message); return; }
      ok(res, result);
    } catch { serverError(res, 'Failed to start run'); }
  });

  router.get('/runs', (req, res) => {
    const p = parseQuery(req);
    const query: ListRunsQuery = {};
    const cursor = q(p['cursor']); if (cursor !== undefined) query.cursor = cursor;
    const limit = qn(p['limit']); if (limit !== undefined) query.limit = limit;
    const status = q(p['status']); if (status !== undefined) query.status = status;
    const runMode = q(p['runMode']); if (runMode !== undefined) query.runMode = runMode as import('@zarb/shared-types').RunMode;
    ok(res, runSvc.listRuns(query));
  });

  router.get('/runs/:runId', (_req, res, params) => {
    const detail = runSvc.getRun(params['runId'] ?? '');
    if (!detail) { notFound(res, 'RUN_NOT_FOUND', 'Run not found'); return; }
    ok(res, detail);
  });

  router.get('/runs/:runId/execution-report', (_req, res, params) => {
    const report = runSvc.getExecutionReport(params['runId'] ?? '');
    if (!report) { notFound(res, 'RUN_NOT_FOUND', 'Run not found'); return; }
    ok(res, report);
  });

  router.get('/runs/:runId/events', (req, res, params) => {
    const p = parseQuery(req);
    const query: RunEventsQuery = {};
    const cursor = q(p['cursor']); if (cursor !== undefined) query.cursor = cursor;
    const limit = qn(p['limit']); if (limit !== undefined) query.limit = limit;
    ok(res, runSvc.getRunEvents(params['runId'] ?? '', query));
  });

  router.get('/runs/:runId/steps', (_req, res, params) => {
    const filePath = runSvc.getRunFilePath(params['runId'] ?? '', 'steps.ndjson');
    serveNdjson(res, filePath);
  });

  router.get('/runs/:runId/network', (_req, res, params) => {
    const filePath = runSvc.getRunFilePath(params['runId'] ?? '', 'network.jsonl');
    serveNdjson(res, filePath);
  });

  router.post('/runs/:runId/pause', (_req, res, params) => {
    const result = runSvc.pauseRun(params['runId'] ?? '');
    if (!result.success) {
      if (result.errorCode === 'RUN_PAUSE_NOT_SUPPORTED') { badRequest(res, result.errorCode, result.message); return; }
      if (result.errorCode === 'RUN_ALREADY_TERMINAL') { conflict(res, result.errorCode, result.message); return; }
      notFound(res, result.errorCode ?? 'RUN_NOT_FOUND', result.message);
      return;
    }
    actionOk(res, result.message);
  });

  router.post('/runs/:runId/resume', (_req, res, params) => {
    const result = runSvc.resumeRun(params['runId'] ?? '');
    if (!result.success) {
      if (result.errorCode === 'RUN_RESUME_NOT_SUPPORTED') { badRequest(res, result.errorCode, result.message); return; }
      if (result.errorCode === 'RUN_NOT_PAUSED') { conflict(res, result.errorCode, result.message); return; }
      notFound(res, result.errorCode ?? 'RUN_NOT_FOUND', result.message);
      return;
    }
    actionOk(res, result.message);
  });

  router.post('/runs/:runId/cancel', (_req, res, params) => {
    const result = runSvc.cancelRun(params['runId'] ?? '');
    if (!result.success) {
      if (result.errorCode === 'RUN_ALREADY_CANCELLED' || result.errorCode === 'RUN_ALREADY_TERMINAL') { conflict(res, result.errorCode, result.message); return; }
      notFound(res, result.errorCode ?? 'RUN_NOT_FOUND', result.message);
      return;
    }
    actionOk(res, result.message);
  });

  // --- Diagnostics ---
  router.get('/runs/:runId/failure-reports', (_req, res, params) => {
    ok(res, diagSvc.listFailureReports(params['runId'] ?? ''));
  });

  router.get('/runs/:runId/testcases/:testcaseId/failure-report', (_req, res, params) => {
    const report = diagSvc.getFailureReport(params['runId'] ?? '', params['testcaseId'] ?? '');
    if (!report) { notFound(res, 'RUN_NOT_FOUND', 'Failure report not found'); return; }
    ok(res, report);
  });

  router.get('/runs/:runId/testcases/:testcaseId/execution-profile', (_req, res, params) => {
    const profile = diagSvc.getExecutionProfile(params['runId'] ?? '', params['testcaseId'] ?? '');
    if (!profile) { notFound(res, 'RUN_NOT_FOUND', 'Execution profile not found'); return; }
    ok(res, profile);
  });

  router.get('/runs/:runId/testcases/:testcaseId/diagnostics', (_req, res, params) => {
    ok(res, diagSvc.getDiagnostics(params['runId'] ?? '', params['testcaseId'] ?? ''));
  });

  router.get('/runs/:runId/testcases/:testcaseId/trace', async (_req, res, params) => {
    ok(res, await diagSvc.getTrace(params['runId'] ?? '', params['testcaseId'] ?? ''));
  });

  router.get('/runs/:runId/testcases/:testcaseId/logs', async (_req, res, params) => {
    ok(res, await diagSvc.getLogs(params['runId'] ?? '', params['testcaseId'] ?? ''));
  });

  router.get('/runs/:runId/testcases/:testcaseId/analysis', (_req, res, params) => {
    ok(res, diagSvc.getAnalysis(params['runId'] ?? '', params['testcaseId'] ?? ''));
  });

  router.post('/runs/:runId/testcases/:testcaseId/analysis/retry', (_req, res, params) => {
    const result = diagSvc.retryAnalysis(params['runId'] ?? '', params['testcaseId'] ?? '');
    actionOk(res, result.message, { nextSuggestedAction: 'poll-analysis' });
  });

  router.get('/runs/:runId/testcases/:testcaseId/drafts', (_req, res, params) => {
    ok(res, taskSvc.listDrafts(params['runId'] ?? '', params['testcaseId']));
  });
  router.post('/runs/:runId/testcases/:testcaseId/drafts/:draftId/promote', (_req, res, params) => {
    const result = taskSvc.promoteToCodeTask(params['draftId'] ?? '');
    if (!result.success) { notFound(res, result.errorCode ?? 'NOT_FOUND', result.message); return; }
    ok(res, result);
  });

  // --- Code Tasks ---
  router.get('/code-tasks', (req, res) => {
    const p = parseQuery(req);
    const query: ListCodeTasksQuery = {};
    const cursor = q(p['cursor']); if (cursor !== undefined) query.cursor = cursor;
    const limit = qn(p['limit']); if (limit !== undefined) query.limit = limit;
    const status = q(p['status']); if (status !== undefined) query.status = status;
    const runId = q(p['runId']); if (runId !== undefined) query.runId = runId;
    ok(res, taskSvc.listCodeTasks(query));
  });

  router.get('/code-tasks/:taskId', (_req, res, params) => {
    const detail = taskSvc.getCodeTask(params['taskId'] ?? '');
    if (!detail) { notFound(res, 'CODE_TASK_NOT_FOUND', 'CodeTask not found'); return; }
    ok(res, detail);
  });

  router.post('/code-tasks/:taskId/approve', (_req, res, params) => {
    const result = taskSvc.approveCodeTask(params['taskId'] ?? '');
    if (!result.success) { taskError(res, result.errorCode, result.message); return; }
    actionOk(res, result.message);
  });

  router.post('/code-tasks/:taskId/reject', (_req, res, params) => {
    const result = taskSvc.rejectCodeTask(params['taskId'] ?? '');
    if (!result.success) { taskError(res, result.errorCode, result.message); return; }
    actionOk(res, result.message);
  });

  router.post('/code-tasks/:taskId/execute', async (_req, res, params) => {
    const result = await taskSvc.executeCodeTask(params['taskId'] ?? '');
    if (!result.success) { taskError(res, result.errorCode, result.message); return; }
    actionOk(res, result.message);
  });

  router.post('/code-tasks/:taskId/retry', (_req, res, params) => {
    const result = taskSvc.retryCodeTask(params['taskId'] ?? '');
    if (!result.success) { taskError(res, result.errorCode, result.message); return; }
    actionOk(res, result.message, { nextSuggestedAction: result.nextSuggestedAction });
  });

  router.post('/code-tasks/:taskId/cancel', (_req, res, params) => {
    const result = taskSvc.cancelCodeTask(params['taskId'] ?? '');
    if (!result.success) { taskError(res, result.errorCode, result.message); return; }
    actionOk(res, result.message);
  });

  // --- Reviews ---
  router.post('/reviews', async (req, res) => {
    try {
      const body = await readBody<SubmitReviewInput>(req);
      const result = taskSvc.submitReview(body);
      if (!result.success) { taskError(res, result.errorCode, result.message); return; }
      actionOk(res, result.message);
    } catch { serverError(res, 'Failed to submit review'); }
  });

  // --- Commits ---
  router.post('/commits', async (req, res) => {
    try {
      const body = await readBody<CreateCommitInput>(req);
      const result = taskSvc.createCommit(body);
      if (!result.success) { taskError(res, result.errorCode, result.message); return; }
      actionOk(res, result.message);
    } catch { serverError(res, 'Failed to create commit'); }
  });

  // --- Settings ---
  router.get('/settings', async (_req, res) => {
    ok(res, await settingsSvc.getSettings());
  });

  router.post('/settings/validate', async (req, res) => {
    try {
      const body = await readBody<UpdateSettingsInput>(req);
      ok(res, await settingsSvc.validateSettings(body));
    } catch { serverError(res, 'Failed to validate settings'); }
  });

  router.put('/settings', async (req, res) => {
    try {
      const body = await readBody<UpdateSettingsInput>(req);
      const result = await settingsSvc.updateSettings(body);
      if (!result.success) {
        if (result.errorCode === 'SETTINGS_VERSION_CONFLICT') { conflict(res, result.errorCode, result.message); return; }
        json(res, 422, { success: false, message: result.message, errorCode: result.errorCode ?? 'SETTINGS_VALIDATION_FAILED' });
        return;
      }
      json(res, 200, { success: true, message: result.message, data: { success: true, message: result.message, version: result.version, ...(result.requiresRestart ? { requiresRestart: true, nextRunOnlyKeys: result.nextRunOnlyKeys } : {}) } });
    } catch { serverError(res, 'Failed to update settings'); }
  });

  // --- Doctor ---
  router.get('/doctor', async (_req, res) => {
    if (!doctorSvc) { ok(res, { healthy: true, checks: [] }); return; }
    try { ok(res, await doctorSvc.runChecks()); }
    catch { serverError(res, 'Failed to run doctor checks'); }
  });

  return router;
}

function serveNdjson(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath)) { ok(res, []); return; }
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    ok(res, lines.map(l => JSON.parse(l) as unknown));
  } catch { ok(res, []); }
}

export async function handleRequest(
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await router.handle(req, res);
  } catch (err) {
    serverError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}
