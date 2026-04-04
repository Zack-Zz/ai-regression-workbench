import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  openDb,
  runMigrations,
  RunRepository,
  CodeTaskRepository,
  TestResultRepository,
  AnalysisRepository,
  CodeTaskDraftRepository,
  AgentSessionRepository,
  agentContextSummaryPath,
  agentPromptSamplesPath,
  agentStepsPath,
  agentToolCallsPath,
} from '@zarb/storage';
import { RunService } from '../src/services/run-service.js';
import { DiagnosticsService } from '../src/services/diagnostics-service.js';
import { CodeTaskService } from '../src/services/code-task-service.js';
import { SettingsService } from '../src/services/settings-service.js';
import { buildRouter } from '../src/handlers/index.js';
import { Router } from '../src/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;
let db: ReturnType<typeof openDb>;
let router: Router;

function makeRunService(): RunService {
  return new RunService(db, { dataRoot: dir });
}

beforeEach(() => {
  dir = join(tmpdir(), `zarb-api-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  router = buildRouter(
    makeRunService(),
    new DiagnosticsService(db, dir),
    new CodeTaskService(db, dir),
    new SettingsService(join(dir, 'config.json')),
    undefined,
    db,
  );
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0);
  const stream = Readable.from([bodyBuf]) as unknown as IncomingMessage;
  stream.method = method;
  stream.url = url;
  return stream;
}

function mockRes(): { res: ServerResponse; body: () => unknown; status: () => number } {
  let statusCode = 200;
  let rawBody = '';
  const res = {
    writeHead: (code: number) => { statusCode = code; },
    end: (data: string) => { rawBody = data; },
  } as unknown as ServerResponse;
  return { res, body: () => JSON.parse(rawBody) as unknown, status: () => statusCode };
}

function mockBinaryRes(): { res: ServerResponse; body: () => Buffer; status: () => number; headers: () => Record<string, string> } {
  let statusCode = 200;
  let rawBody = Buffer.alloc(0);
  let headerMap: Record<string, string> = {};
  const res = {
    writeHead: (code: number, headers?: Record<string, string>) => { statusCode = code; headerMap = headers ?? {}; },
    end: (data: string | Buffer) => { rawBody = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'); },
  } as unknown as ServerResponse;
  return { res, body: () => rawBody, status: () => statusCode, headers: () => headerMap };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

describe('Router', () => {
  it('returns 404 for unknown route', async () => {
    const { res, status } = mockRes();
    await router.handle(mockReq('GET', '/unknown'), res);
    expect(status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// RunService
// ---------------------------------------------------------------------------

describe('RunService', () => {
  it('startRun creates a run and returns summary', () => {
    const svc = makeRunService();
    const result = svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    expect(result.success).toBe(true);
    expect(result.run?.runMode).toBe('regression');
  });

  it('startRun fails without selector for regression', () => {
    const svc = makeRunService();
    const result = svc.startRun({ runMode: 'regression' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RUN_SELECTOR_INVALID');
  });

  it('listRuns returns created runs', () => {
    const svc = makeRunService();
    svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const page = svc.listRuns();
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('getRun returns null for unknown runId', () => {
    expect(makeRunService().getRun('nope')).toBeNull();
  });

  it('cancelRun returns error for unknown run', () => {
    const result = makeRunService().cancelRun('nope');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RUN_NOT_FOUND');
  });

  it('cancelRun succeeds for existing run', () => {
    const svc = makeRunService();
    const created = svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId;
    expect(runId).toBeDefined();
    const result = svc.cancelRun(runId as string);
    expect(result.success).toBe(true);
  });

  it('cancelRun returns ALREADY_CANCELLED on second cancel', () => {
    const svc = makeRunService();
    const created = svc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    svc.cancelRun(runId);
    const result = svc.cancelRun(runId);
    expect(result.errorCode).toBe('RUN_ALREADY_CANCELLED');
  });

  it('loads run sessions and a structured session replay from agent traces', () => {
    const svc = makeRunService();
    const runId = 'r-session-replay';
    const projectId = 'project-session';
    const now = new Date().toISOString();
    new RunRepository(db).create({
      runId,
      runMode: 'exploration',
      scopeType: 'exploration',
      workspacePath: '/ws',
      projectId,
      startedAt: now,
    });
    new AgentSessionRepository(db).save({
      sessionId: 'session-1',
      runId,
      kind: 'exploration',
      agentName: 'ExplorationAgent',
      status: 'completed',
      contextRefsJson: JSON.stringify({ approxTokenBudget: 10000 }),
      startedAt: now,
      updatedAt: now,
      endedAt: now,
      summary: 'session done',
    });
    const projectDataRoot = join(dir, '..', 'projects', projectId);
    mkdirSync(join(projectDataRoot, 'agent-traces', 'session-1'), { recursive: true });
    writeFileSync(join(projectDataRoot, agentContextSummaryPath('session-1')), JSON.stringify({
      sessionId: 'session-1',
      contextRefs: { approxTokenBudget: 10000, allowedHosts: ['example.com'] },
      startedAt: now,
    }), 'utf8');
    writeFileSync(join(projectDataRoot, agentStepsPath('session-1')), `${JSON.stringify({
      stepIndex: 0,
      description: 'ExplorationAgent plan',
      outcome: 'bootstrap',
      timestamp: now,
    })}\n${JSON.stringify({
      type: 'checkpoint',
      checkpointId: 'cp-1',
      stepIndex: 1,
      timestamp: now,
      summary: 'paused safely',
    })}\n`, 'utf8');
    writeFileSync(join(projectDataRoot, agentToolCallsPath('session-1')), `${JSON.stringify({
      sessionId: 'session-1',
      stepIndex: 0,
      toolName: 'playwright.navigate',
      inputSummary: '{"url":"https://example.com"}',
      resultSummary: 'ok',
      durationMs: 42,
      status: 'ok',
    })}\n${JSON.stringify({
      type: 'approval',
      approvalId: 'approval-1',
      sessionId: 'session-1',
      stepIndex: 1,
      toolName: 'fs.write',
      requestedAt: now,
      status: 'pending',
    })}\n`, 'utf8');
    writeFileSync(join(projectDataRoot, agentPromptSamplesPath('session-1')), `${JSON.stringify({
      sessionId: 'session-1',
      stepIndex: 0,
      timestamp: now,
      phase: 'brain.plan',
      templateVersion: 'exploration-plan/default@v1',
      prompt: 'plan prompt',
      sampledBy: 'forced',
    })}\n`, 'utf8');

    const sessions = svc.getRunSessions(runId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('session-1');

    const replay = svc.getRunSessionReplay(runId, 'session-1');
    expect(replay?.session.agentName).toBe('ExplorationAgent');
    expect(replay?.contextRefs).toMatchObject({ approxTokenBudget: 10000 });
    expect(replay?.steps).toHaveLength(2);
    expect(replay?.steps[1]?.entryType).toBe('checkpoint');
    expect(replay?.toolCalls).toHaveLength(2);
    expect(replay?.toolCalls[1]?.entryType).toBe('approval');
    expect(replay?.promptSamples[0]?.phase).toBe('brain.plan');
  });
});

// ---------------------------------------------------------------------------
// CodeTaskService
// ---------------------------------------------------------------------------

describe('CodeTaskService', () => {
  function seedRun(): void {
    new RunRepository(db).create({ runId: 'r1', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
  }

  it('approveCodeTask returns not found for unknown task', () => {
    const result = new CodeTaskService(db, dir).approveCodeTask('nope');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CODE_TASK_NOT_FOUND');
  });

  it('submitReview creates review and transitions task', () => {
    seedRun();
    new CodeTaskRepository(db).create({ taskId: 't1', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET status='SUCCEEDED' WHERE task_id='t1'").run();
    const svc = new CodeTaskService(db, dir);
    const result = svc.submitReview({ taskId: 't1', decision: 'accept', codeTaskVersion: 1 });
    expect(result.success).toBe(true);
    const detail = svc.getCodeTask('t1');
    expect(detail?.reviews).toHaveLength(1);
    expect(detail?.summary.status).toBe('COMMIT_PENDING');
  });

  it('rejectCodeTask enforces the shared transition table', () => {
    seedRun();
    new CodeTaskRepository(db).create({ taskId: 't-reject', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET status='APPROVED' WHERE task_id='t-reject'").run();
    const result = new CodeTaskService(db, dir).rejectCodeTask('t-reject');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CODE_TASK_STATE_INVALID');
  });

  it('cancelCodeTask rejects terminal FAILED tasks', () => {
    seedRun();
    new CodeTaskRepository(db).create({ taskId: 't-cancel', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET status='FAILED' WHERE task_id='t-cancel'").run();
    const result = new CodeTaskService(db, dir).cancelCodeTask('t-cancel');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CODE_TASK_STATE_INVALID');
  });
});

// ---------------------------------------------------------------------------
// SettingsService
// ---------------------------------------------------------------------------

describe('SettingsService', () => {
  it('getSettings returns default values', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const snap = await svc.getSettings();
    expect(snap.version).toBe(1);
    const port = (snap.values.report as { port: number }).port;
    expect(typeof port).toBe('number');
  });

  it('updateSettings persists and increments version', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const result = await svc.updateSettings({ patch: { report: { port: 8080 } } });
    expect(result.success).toBe(true);
    expect(result.version).toBe(2);
    const snap = await svc.getSettings();
    const port = (snap.values.report as { port: number }).port;
    expect(port).toBe(8080);
  });

  it('updateSettings rejects invalid port', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const result = await svc.updateSettings({ patch: { report: { port: 0 } } });
    expect(result.success).toBe(false);
  });

  it('updateSettings rejects version conflict', async () => {
    const svc = new SettingsService(join(dir, 'config.json'));
    const result = await svc.updateSettings({ patch: {}, expectedVersion: 99 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler integration
// ---------------------------------------------------------------------------

describe('GET /runs', () => {
  it('returns success with items array', async () => {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('GET', '/runs'), res);
    expect(status()).toBe(200);
    const b = body() as { success: boolean; data: { items: unknown[] } };
    expect(b.success).toBe(true);
    expect(Array.isArray(b.data.items)).toBe(true);
  });
});

describe('GET /runs/:runId/sessions*', () => {
  it('returns sessions and session replay payloads', async () => {
    const runId = 'r-session-http';
    const projectId = 'project-http';
    const now = new Date().toISOString();
    new RunRepository(db).create({
      runId,
      runMode: 'exploration',
      scopeType: 'exploration',
      workspacePath: '/ws',
      projectId,
      startedAt: now,
    });
    new AgentSessionRepository(db).save({
      sessionId: 'session-http',
      runId,
      kind: 'exploration',
      agentName: 'ExplorationAgent',
      status: 'completed',
      contextRefsJson: '{}',
      startedAt: now,
      updatedAt: now,
      endedAt: now,
    });
    const projectDataRoot = join(dir, '..', 'projects', projectId);
    mkdirSync(join(projectDataRoot, 'agent-traces', 'session-http'), { recursive: true });
    writeFileSync(join(projectDataRoot, agentContextSummaryPath('session-http')), JSON.stringify({
      sessionId: 'session-http',
      contextRefs: { startUrls: ['https://example.com'] },
      startedAt: now,
    }), 'utf8');
    writeFileSync(join(projectDataRoot, agentToolCallsPath('session-http')), `${JSON.stringify({
      sessionId: 'session-http',
      stepIndex: 0,
      toolName: 'playwright.navigate',
      inputSummary: '{"url":"https://example.com"}',
      resultSummary: 'ok',
      durationMs: 28,
      status: 'ok',
    })}\n`, 'utf8');

    const listRes = mockRes();
    await router.handle(mockReq('GET', `/runs/${runId}/sessions`), listRes.res);
    expect(listRes.status()).toBe(200);
    const listBody = listRes.body() as { data: Array<{ sessionId: string }> };
    expect(listBody.data[0]?.sessionId).toBe('session-http');

    const replayRes = mockRes();
    await router.handle(mockReq('GET', `/runs/${runId}/sessions/session-http/replay`), replayRes.res);
    expect(replayRes.status()).toBe(200);
    const replayBody = replayRes.body() as { data: { session: { sessionId: string }; toolCalls: Array<{ toolName: string }> } };
    expect(replayBody.data.session.sessionId).toBe('session-http');
    expect(replayBody.data.toolCalls[0]?.toolName).toBe('playwright.navigate');
  });
});

describe('GET /settings', () => {
  it('returns settings snapshot', async () => {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('GET', '/settings'), res);
    expect(status()).toBe(200);
    const b = body() as { success: boolean; data: { version: number } };
    expect(b.data.version).toBe(1);
  });
});

describe('GET /runs/:runId/testcases/:testcaseId/artifacts/:kind', () => {
  it('serves the persisted screenshot artifact', async () => {
    new RunRepository(db).create({ runId: 'r-art', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    const artifactDir = join(dir, 'artifacts', 'r-art', 'tc-art');
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'shot.png'), 'png-binary');
    new TestResultRepository(db).upsert({
      id: 'tr-art',
      runId: 'r-art',
      testcaseId: 'tc-art',
      status: 'failed',
      screenshotPath: 'artifacts/r-art/tc-art/shot.png',
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const { res, status, body, headers } = mockBinaryRes();
    await router.handle(mockReq('GET', '/runs/r-art/testcases/tc-art/artifacts/screenshot'), res);
    expect(status()).toBe(200);
    expect(headers()['Content-Type']).toBe('image/png');
    expect(body().toString('utf8')).toBe('png-binary');
  });

  it('rejects artifact paths that escape the configured artifact root', async () => {
    new RunRepository(db).create({ runId: 'r-art-escape', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    const escapedPath = join(dir, 'escape.png');
    writeFileSync(escapedPath, 'escape-binary');
    new TestResultRepository(db).upsert({
      id: 'tr-art-escape',
      runId: 'r-art-escape',
      testcaseId: 'tc-art-escape',
      status: 'failed',
      screenshotPath: '../escape.png',
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const { res, status } = mockBinaryRes();
    await router.handle(mockReq('GET', '/runs/r-art-escape/testcases/tc-art-escape/artifacts/screenshot'), res);
    expect(status()).toBe(404);
  });

  it('serves artifact paths persisted under a custom artifact root basename', async () => {
    const customArtifactRoot = join(dir, 'custom-shots');
    const customRouter = buildRouter(
      makeRunService(),
      new DiagnosticsService(db, dir, customArtifactRoot),
      new CodeTaskService(db, dir),
      new SettingsService(join(dir, 'config.json')),
      undefined,
      db,
    );
    new RunRepository(db).create({ runId: 'r-art-custom', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    const artifactDir = join(customArtifactRoot, 'r-art-custom', 'tc-art-custom');
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'shot.png'), 'png-custom');
    new TestResultRepository(db).upsert({
      id: 'tr-art-custom',
      runId: 'r-art-custom',
      testcaseId: 'tc-art-custom',
      status: 'failed',
      screenshotPath: 'custom-shots/r-art-custom/tc-art-custom/shot.png',
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const { res, status, body } = mockBinaryRes();
    await customRouter.handle(mockReq('GET', '/runs/r-art-custom/testcases/tc-art-custom/artifacts/screenshot'), res);
    expect(status()).toBe(200);
    expect(body().toString('utf8')).toBe('png-custom');
  });
});

describe('GET /code-tasks/:taskId/artifacts/:kind', () => {
  it('serves the persisted diff artifact', async () => {
    new RunRepository(db).create({ runId: 'r-task-art', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    const codeTaskDir = join(dir, 'code-tasks', 't-art');
    mkdirSync(codeTaskDir, { recursive: true });
    writeFileSync(join(codeTaskDir, 'changes.diff'), 'diff --git');
    new CodeTaskRepository(db).create({ taskId: 't-art', runId: 'r-task-art', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET diff_path = 'code-tasks/t-art/changes.diff', updated_at = ? WHERE task_id = 't-art'").run(new Date().toISOString());

    const { res, status, body, headers } = mockBinaryRes();
    await router.handle(mockReq('GET', '/code-tasks/t-art/artifacts/diff'), res);
    expect(status()).toBe(200);
    expect(headers()['Content-Type']).toContain('text/plain');
    expect(body().toString('utf8')).toBe('diff --git');
  });

  it('rejects code-task artifact paths that escape the configured root', async () => {
    new RunRepository(db).create({ runId: 'r-task-art-escape', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    writeFileSync(join(dir, 'outside.diff'), 'outside diff');
    new CodeTaskRepository(db).create({ taskId: 't-art-escape', runId: 'r-task-art-escape', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET diff_path = '../outside.diff', updated_at = ? WHERE task_id = 't-art-escape'").run(new Date().toISOString());

    const { res, status } = mockBinaryRes();
    await router.handle(mockReq('GET', '/code-tasks/t-art-escape/artifacts/diff'), res);
    expect(status()).toBe(404);
  });

  it('serves code-task artifacts persisted under a custom code-task root basename', async () => {
    const customCodeTaskRoot = join(dir, 'custom-code-tasks');
    const customRouter = buildRouter(
      makeRunService(),
      new DiagnosticsService(db, dir),
      new CodeTaskService(db, dir, undefined, undefined, customCodeTaskRoot),
      new SettingsService(join(dir, 'config.json')),
      undefined,
      db,
    );
    new RunRepository(db).create({ runId: 'r-task-art-custom', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    const codeTaskDir = join(customCodeTaskRoot, 't-art-custom');
    mkdirSync(codeTaskDir, { recursive: true });
    writeFileSync(join(codeTaskDir, 'changes.diff'), 'custom diff --git');
    new CodeTaskRepository(db).create({ taskId: 't-art-custom', runId: 'r-task-art-custom', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET diff_path = 'custom-code-tasks/t-art-custom/changes.diff', updated_at = ? WHERE task_id = 't-art-custom'").run(new Date().toISOString());

    const { res, status, body } = mockBinaryRes();
    await customRouter.handle(mockReq('GET', '/code-tasks/t-art-custom/artifacts/diff'), res);
    expect(status()).toBe(200);
    expect(body().toString('utf8')).toBe('custom diff --git');
  });

  it('serves the persisted runtime summary artifact', async () => {
    new RunRepository(db).create({ runId: 'r-task-runtime', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    const codeTaskDir = join(dir, 'code-tasks', 't-runtime');
    mkdirSync(codeTaskDir, { recursive: true });
    writeFileSync(join(codeTaskDir, 'runtime-summary.json'), JSON.stringify({
      finalStatus: 'SUCCEEDED',
      stopReason: 'succeeded',
      summary: 'done',
      budget: { maxAttempts: 1, attemptsUsed: 1, compactionsUsed: 0, maxCompactions: 1, usedTokens: 42, remainingTokens: 58 },
      attempts: [],
    }, null, 2));
    new CodeTaskRepository(db).create({ taskId: 't-runtime', runId: 'r-task-runtime', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });

    const { res, status, body, headers } = mockBinaryRes();
    await router.handle(mockReq('GET', '/code-tasks/t-runtime/artifacts/runtime-summary'), res);
    expect(status()).toBe(200);
    expect(headers()['Content-Type']).toContain('application/json');
    expect(JSON.parse(body().toString('utf8'))).toMatchObject({ finalStatus: 'SUCCEEDED', stopReason: 'succeeded' });
  });
});

describe('GET /runs/:runId (not found)', () => {
  it('returns 404', async () => {
    const { res, status } = mockRes();
    await router.handle(mockReq('GET', '/runs/nope'), res);
    expect(status()).toBe(404);
  });
});

describe('Project route boundaries', () => {
  async function createProject(name: string): Promise<string> {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('POST', '/projects', { name }), res);
    expect(status()).toBe(200);
    return (body() as { data: { id: string } }).data.id;
  }

  async function createSite(projectId: string, name: string, baseUrl: string): Promise<string> {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('POST', `/projects/${projectId}/sites`, { name, baseUrl }), res);
    expect(status()).toBe(200);
    return (body() as { data: { id: string } }).data.id;
  }

  async function createRepo(projectId: string, name: string, path: string): Promise<string> {
    const { res, body, status } = mockRes();
    await router.handle(mockReq('POST', `/projects/${projectId}/repos`, { name, path }), res);
    expect(status()).toBe(200);
    return (body() as { data: { id: string } }).data.id;
  }

  it('rejects updating a site through the wrong project', async () => {
    const projectA = await createProject('A');
    const projectB = await createProject('B');
    const siteId = await createSite(projectA, 'Site A', 'https://a.example.com');

    const { res, status } = mockRes();
    await router.handle(mockReq('PUT', `/projects/${projectB}/sites/${siteId}`, { name: 'Hacked' }), res);
    expect(status()).toBe(404);
  });

  it('rejects accessing repo git-info through the wrong project', async () => {
    const projectA = await createProject('A');
    const projectB = await createProject('B');
    const repoId = await createRepo(projectA, 'Repo A', dir);

    const { res, status } = mockRes();
    await router.handle(mockReq('GET', `/projects/${projectB}/repos/${repoId}/git-info`), res);
    expect(status()).toBe(404);
  });

  it('scopes project selectors to repos in that project only', async () => {
    const projectA = await createProject('A');
    const projectB = await createProject('B');
    const siteA = await createSite(projectA, 'Site A', 'https://a.example.com');
    const siteB = await createSite(projectB, 'Site B', 'https://b.example.com');
    const repoA = await createRepo(projectA, 'Repo A', dir);
    const repoB = await createRepo(projectB, 'Repo B', dir);

    db.prepare(`
      INSERT INTO test_selector_cache (id, site_id, repo_id, type, value, source, last_seen, updated_at)
      VALUES (?, ?, ?, 'suite', ?, 'scan', ?, ?)
    `).run('sel-a', siteA, repoA, 'suite-a', '2026-03-19T00:00:00.000Z', '2026-03-19T00:00:00.000Z');
    db.prepare(`
      INSERT INTO test_selector_cache (id, site_id, repo_id, type, value, source, last_seen, updated_at)
      VALUES (?, ?, ?, 'suite', ?, 'scan', ?, ?)
    `).run('sel-b', siteB, repoB, 'suite-b', '2026-03-19T00:00:00.000Z', '2026-03-19T00:00:00.000Z');

    const { res, body, status } = mockRes();
    await router.handle(mockReq('GET', `/projects/${projectA}/selectors?type=suite`), res);
    expect(status()).toBe(200);
    const rows = (body() as { data: Array<{ value: string }> }).data;
    expect(rows.map((row) => row.value)).toEqual(['suite-a']);
  });

  it('legacy workspace fallback does not bypass explicit repo selection for managed projects', async () => {
    const projectId = await createProject('Managed Project');
    const siteId = await createSite(projectId, 'Managed Site', 'https://managed.example.com');

    const settingsRes = mockRes();
    await router.handle(mockReq('PUT', '/settings', {
      patch: { workspace: { targetProjectPath: '/legacy/workspace/path' } },
    }), settingsRes.res);
    expect(settingsRes.status()).toBe(200);

    await createRepo(projectId, 'Repo A', dir);

    const { res, body, status } = mockRes();
    await router.handle(mockReq('POST', '/runs', {
      runMode: 'regression',
      projectId,
      siteId,
      selector: { suite: 'smoke' },
    }), res);

    expect(status()).toBe(400);
    expect((body() as { errorCode?: string }).errorCode).toBe('RUN_REPO_REQUIRED');
  });

  it('rejects promoting a draft through a different testcase route', async () => {
    new RunRepository(db).create({ runId: 'r-draft', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    new AnalysisRepository(db).save({
      id: 'analysis-tc-1',
      runId: 'r-draft',
      testcaseId: 'tc-1',
      createdAt: new Date().toISOString(),
    });
    new CodeTaskDraftRepository(db).save({
      id: 'draft-tc-1',
      runId: 'r-draft',
      analysisId: 'analysis-tc-1',
      goal: 'fix testcase',
      target: 'testcase',
      workspacePath: '/ws',
      promptTemplateVersion: 'v1',
      createdAt: new Date().toISOString(),
    });

    const { res, status } = mockRes();
    await router.handle(mockReq('POST', '/runs/r-draft/testcases/tc-2/drafts/draft-tc-1/promote'), res);
    expect(status()).toBe(404);
  });
});
