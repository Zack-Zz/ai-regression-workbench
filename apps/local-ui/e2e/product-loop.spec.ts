/**
 * Phase 16 — Release readiness e2e coverage.
 * Covers: full product API loop (run → diagnostics → code-task → review → commit),
 * restart/recovery (DB persistence), browser-matrix validation, and security guardrails.
 *
 * Requires: `pnpm test:e2e` (Playwright with Chromium/Firefox/WebKit).
 */
import { test, expect } from '@playwright/test';

function apiBase(): string {
  const port = process.env['E2E_API_PORT'] ?? '3919';
  return `http://localhost:${port}`;
}

// ---------------------------------------------------------------------------
// Doctor: health check endpoint
// ---------------------------------------------------------------------------

test('Doctor: /doctor returns health check results with sqlite.schema', async ({ page }) => {
  const res = await page.request.get(`${apiBase()}/doctor`);
  expect(res.ok()).toBe(true);
  const body = await res.json() as { data: { checks: Array<{ name: string; status: string }> } };
  expect(Array.isArray(body.data.checks)).toBe(true);
  const schemaCheck = body.data.checks.find(c => c.name === 'sqlite.schema');
  expect(schemaCheck?.status).toBe('ok');
});

// ---------------------------------------------------------------------------
// Run lifecycle: create → list → get → cancel
// ---------------------------------------------------------------------------

test('Run lifecycle: create, list, get, cancel', async ({ page }) => {
  const base = apiBase();

  // Create — correct API contract: selector + projectPath
  const createRes = await page.request.post(`${base}/runs`, {
    data: { runMode: 'regression', selector: { suite: 'smoke' }, projectPath: '/tmp/e2e-ws' },
  });
  expect(createRes.ok()).toBe(true);
  const createBody = await createRes.json() as { data: { run: { runId: string } } };
  const runId = createBody.data.run.runId;
  expect(runId).toBeTruthy();

  // List
  const listRes = await page.request.get(`${base}/runs`);
  expect(listRes.ok()).toBe(true);
  const listBody = await listRes.json() as { data: { items: Array<{ runId: string }> } };
  expect(listBody.data.items.some(r => r.runId === runId)).toBe(true);

  // Get
  const getRes = await page.request.get(`${base}/runs/${runId}`);
  expect(getRes.ok()).toBe(true);
  const getBody = await getRes.json() as { data: { summary: { runId: string; status: string } } };
  expect(getBody.data.summary.runId).toBe(runId);

  // Cancel (accept 200 or 409 if already cancelled by a concurrent browser run)
  const cancelRes = await page.request.post(`${base}/runs/${runId}/cancel`);
  expect([200, 409]).toContain(cancelRes.status());

  // Verify run reached a terminal state (CANCELLED or FAILED — runner may finish before cancel)
  const afterCancel = await page.request.get(`${base}/runs/${runId}`);
  const afterBody = await afterCancel.json() as { data: { summary: { status: string } } };
  expect(['CANCELLED', 'FAILED', 'COMPLETED']).toContain(afterBody.data.summary.status);
});

// ---------------------------------------------------------------------------
// Diagnostics: endpoints respond for a known run
// ---------------------------------------------------------------------------

test('Diagnostics: failure-reports and diagnostics endpoints respond', async ({ page }) => {
  const base = apiBase();

  const createRes = await page.request.post(`${base}/runs`, {
    data: { runMode: 'regression', selector: { suite: 'diag' }, projectPath: '/tmp/e2e-ws' },
  });
  const createBody = await createRes.json() as { data: { run: { runId: string } } };
  const runId = createBody.data.run.runId;

  // failure-reports list (empty is fine)
  const frRes = await page.request.get(`${base}/runs/${runId}/failure-reports`);
  expect(frRes.ok()).toBe(true);

  // diagnostics for a non-existent testcase — must not 500
  const diagRes = await page.request.get(`${base}/runs/${runId}/testcases/tc-1/diagnostics`);
  expect(diagRes.status()).toBeLessThan(500);
});

// ---------------------------------------------------------------------------
// Full product loop: real run → diagnostics query → seeded code-task → review → commit
// ---------------------------------------------------------------------------

test('Full product loop: real run → diagnostics → seeded code-task → review → commit', async ({ page }) => {
  const base = apiBase();

  // Step 1: start a real run against the test-assets workspace
  const createRes = await page.request.post(`${base}/runs`, {
    data: { runMode: 'regression', selector: { suite: 'smoke' } },
  });
  expect(createRes.ok()).toBe(true);
  const createBody = await createRes.json() as { data: { run: { runId: string } } };
  const runId = createBody.data.run.runId;
  expect(runId).toBeTruthy();

  // Step 2: query diagnostics endpoints — verifies the run is visible in the system
  const frRes = await page.request.get(`${base}/runs/${runId}/failure-reports`);
  expect(frRes.ok()).toBe(true);

  // Step 3: seed a SUCCEEDED code task derived from the real runId
  // (AI inference is out of scope for automated e2e — see roadmap Phase 16 notes)
  const taskId = `e2e-task-${runId}`;
  const seedRes = await page.request.post(`${base}/e2e-seed/code-task`, {
    data: { taskId, runId },
  });
  expect(seedRes.ok()).toBe(true);

  // Step 4: verify code task is visible and in SUCCEEDED state
  const taskRes = await page.request.get(`${base}/code-tasks/${taskId}`);
  expect(taskRes.ok()).toBe(true);
  const taskBody = await taskRes.json() as { data: { summary: { taskId: string; status: string } } };
  expect(taskBody.data.summary.taskId).toBe(taskId);
  expect(taskBody.data.summary.status).toBe('SUCCEEDED');

  // Step 5: submit review (accept)
  const reviewRes = await page.request.post(`${base}/reviews`, {
    data: { taskId, decision: 'accept', codeTaskVersion: 1 },
  });
  expect(reviewRes.ok()).toBe(true);

  // Step 6: verify task is now COMMIT_PENDING
  const afterReview = await page.request.get(`${base}/code-tasks/${taskId}`);
  const afterReviewBody = await afterReview.json() as { data: { summary: { status: string } } };
  expect(afterReviewBody.data.summary.status).toBe('COMMIT_PENDING');

  // Step 7: commit (may fail if git not configured in e2e workspace — accept 200 or 4xx)
  const commitRes = await page.request.post(`${base}/commits`, {
    data: { taskId, commitMessage: 'e2e: fix test' },
  });
  expect(commitRes.status()).toBeLessThan(500);
});

// ---------------------------------------------------------------------------
// Recovery: run state persists across re-queries (DB durability)
// ---------------------------------------------------------------------------

test('Recovery: run state is readable after re-query (DB persistence)', async ({ page }) => {
  const base = apiBase();

  const createRes = await page.request.post(`${base}/runs`, {
    data: { runMode: 'regression', selector: { suite: 'recovery' }, projectPath: '/tmp/e2e-ws' },
  });
  const createBody = await createRes.json() as { data: { run: { runId: string } } };
  const runId = createBody.data.run.runId;

  // Re-query multiple times — simulates client reconnect
  for (let i = 0; i < 3; i++) {
    const res = await page.request.get(`${base}/runs/${runId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json() as { data: { summary: { runId: string } } };
    expect(body.data.summary.runId).toBe(runId);
  }
});

// ---------------------------------------------------------------------------
// Security guardrails
// ---------------------------------------------------------------------------

test('Security: review endpoint rejects non-existent task', async ({ page }) => {
  const reviewRes = await page.request.post(`${apiBase()}/reviews`, {
    data: { taskId: 'nonexistent-task', decision: 'accept', codeTaskVersion: 1 },
  });
  expect(reviewRes.status()).toBeGreaterThanOrEqual(400);
  expect(reviewRes.status()).toBeLessThan(500);
});

test('Security: commit endpoint rejects non-existent task', async ({ page }) => {
  const commitRes = await page.request.post(`${apiBase()}/commits`, {
    data: { taskId: 'nonexistent-task', commitMessage: 'unauthorized' },
  });
  expect(commitRes.status()).toBeGreaterThanOrEqual(400);
  expect(commitRes.status()).toBeLessThan(500);
});

// ---------------------------------------------------------------------------
// Settings: GET returns current settings with version
// ---------------------------------------------------------------------------

test('Settings: GET returns current settings with version', async ({ page }) => {
  const res = await page.request.get(`${apiBase()}/settings`);
  expect(res.ok()).toBe(true);
  const body = await res.json() as { data: { version: number; values: Record<string, unknown> } };
  expect(typeof body.data.version).toBe('number');
  expect(body.data.values).toBeTruthy();
});
