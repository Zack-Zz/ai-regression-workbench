/**
 * Phase 10 — Integration tests for critical flows.
 * Covers: run lifecycle, code task lifecycle, settings flow,
 * and API contract consistency (all documented endpoints respond correctly).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openDb, runMigrations, RunRepository, CodeTaskRepository, CorrelationContextRepository, ProjectRepository, LocalRepoRepository, FindingRepository, DiagnosticFetchRepository, AgentSessionRepository, agentPromptSamplesPath } from '@zarb/storage';
import { RunService } from '../src/services/run-service.js';
import { DiagnosticsService } from '../src/services/diagnostics-service.js';
import { CodeTaskService } from '../src/services/code-task-service.js';
import { CodexCliAgent } from '@zarb/agent-harness/code-repair';
import { CommitManager } from '@zarb/review-manager';
import { SettingsService } from '../src/services/settings-service.js';
import { DoctorService } from '../src/services/doctor-service.js';
import { buildRouter } from '../src/handlers/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

vi.mock('@zarb/agent-harness/exploration', async () => {
  const actual = await vi.importActual<typeof import('@zarb/agent-harness/exploration')>('@zarb/agent-harness/exploration');

  class MockExplorationAgent {
    async explore(_runId: string, config: { startUrls?: string[] }): Promise<{ findingCount: number; stepsExecuted: number; pagesVisited: number; llmError?: string }> {
      const firstUrl = config.startUrls?.[0] ?? '';
      if (firstUrl.includes('mock-login-fail')) {
        return { findingCount: 0, stepsExecuted: 0, pagesVisited: 0, llmError: 'LOGIN_FAILED' };
      }
      if (firstUrl.includes('mock-login-captcha')) {
        return { findingCount: 0, stepsExecuted: 0, pagesVisited: 0, llmError: 'LOGIN_CAPTCHA_REQUIRED' };
      }
      return { findingCount: 0, stepsExecuted: 1, pagesVisited: 1 };
    }
  }

  class MockPlaywrightToolProvider {}

  return {
    ...actual,
    ExplorationAgent: MockExplorationAgent,
    PlaywrightToolProvider: MockPlaywrightToolProvider,
  };
});

let dir: string;
let db: ReturnType<typeof openDb>;
let runSvc: RunService;
let taskSvc: CodeTaskService;
let router: ReturnType<typeof buildRouter>;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-integration-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  runSvc = new RunService(db);
  const mockAgent = { run: () => Promise.resolve({ rawOutput: '', exitCode: 0 }) } as unknown as CodexCliAgent;
  const mockCommitMgr = { commit: () => ({ success: true, commitSha: 'abc123' }) } as unknown as CommitManager;
  taskSvc = new CodeTaskService(db, dir, mockAgent, mockCommitMgr);
  router = buildRouter(runSvc, new DiagnosticsService(db, dir), taskSvc, new SettingsService(join(dir, 'config.json')));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function req(method: string, url: string, body?: unknown): IncomingMessage {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0);
  const s = Readable.from([bodyBuf]) as unknown as IncomingMessage;
  s.method = method;
  s.url = url;
  return s;
}

function res(): { res: ServerResponse; body: () => Record<string, unknown>; status: () => number } {
  let code = 200;
  let raw = '';
  const r = { writeHead: (c: number) => { code = c; }, end: (d: string) => { raw = d; } } as unknown as ServerResponse;
  return { res: r, body: () => JSON.parse(raw) as Record<string, unknown>, status: () => code };
}

async function waitForValue<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let current = read();
  while (!predicate(current)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for condition. Last value: ${JSON.stringify(current)}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    current = read();
  }
  return current;
}

// ---------------------------------------------------------------------------
// Critical flow: Run lifecycle (start → pause → resume → cancel)
// ---------------------------------------------------------------------------

describe('Run lifecycle flow', () => {
  it('start → list → detail → cancel', async () => {
    // Start
    const start = res();
    await router.handle(req('POST', '/runs', { runMode: 'regression', selector: { suite: 'smoke' } }), start.res);
    expect(start.status()).toBe(200);
    const startData = start.body().data as { run: { runId: string } };
    const runId = startData.run.runId;
    expect(typeof runId).toBe('string');

    // List — run appears
    const list = res();
    await router.handle(req('GET', '/runs'), list.res);
    const listData = list.body().data as { items: Array<{ runId: string }> };
    expect(listData.items.some(r => r.runId === runId)).toBe(true);

    // Detail
    const detail = res();
    await router.handle(req('GET', `/runs/${runId}`), detail.res);
    expect(detail.status()).toBe(200);
    const detailData = detail.body().data as { summary: { runId: string; status: string } };
    expect(detailData.summary.runId).toBe(runId);

    // Cancel
    const cancel = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), cancel.res);
    expect(cancel.status()).toBe(200);
    expect(cancel.body().success).toBe(true);

    // Detail after cancel — status is CANCELLED
    const afterCancel = res();
    await router.handle(req('GET', `/runs/${runId}`), afterCancel.res);
    const afterData = afterCancel.body().data as { summary: { status: string } };
    expect(afterData.summary.status).toBe('CANCELLED');
  });

  it('pause and resume — regression run returns not-supported for resume', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;

    // Pause a non-active regression run (no runner in flight) succeeds
    const pause = res();
    await router.handle(req('POST', `/runs/${runId}/pause`), pause.res);
    expect(pause.status()).toBe(200);

    // Resume a paused regression run is explicitly not supported
    const resume = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), resume.res);
    expect(resume.status()).toBe(400);
    const resumeBody = resume.body() as { success: boolean; errorCode: string };
    expect(resumeBody.errorCode).toBe('RUN_RESUME_NOT_SUPPORTED');
  });

  it('resume restores paused exploration run to its previous stage', async () => {
    const created = runSvc.startRun({
      runMode: 'exploration',
      exploration: { startUrls: ['http://localhost:3000'], maxSteps: 10, maxPages: 5 },
    });
    const runId = created.run?.runId as string;
    new RunRepository(db).update(runId, {
      status: 'PAUSED',
      currentStage: 'RUNNING_EXPLORATION',
      pausedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const resume = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), resume.res);
    expect(resume.status()).toBe(200);

    const detail = res();
    await router.handle(req('GET', `/runs/${runId}`), detail.res);
    const detailData = detail.body().data as { summary: { status: string; currentStage?: string } };
    expect(detailData.summary.status).toBe('RUNNING_EXPLORATION');
    expect(detailData.summary.currentStage).toBe('RUNNING_EXPLORATION');
  });

  it('resume on non-paused run returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    // Run is CREATED (not PAUSED) — resume should be rejected
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_NOT_PAUSED');
  });

  it('double-cancel returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    runSvc.cancelRun(runId);

    const r = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), r.res);
    expect(r.status()).toBe(409);
  });

  it('pause on COMPLETED run returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    // Force terminal state
    new RunRepository(db).update(runId, { status: 'COMPLETED', updatedAt: new Date().toISOString() });

    const r = res();
    await router.handle(req('POST', `/runs/${runId}/pause`), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_ALREADY_TERMINAL');
  });

  it('cancel on COMPLETED run returns 409', async () => {
    const created = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    const runId = created.run?.runId as string;
    new RunRepository(db).update(runId, { status: 'COMPLETED', updatedAt: new Date().toISOString() });

    const r = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_ALREADY_TERMINAL');
  });

  it('exploration run requires exploration params', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', { runMode: 'exploration' }), r.res);
    expect(r.status()).toBe(400);
  });

  it('exploration run succeeds with startUrls', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', {
      runMode: 'exploration',
      exploration: { startUrls: ['http://localhost:3000'], maxSteps: 10, maxPages: 5 },
    }), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().success).toBe(true);
  });

  it('exploration login failure marks the run failed instead of completed', async () => {
    const aiEngine = {
      getProvider: () => ({
        isConfigured: () => true,
        complete: async () => '',
        model: 'mock-model',
      }),
    } as const;
    const svc = new RunService(db, { dataRoot: dir, aiEngine: aiEngine as never });

    const started = svc.startRun({
      runMode: 'exploration',
      exploration: { startUrls: ['https://mock-login-fail.local/login'], maxSteps: 10, maxPages: 5 },
    });
    expect(started.success).toBe(true);

    const runId = started.run?.runId as string;
    const detail = await waitForValue(
      () => svc.getRun(runId),
      (value) => value?.summary.status === 'FAILED',
    );
    expect(detail?.summary.status).toBe('FAILED');
    expect(detail?.summary.summary).toBe('LOGIN_FAILED');
    expect(detail?.summary.currentStage).toBe('RUNNING_EXPLORATION');
  });

  it('exploration captcha challenge is surfaced as LOGIN_CAPTCHA_REQUIRED', async () => {
    const aiEngine = {
      getProvider: () => ({
        isConfigured: () => true,
        complete: async () => '',
        model: 'mock-model',
      }),
    } as const;
    const svc = new RunService(db, { dataRoot: dir, aiEngine: aiEngine as never });

    const started = svc.startRun({
      runMode: 'exploration',
      exploration: { startUrls: ['https://mock-login-captcha.local/login'], maxSteps: 10, maxPages: 5 },
    });
    expect(started.success).toBe(true);

    const runId = started.run?.runId as string;
    const detail = await waitForValue(
      () => svc.getRun(runId),
      (value) => value?.summary.status === 'FAILED',
    );
    expect(detail?.summary.status).toBe('FAILED');
    expect(detail?.summary.summary).toBe('LOGIN_CAPTCHA_REQUIRED');
    expect(detail?.summary.currentStage).toBe('RUNNING_EXPLORATION');
  });

  it('start run rejects project-scoped execution without explicit repo selection', async () => {
    const project = new ProjectRepository(db).create({ name: 'Project A' });
    new LocalRepoRepository(db).create({ projectId: project.id, name: 'Repo A', path: '/ws/project-a' });

    const r = res();
    await router.handle(req('POST', '/runs', {
      runMode: 'regression',
      projectId: project.id,
      selector: { suite: 'smoke' },
    }), r.res);
    expect(r.status()).toBe(400);
    expect((r.body() as { errorCode: string }).errorCode).toBe('RUN_REPO_REQUIRED');
  });

  it('execution report aggregates failure reports, code tasks, testcase profiles, and artifact links', () => {
    new RunRepository(db).create({ runId: 'r-report', scopeType: 'suite', scopeValue: 'smoke', workspacePath: '/ws', startedAt: new Date().toISOString() });
    new RunRepository(db).update('r-report', {
      status: 'ANALYZING_FAILURES',
      currentStage: 'ANALYZING_FAILURES',
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      summary: 'failure-detected',
      updatedAt: new Date().toISOString(),
    });
    db.prepare(`
      INSERT INTO execution_reports (id, run_id, status, report_path, totals_json, generated_at)
      VALUES ('er-1', 'r-report', 'ANALYZING_FAILURES', 'runs/r-report-execution-report.json', '{"flowStepCount":4,"uiActionCount":2,"apiCallCount":3,"failedApiCount":1}', ?)
    `).run(new Date().toISOString());
    db.prepare(`
      INSERT INTO test_results
        (id, run_id, testcase_id, status, error_message, screenshot_path, trace_path, started_at, created_at)
      VALUES
        ('tr-pass', 'r-report', 'tc-pass', 'passed', NULL, NULL, NULL, ?, ?),
        ('tr-fail', 'r-report', 'tc-fail', 'failed', 'boom', 'artifacts/r-report/tc-fail/shot.png', 'artifacts/r-report/tc-fail/trace.zip', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    new CodeTaskRepository(db).create({ taskId: 'task-report', runId: 'r-report', testcaseId: 'tc-fail', workspacePath: '/ws', goal: 'fix boom', createdAt: new Date().toISOString() });
    db.prepare(`
      UPDATE code_tasks
      SET status = 'FAILED', diff_path = 'code-tasks/task-report/changes.diff', patch_path = 'code-tasks/task-report/changes.patch', updated_at = ?
      WHERE task_id = 'task-report'
    `).run(new Date().toISOString());
    db.prepare(`
      INSERT INTO run_events (id, run_id, entity_type, entity_id, event_type, payload_schema_version, payload_json, created_at)
      VALUES ('evt-1', 'r-report', 'run', 'r-report', 'RUN_STEP_DEGRADED', 1, '{"reason":"trace provider unavailable"}', ?)
    `).run(new Date().toISOString());
    db.prepare(`
      INSERT INTO flow_step_records
        (id, run_id, testcase_id, flow_id, step_name, success, started_at, ended_at, duration_ms, ui_action_count, api_call_count, failed_api_count)
      VALUES
        ('fs-1', 'r-report', 'tc-fail', 'flow-main', 'open checkout', 1, ?, ?, 320, 2, 3, 1)
    `).run('2026-03-19T08:00:00.000Z', '2026-03-19T08:00:00.320Z');
    db.prepare(`
      INSERT INTO ui_action_records
        (id, run_id, testcase_id, flow_step_id, action_type, locator, page_url, success, started_at, ended_at, duration_ms, api_call_count, failed_api_count)
      VALUES
        ('ua-1', 'r-report', 'tc-fail', 'fs-1', 'click', '[data-test=checkout]', 'https://example.test/checkout', 1, ?, ?, 80, 2, 1)
    `).run('2026-03-19T08:00:00.050Z', '2026-03-19T08:00:00.130Z');
    db.prepare(`
      INSERT INTO api_call_records
        (id, run_id, testcase_id, flow_step_id, ui_action_id, method, url, status_code, response_summary, success, error_message, started_at, ended_at, duration_ms)
      VALUES
        ('api-1', 'r-report', 'tc-fail', 'fs-1', 'ua-1', 'POST', 'https://example.test/api/checkout', 500, 'internal error', 0, 'boom', ?, ?, 120)
    `).run('2026-03-19T08:00:00.070Z', '2026-03-19T08:00:00.190Z');
    new FindingRepository(db).save({
      id: 'finding-1',
      runId: 'r-report',
      category: 'console-errors',
      severity: 'high',
      title: 'Console errors detected',
      summary: 'Page raised repeated console errors',
      createdAt: new Date().toISOString(),
    });

    const report = runSvc.getExecutionReport('r-report');
    expect(report).not.toBeNull();
    expect(report?.failureReports).toHaveLength(1);
    expect(report?.failureReports[0]?.testcaseId).toBe('tc-fail');
    expect(report?.codeTaskSummaries).toHaveLength(1);
    expect(report?.codeTaskSummaries[0]?.taskId).toBe('task-report');
    expect(report?.testcaseProfiles.map((item) => item.testcaseId)).toEqual(expect.arrayContaining(['tc-pass', 'tc-fail']));
    expect(report?.artifactLinks).toContain('/api/runs/r-report/testcases/tc-fail/artifacts/screenshot');
    expect(report?.artifactLinks).toContain('/api/code-tasks/task-report/artifacts/diff');
    expect(report?.degradedSteps).toContain('trace provider unavailable');
    expect(report?.stageResults.map((item) => item.stage)).toEqual([
      'RUNNING_TESTS',
      'ANALYZING_FAILURES',
      'AWAITING_CODE_ACTION',
      'RUNNING_CODE_TASK',
      'AWAITING_REVIEW',
      'READY_TO_COMMIT',
      'COMPLETED',
    ]);
    expect(report?.stageResults.find((item) => item.stage === 'RUNNING_TESTS')?.status).toBe('success');
    expect(report?.stageResults.find((item) => item.stage === 'ANALYZING_FAILURES')?.status).toBe('degraded');
    expect(report?.flowSummaries).toHaveLength(1);
    expect(report?.flowSummaries[0]).toMatchObject({
      flowId: 'flow-main',
      stepCount: 1,
      uiActionCount: 2,
      apiCallCount: 3,
      failedApiCount: 1,
    });
    expect(report?.warnings).toContain('trace provider unavailable');
    expect(report?.warnings).toContain('存在 1 个失败接口调用');
    expect(report?.warnings).toContain('存在 1 个失败用例');
    expect(report?.warnings).toContain('存在 1 个 high findings');
    expect(report?.recommendations).toContain('优先查看失败报告，并核对 trace/log/network 产物。');
    expect(report?.recommendations).toContain('检查降级步骤涉及的外部依赖、凭据或诊断服务。');
  });

  it('execution report normalizes terminal currentStage and avoids duplicating fatal reason in warnings', () => {
    new RunRepository(db).create({
      runId: 'r-explore-failed',
      runMode: 'exploration',
      scopeType: 'exploration',
      workspacePath: '/ws',
      startedAt: new Date().toISOString(),
    });
    new RunRepository(db).update('r-explore-failed', {
      status: 'FAILED',
      currentStage: 'FAILED',
      summary: 'LOGIN_AI_FAILED',
      endedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const report = runSvc.getExecutionReport('r-explore-failed');
    expect(report).not.toBeNull();
    expect(report?.currentStage).toBe('RUNNING_EXPLORATION');
    expect(report?.stageResults.find((item) => item.stage === 'RUNNING_EXPLORATION')?.status).toBe('failed');
    expect(report?.warnings ?? []).not.toContain('LOGIN_AI_FAILED');
    expect(report?.fatalReason).toBe('LOGIN_AI_FAILED');
  });

  it('run prompt samples are loaded from agent session traces', () => {
    const projectId = 'project-prompt';
    const dataRoot = join(dir, '.zarb', 'data');
    const svc = new RunService(db, { dataRoot });
    const runId = 'r-prompt-samples';
    const now = new Date().toISOString();

    new RunRepository(db).create({
      runId,
      runMode: 'exploration',
      scopeType: 'exploration',
      workspacePath: '/ws',
      projectId,
      startedAt: now,
    });

    const sessions = new AgentSessionRepository(db);
    sessions.save({
      sessionId: 'session-a',
      runId,
      kind: 'exploration',
      status: 'completed',
      contextRefsJson: '{}',
      startedAt: now,
      updatedAt: now,
      endedAt: now,
    });
    sessions.save({
      sessionId: 'session-b',
      runId,
      kind: 'exploration',
      status: 'completed',
      contextRefsJson: '{}',
      startedAt: now,
      updatedAt: now,
      endedAt: now,
    });

    const sessionADir = join(dataRoot, '..', 'projects', projectId, 'agent-traces', 'session-a');
    const sessionBDir = join(dataRoot, '..', 'projects', projectId, 'agent-traces', 'session-b');
    mkdirSync(sessionADir, { recursive: true });
    mkdirSync(sessionBDir, { recursive: true });

    writeFileSync(join(dataRoot, '..', 'projects', projectId, agentPromptSamplesPath('session-a')), `${JSON.stringify({
      sessionId: 'session-a',
      stepIndex: 3,
      timestamp: '2026-03-19T10:00:05.000Z',
      phase: 'llm.decide',
      templateVersion: 'exploration-login/default@v1',
      prompt: 'p1',
      response: '{"action":"fill"}',
      sampledBy: 'interval',
    })}\n`, 'utf8');
    writeFileSync(join(dataRoot, '..', 'projects', projectId, agentPromptSamplesPath('session-b')), `${JSON.stringify({
      sessionId: 'session-b',
      stepIndex: 1,
      timestamp: '2026-03-19T10:00:01.000Z',
      phase: 'llm.decide',
      templateVersion: 'exploration-login/default@v1',
      prompt: 'p0',
      sampledBy: 'first-step',
    })}\n`, 'utf8');

    const samples = svc.getRunPromptSamples(runId);
    expect(samples).toHaveLength(2);
    expect(samples[0]?.sessionId).toBe('session-b');
    expect(samples[0]?.prompt).toBe('p0');
    expect(samples[1]?.sessionId).toBe('session-a');
    expect(samples[1]?.response).toBe('{"action":"fill"}');
  });
});

// ---------------------------------------------------------------------------
// Critical flow: CodeTask lifecycle (approve → execute → review → commit)
// ---------------------------------------------------------------------------

describe('CodeTask lifecycle flow', () => {
  function seedTask(taskId = 't1', runId = 'r1'): void {
    new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    new RunRepository(db).update(runId, { status: 'ANALYZING_FAILURES', currentStage: 'ANALYZING_FAILURES', updatedAt: new Date().toISOString() });
    new CodeTaskRepository(db).create({ taskId, runId, workspacePath: '/ws', goal: 'fix test', createdAt: new Date().toISOString() });
  }

  it('approve → execute → review accept → commit', async () => {
    seedTask();

    // Approve
    const approve = res();
    await router.handle(req('POST', '/code-tasks/t1/approve'), approve.res);
    expect(approve.status()).toBe(200);
    expect(new RunRepository(db).findById('r1')?.status).toBe('AWAITING_CODE_ACTION');

    // Execute — returns immediately (fire-and-forget)
    const execute = res();
    await router.handle(req('POST', '/code-tasks/t1/execute'), execute.res);
    expect(execute.status()).toBe(200);

    // Wait for background execution to complete (mock agent resolves synchronously)
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    // After real execution, task should be SUCCEEDED (verify passes with no commands)
    const afterExec = res();
    await router.handle(req('GET', '/code-tasks/t1'), afterExec.res);
    const afterExecData = afterExec.body().data as { summary: { status: string } };
    expect(afterExecData.summary.status).toBe('SUCCEEDED');
    expect(new RunRepository(db).findById('r1')?.status).toBe('AWAITING_REVIEW');

    // Submit review (accept)
    const review = res();
    await router.handle(req('POST', '/reviews', { taskId: 't1', decision: 'accept', codeTaskVersion: 1 }), review.res);
    expect(review.status()).toBe(200);
    expect(new RunRepository(db).findById('r1')?.status).toBe('READY_TO_COMMIT');

    // Detail — status should be COMMIT_PENDING
    const detail = res();
    await router.handle(req('GET', '/code-tasks/t1'), detail.res);
    const d = detail.body().data as { summary: { status: string }; reviews: unknown[] };
    expect(d.summary.status).toBe('COMMIT_PENDING');
    expect(d.reviews).toHaveLength(1);

    // Create commit
    const commit = res();
    await router.handle(req('POST', '/commits', { taskId: 't1', commitMessage: 'fix: stabilize test', expectedTaskVersion: 1 }), commit.res);
    expect(commit.status()).toBe(200);
    expect(new RunRepository(db).findById('r1')?.status).toBe('COMPLETED');
  });

  it('failed agent execution persists rawOutputPath from the artifact writer', async () => {
    new RunRepository(db).create({ runId: 'r-fail-path', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    new RunRepository(db).update('r-fail-path', { status: 'ANALYZING_FAILURES', currentStage: 'ANALYZING_FAILURES', updatedAt: new Date().toISOString() });
    new CodeTaskRepository(db).create({ taskId: 't-fail-path', runId: 'r-fail-path', workspacePath: '/ws', goal: 'fix test', createdAt: new Date().toISOString() });
    db.prepare("UPDATE code_tasks SET status='APPROVED' WHERE task_id='t-fail-path'").run();

    const customRoot = join(dir, 'custom-code-tasks');
    const failingAgent = { run: () => Promise.resolve({ rawOutput: 'boom', exitCode: 1 }) } as unknown as CodexCliAgent;
    const commitMgr = { commit: () => ({ success: true, commitSha: 'abc123' }) } as unknown as CommitManager;
    const svc = new CodeTaskService(db, dir, failingAgent, commitMgr, customRoot);

    const result = await svc.executeCodeTask('t-fail-path');
    expect(result.success).toBe(true);
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const detail = svc.getCodeTask('t-fail-path');
    expect(detail?.summary.status).toBe('FAILED');
    expect(detail?.rawOutputPath).toBe('custom-code-tasks/t-fail-path/raw-output.txt');
  });


  it('submitReview rejects stale codeTaskVersion', async () => {
    seedTask('tv1');
    db.prepare("UPDATE code_tasks SET status='SUCCEEDED' WHERE task_id='tv1'").run();
    const r = res();
    await router.handle(req('POST', '/reviews', { taskId: 'tv1', decision: 'accept', codeTaskVersion: 99 }), r.res);
    expect(r.status()).toBe(409);
  });

  it('submitReview rejects FAILED task without forceReviewOnVerifyFailure', async () => {
    seedTask('tv2');
    db.prepare("UPDATE code_tasks SET status='FAILED', verify_passed=0, diff_path='code-tasks/tv2/changes.diff' WHERE task_id='tv2'").run();
    const r = res();
    await router.handle(req('POST', '/reviews', { taskId: 'tv2', decision: 'accept', codeTaskVersion: 1 }), r.res);
    expect(r.status()).toBe(409);
  });

  it('submitReview rejects FAILED task that has no verify artifacts (agent crash, not verify failure)', async () => {
    seedTask('tv2b');
    db.prepare("UPDATE code_tasks SET status='FAILED' WHERE task_id='tv2b'").run();
    const r = res();
    await router.handle(req('POST', '/reviews', { taskId: 'tv2b', decision: 'accept', codeTaskVersion: 1, forceReviewOnVerifyFailure: true }), r.res);
    expect(r.status()).toBe(409);
  });

  it('submitReview accepts FAILED task with forceReviewOnVerifyFailure=true when verify artifacts exist', async () => {
    seedTask('tv3');
    db.prepare("UPDATE code_tasks SET status='FAILED', verify_passed=0, diff_path='code-tasks/tv3/changes.diff' WHERE task_id='tv3'").run();
    const r = res();
    await router.handle(req('POST', '/reviews', { taskId: 'tv3', decision: 'accept', codeTaskVersion: 1, forceReviewOnVerifyFailure: true }), r.res);
    expect(r.status()).toBe(200);
  });

  it('execute persists changedFiles in task detail', async () => {
    seedTask('tv4');
    const approve = res();
    await router.handle(req('POST', '/code-tasks/tv4/approve'), approve.res);
    await router.handle(req('POST', '/code-tasks/tv4/execute'), res().res);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const detail = res();
    await router.handle(req('GET', '/code-tasks/tv4'), detail.res);
    const d = detail.body().data as { changedFiles: unknown[] };
    // changedFiles is an array (empty in test env since /ws is not a git repo, but field must exist)
    expect(Array.isArray(d.changedFiles)).toBe(true);
  });

  it('cancel task', async () => {
    seedTask('t2');
    const r = res();
    await router.handle(req('POST', '/code-tasks/t2/cancel'), r.res);
    expect(r.status()).toBe(200);
  });

  it('retry task after failure', async () => {
    seedTask('t3');
    db.prepare("UPDATE code_tasks SET status='FAILED' WHERE task_id='t3'").run();
    const r = res();
    await router.handle(req('POST', '/code-tasks/t3/retry'), r.res);
    expect(r.status()).toBe(200);
  });

  it('review retry marks the current task rejected and creates a follow-up draft', async () => {
    seedTask('t-retry-review');
    db.prepare("UPDATE code_tasks SET status='SUCCEEDED' WHERE task_id='t-retry-review'").run();

    const review = res();
    await router.handle(req('POST', '/reviews', {
      taskId: 't-retry-review',
      decision: 'retry',
      codeTaskVersion: 1,
    }), review.res);

    expect(review.status()).toBe(200);

    const tasks = new CodeTaskRepository(db).list({ runId: 'r1', limit: 10 }).items;
    expect(tasks.map((task) => task.status)).toEqual(expect.arrayContaining(['REJECTED', 'DRAFT']));
    const retried = tasks.find((task) => task.parent_task_id === 't-retry-review');
    expect(retried?.attempt).toBe(2);
  });

  it('cancel task rejects terminal failed tasks', async () => {
    seedTask('t-cancel-failed');
    db.prepare("UPDATE code_tasks SET status='FAILED' WHERE task_id='t-cancel-failed'").run();
    const r = res();
    await router.handle(req('POST', '/code-tasks/t-cancel-failed/cancel'), r.res);
    expect(r.status()).toBe(409);
    expect((r.body() as { errorCode: string }).errorCode).toBe('CODE_TASK_STATE_INVALID');
  });

  it('approve unknown task returns 404', async () => {
    const r = res();
    await router.handle(req('POST', '/code-tasks/nope/approve'), r.res);
    expect(r.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Critical flow: Settings (validate → save → version conflict)
// ---------------------------------------------------------------------------

describe('Settings flow', () => {
  it('validate → save → re-read', async () => {
    // Validate
    const validate = res();
    await router.handle(req('POST', '/settings/validate', { patch: { report: { port: 4000 } } }), validate.res);
    expect(validate.status()).toBe(200);
    const vd = validate.body().data as { valid: boolean };
    expect(vd.valid).toBe(true);

    // Save
    const save = res();
    await router.handle(req('PUT', '/settings', { patch: { report: { port: 4000 } }, expectedVersion: 1 }), save.res);
    expect(save.status()).toBe(200);
    expect(save.body().success).toBe(true);

    // Re-read — port updated
    const get = res();
    await router.handle(req('GET', '/settings'), get.res);
    const snap = get.body().data as { version: number; values: { report: { port: number } } };
    expect(snap.version).toBe(2);
    expect(snap.values.report.port).toBe(4000);
  });

  it('version conflict returns 409', async () => {
    const r = res();
    await router.handle(req('PUT', '/settings', { patch: { report: { port: 3910 } }, expectedVersion: 99 }), r.res);
    expect(r.status()).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// API contract consistency — all documented endpoints, response structure,
// and key error codes / HTTP status semantics
// ---------------------------------------------------------------------------

describe('API contract: all documented endpoints exist', () => {
  function seedRun(): string {
    const r = runSvc.startRun({ runMode: 'regression', selector: { suite: 'all' } });
    return r.run?.runId as string;
  }

  // --- Existence checks (not 404) ---

  it('GET /runs', async () => {
    const r = res();
    await router.handle(req('GET', '/runs'), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /runs', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', { runMode: 'regression', selector: { suite: 'all' } }), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId/execution-report', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/execution-report`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId/events', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/events`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /runs/:runId/failure-reports', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/failure-reports`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /runs/:runId/pause', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/pause`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /runs/:runId/resume returns 400 for regression run', async () => {
    const runId = seedRun();
    // First pause the run so resume can be attempted
    runSvc.pauseRun(runId);
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/resume`), r.res);
    // regression runs return NOT_SUPPORTED
    expect(r.status()).toBe(400);
  });

  it('POST /runs/:runId/cancel', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/cancel`), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /code-tasks', async () => {
    const r = res();
    await router.handle(req('GET', '/code-tasks'), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /settings', async () => {
    const r = res();
    await router.handle(req('GET', '/settings'), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('POST /settings/validate', async () => {
    const r = res();
    await router.handle(req('POST', '/settings/validate', { patch: {} }), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('PUT /settings', async () => {
    const r = res();
    await router.handle(req('PUT', '/settings', { patch: {} }), r.res);
    expect(r.status()).not.toBe(404);
  });

  it('GET /doctor', async () => {
    const r = res();
    await router.handle(req('GET', '/doctor'), r.res);
    expect(r.status()).not.toBe(404);
  });

  // --- Response structure checks ---

  it('GET /runs returns { success, data: { items, nextCursor? } }', async () => {
    const r = res();
    await router.handle(req('GET', '/runs'), r.res);
    expect(r.status()).toBe(200);
    const b = r.body();
    expect(b.success).toBe(true);
    const d = b.data as { items: unknown[] };
    expect(Array.isArray(d.items)).toBe(true);
  });

  it('GET /runs/:runId returns { success, data: { summary } }', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}`), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { summary: { runId: string; status: string } };
    expect(d.summary.runId).toBe(runId);
    expect(typeof d.summary.status).toBe('string');
  });

  it('GET /runs/:runId unknown returns 404 with errorCode RUN_NOT_FOUND', async () => {
    const r = res();
    await router.handle(req('GET', '/runs/no-such-run'), r.res);
    expect(r.status()).toBe(404);
    expect(r.body().errorCode).toBe('RUN_NOT_FOUND');
  });

  it('POST /runs missing runMode returns 400', async () => {
    const r = res();
    await router.handle(req('POST', '/runs', {}), r.res);
    expect(r.status()).toBe(400);
    expect(r.body().success).toBe(false);
    expect(typeof r.body().errorCode).toBe('string');
  });

  it('GET /settings returns { success, data: { version, values } }', async () => {
    const r = res();
    await router.handle(req('GET', '/settings'), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { version: number; values: Record<string, unknown> };
    expect(typeof d.version).toBe('number');
    expect(typeof d.values).toBe('object');
  });

  it('POST /settings/validate returns { success, data: { valid, errors } }', async () => {
    const r = res();
    await router.handle(req('POST', '/settings/validate', { patch: { report: { port: -1 } } }), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { valid: boolean; errors: string[] };
    expect(d.valid).toBe(false);
    expect(Array.isArray(d.errors)).toBe(true);
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it('PUT /settings version conflict returns 409 with errorCode SETTINGS_VERSION_CONFLICT', async () => {
    const r = res();
    await router.handle(req('PUT', '/settings', { patch: { report: { port: 3910 } }, expectedVersion: 99 }), r.res);
    expect(r.status()).toBe(409);
    expect(r.body().errorCode).toBe('SETTINGS_VERSION_CONFLICT');
  });

  it('GET /code-tasks returns { success, data: { items, nextCursor? } }', async () => {
    const r = res();
    await router.handle(req('GET', '/code-tasks'), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { items: unknown[] };
    expect(Array.isArray(d.items)).toBe(true);
  });

  it('GET /doctor returns { success, data: { healthy, checks } }', async () => {
    const r = res();
    await router.handle(req('GET', '/doctor'), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { healthy: boolean; checks: unknown[] };
    expect(typeof d.healthy).toBe('boolean');
    expect(Array.isArray(d.checks)).toBe(true);
  });

  // --- Testcase-level endpoints (all documented in api-contract-design.md §6) ---

  it('GET /runs/:runId/testcases/:testcaseId/failure-report returns 404 for unknown', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/failure-report`), r.res);
    expect(r.status()).toBe(404);
  });

  it('GET /runs/:runId/testcases/:testcaseId/execution-profile returns 404 for unknown', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/execution-profile`), r.res);
    expect(r.status()).toBe(404);
  });

  it('GET /runs/:runId/testcases/:testcaseId/diagnostics returns { correlationContext, diagnosticFetches }', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/tc1/diagnostics`), r.res);
    expect(r.status()).toBe(200);
    const d = r.body().data as { correlationContext: unknown; diagnosticFetches: unknown[] };
    expect(typeof d.correlationContext).toBe('object');
    expect(Array.isArray(d.diagnosticFetches)).toBe(true);
  });

  it('GET /runs/:runId/testcases/:testcaseId/trace returns unavailableReason for unknown testcase', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/trace`), r.res);
    expect(r.status()).toBe(200);
    // Now returns a degraded detail with unavailableReason instead of null
    expect(r.body().data).not.toBeNull();
    expect((r.body().data as { unavailableReason?: string }).unavailableReason).toBeTruthy();
  });

  it('GET /runs/:runId/testcases/:testcaseId/logs returns unavailableReason for unknown testcase', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/logs`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().data).not.toBeNull();
    expect((r.body().data as { unavailableReason?: string }).unavailableReason).toBeTruthy();
  });

  it('GET /trace triggers fetchDiagnostics and writes trace-summary.json when provider returns data', async () => {
    const runId = seedRun();
    // Seed a correlation context with a traceId
    new CorrelationContextRepository(db).save({
      id: `ctx-${runId}`,
      runId,
      testcaseId: 'tc-diag',
      traceIdsJson: JSON.stringify(['trace-xyz']),
      requestIdsJson: '[]',
      sessionIdsJson: '[]',
      createdAt: new Date().toISOString(),
    });

    // Inject a mock trace provider that returns a real TraceSummary
    const mockSummary = { traceId: 'trace-xyz', hasError: false, errorSpans: [], topSlowSpans: [] };
    const mockDiagSvc = new DiagnosticsService(
      db,
      dir,
      join(dir, 'artifacts'),
      join(dir, 'diagnostics'),
      { getTrace: () => Promise.resolve(mockSummary) },
    );
    const mockRouter = buildRouter(runSvc, mockDiagSvc, taskSvc, new SettingsService(join(dir, 'config.json')));

    const r = res();
    await mockRouter.handle(req('GET', `/runs/${runId}/testcases/tc-diag/trace`), r.res);
    expect(r.status()).toBe(200);
    expect((r.body().data as { summary: { traceId: string } } | null)?.summary.traceId).toBe('trace-xyz');

    // Summary file should be written
    const summaryFile = join(dir, 'diagnostics', runId, 'tc-diag', 'trace-summary.json');
    const written = JSON.parse(readFileSync(summaryFile, 'utf8')) as { traceId: string };
    expect(written.traceId).toBe('trace-xyz');
  });

  it('fetchDiagnostics writes summaries under a configured diagnosticRoot', async () => {
    const runId = seedRun();
    new CorrelationContextRepository(db).save({
      id: `ctx-configured-${runId}`,
      runId,
      testcaseId: 'tc-custom-diag',
      traceIdsJson: JSON.stringify(['trace-custom']),
      requestIdsJson: '[]',
      sessionIdsJson: '[]',
      createdAt: new Date().toISOString(),
    });

    const diagnosticRoot = join(dir, 'custom-diagnostics');
    const diagSvc = new DiagnosticsService(
      db,
      dir,
      join(dir, 'artifacts'),
      diagnosticRoot,
      { getTrace: () => Promise.resolve({ traceId: 'trace-custom', hasError: false, errorSpans: [], topSlowSpans: [] }) },
    );

    await diagSvc.fetchDiagnostics(runId, 'tc-custom-diag');

    const summaryFile = join(diagnosticRoot, runId, 'tc-custom-diag', 'trace-summary.json');
    const written = JSON.parse(readFileSync(summaryFile, 'utf8')) as { traceId: string };
    expect(written.traceId).toBe('trace-custom');
  });

  it('GET /trace does not append duplicate degraded fetches on repeated reads', async () => {
    const runId = seedRun();
    new CorrelationContextRepository(db).save({
      id: `ctx-repeat-trace-${runId}`,
      runId,
      testcaseId: 'tc-repeat-trace',
      traceIdsJson: JSON.stringify(['trace-repeat']),
      requestIdsJson: '[]',
      sessionIdsJson: '[]',
      createdAt: new Date().toISOString(),
    });

    const diagSvc = new DiagnosticsService(
      db,
      dir,
      join(dir, 'artifacts'),
      join(dir, 'diagnostics'),
      { getTrace: () => Promise.resolve(null) },
    );
    const repeatRouter = buildRouter(runSvc, diagSvc, taskSvc, new SettingsService(join(dir, 'config.json')));

    const first = res();
    await repeatRouter.handle(req('GET', `/runs/${runId}/testcases/tc-repeat-trace/trace`), first.res);
    expect(first.status()).toBe(200);

    const second = res();
    await repeatRouter.handle(req('GET', `/runs/${runId}/testcases/tc-repeat-trace/trace`), second.res);
    expect(second.status()).toBe(200);

    const rows = new DiagnosticFetchRepository(db).findByTestcase(runId, 'tc-repeat-trace')
      .filter((row) => row.type === 'trace');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('degraded');
  });

  it('GET /logs does not append duplicate degraded fetches on repeated reads', async () => {
    const runId = seedRun();
    new CorrelationContextRepository(db).save({
      id: `ctx-repeat-log-${runId}`,
      runId,
      testcaseId: 'tc-repeat-log',
      traceIdsJson: '[]',
      requestIdsJson: JSON.stringify(['req-repeat']),
      sessionIdsJson: '[]',
      createdAt: new Date().toISOString(),
    });

    const diagSvc = new DiagnosticsService(
      db,
      dir,
      join(dir, 'artifacts'),
      join(dir, 'diagnostics'),
      undefined,
      { query: () => Promise.resolve(null) },
    );
    const repeatRouter = buildRouter(runSvc, diagSvc, taskSvc, new SettingsService(join(dir, 'config.json')));

    const first = res();
    await repeatRouter.handle(req('GET', `/runs/${runId}/testcases/tc-repeat-log/logs`), first.res);
    expect(first.status()).toBe(200);

    const second = res();
    await repeatRouter.handle(req('GET', `/runs/${runId}/testcases/tc-repeat-log/logs`), second.res);
    expect(second.status()).toBe(200);

    const rows = new DiagnosticFetchRepository(db).findByTestcase(runId, 'tc-repeat-log')
      .filter((row) => row.type === 'log');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('degraded');
  });

  it('onConfigUpdated refreshes trace/log providers', async () => {
    const diagSvc = new DiagnosticsService(db, dir);
    // Calling onConfigUpdated should not throw and should swap providers
    const snapshot = await new SettingsService(join(dir, 'config.json')).getSettings();
    await expect(diagSvc.onConfigUpdated(snapshot)).resolves.toBeUndefined();
  });

  it('GET /runs/:runId/testcases/:testcaseId/analysis returns null data for unknown testcase', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}/testcases/no-tc/analysis`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().data).toBeNull();
  });

  it('POST /runs/:runId/testcases/:testcaseId/analysis/retry returns action result', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('POST', `/runs/${runId}/testcases/tc1/analysis/retry`), r.res);
    expect(r.status()).toBe(200);
    expect(r.body().success).toBe(true);
  });

  // --- Preview / API field alignment ---
  // Verifies that the API response shapes match what the UI types.ts declares,
  // preventing silent drift between design, API, and preview layers.

  it('RunSummary fields align: runId, status, runMode, startedAt present', async () => {
    runSvc.startRun({ runMode: 'regression', selector: { suite: 'smoke' } });
    const r = res();
    await router.handle(req('GET', '/runs'), r.res);
    const items = (r.body().data as { items: Record<string, unknown>[] }).items;
    expect(items.length).toBeGreaterThan(0);
    const run = items[0] as Record<string, unknown>;
    expect(typeof run['runId']).toBe('string');
    expect(typeof run['status']).toBe('string');
    expect(typeof run['runMode']).toBe('string');
    expect(typeof run['startedAt']).toBe('string');
  });

  it('RunDetail fields align: summary.runId, summary.status, events, findings present', async () => {
    const runId = seedRun();
    const r = res();
    await router.handle(req('GET', `/runs/${runId}`), r.res);
    const d = r.body().data as Record<string, unknown>;
    const summary = d['summary'] as Record<string, unknown>;
    expect(typeof summary['runId']).toBe('string');
    expect(typeof summary['status']).toBe('string');
    expect(Array.isArray(d['events'])).toBe(true);
    expect(Array.isArray(d['findings'])).toBe(true);
  });

  it('SettingsSnapshot fields align: version (number), values (object), sourcePath (string)', async () => {
    const r = res();
    await router.handle(req('GET', '/settings'), r.res);
    const d = r.body().data as Record<string, unknown>;
    expect(typeof d['version']).toBe('number');
    expect(typeof d['values']).toBe('object');
    expect(typeof d['sourcePath']).toBe('string');
  });

  it('DoctorCheckResult fields align: name, status, message all strings', async () => {
    const settingsSvc = new SettingsService(join(dir, 'config.json'));
    const doctorRouter = buildRouter(runSvc, new DiagnosticsService(db, dir), taskSvc, settingsSvc, new DoctorService(db, settingsSvc));
    const r = res();
    await doctorRouter.handle(req('GET', '/doctor'), r.res);
    const checks = (r.body().data as { checks: Record<string, unknown>[] }).checks;
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(typeof c['name']).toBe('string');
      expect(typeof c['status']).toBe('string');
      expect(typeof c['message']).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Migration regression — schema must be stable and match scripts/sql
// ---------------------------------------------------------------------------

describe('Migration regression', () => {
  it('runMigrations is idempotent across all SQL files', () => {
    // Already applied in beforeEach — running again must not throw
    expect(() => { runMigrations(db, MIGRATIONS_DIR); }).not.toThrow();
  });

  it('all expected tables exist after migration', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
    for (const t of ['test_runs', 'code_tasks', 'reviews', 'commit_records', 'run_events', 'agent_sessions', '_migrations']) {
      expect(tables).toContain(t);
    }
  });

  it('_migrations versions match scripts/sql *.sql filenames exactly', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => f.replace(/\.sql$/, ''))
      .sort();

    const applied = (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: string }[]).map(r => r.version).sort();

    expect(applied).toEqual(sqlFiles);
  });

  it('test_runs has required columns', () => {
    const cols = (db.prepare("PRAGMA table_info(test_runs)").all() as { name: string }[]).map(c => c.name);
    for (const col of ['run_id', 'run_mode', 'status', 'workspace_path', 'started_at', 'updated_at']) {
      expect(cols).toContain(col);
    }
  });

  it('code_tasks has required columns', () => {
    const cols = (db.prepare("PRAGMA table_info(code_tasks)").all() as { name: string }[]).map(c => c.name);
    for (const col of ['task_id', 'run_id', 'status', 'goal', 'workspace_path', 'created_at', 'updated_at']) {
      expect(cols).toContain(col);
    }
  });

  it('key indexes exist', () => {
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map(r => r.name);
    for (const idx of [
      'idx_code_tasks_run_case_status_updated',
      'idx_reviews_task_id',
      'idx_run_events_run_created',
    ]) {
      expect(indexes).toContain(idx);
    }
  });
});

// ---------------------------------------------------------------------------
// Preview smoke checks — docs/ui-preview must contain key API/UI field names
// ---------------------------------------------------------------------------

describe('Preview smoke checks', () => {
  const PREVIEW_DIR = join(new URL('.', import.meta.url).pathname, '../../../docs/ui-preview');

  const check = (file: string, terms: string[]) => {
    const html = readFileSync(join(PREVIEW_DIR, file), 'utf8');
    for (const term of terms) {
      expect(html, `${file} must contain "${term}"`).toContain(term);
    }
  };

  it('run-list.html contains runId, runMode, status', () => {
    check('run-list.html', ['runId', 'runMode', 'status']);
  });

  it('run-detail.html contains runMode, findings, RUNNING', () => {
    check('run-detail.html', ['runMode', 'findings', 'RUNNING']);
  });

  it('settings.html contains version', () => {
    check('settings.html', ['version']);
  });

  it('code-task-detail.html contains status', () => {
    check('code-task-detail.html', ['status']);
  });
});
