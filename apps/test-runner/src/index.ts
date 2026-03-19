/**
 * apps/test-runner/src/index.ts
 *
 * Real Playwright regression execution engine for Phase 11.
 *
 * Responsibilities:
 * - Spawn a Playwright test run non-blocking (child_process.spawn) so the API
 *   server event loop remains responsive during execution
 * - Parse JSON reporter output to extract per-testcase results
 * - Derive stable testcaseId / scenarioId from Playwright test annotations
 *   (annotation type "zarb-testcase-id" / "zarb-scenario-id"), falling back to
 *   a deterministic hash of the full title when annotations are absent
 * - Persist test_results (including networkLogPath), artifacts, and correlation
 *   context to storage
 * - Emit correct run events: TESTCASE_PASSED / TESTCASE_FAILED (not for skipped)
 * - Update run counters (total/passed/failed/skipped)
 *
 * Design constraints (from Phase 11 exit criteria):
 * - Runner startup failure → blocking (run transitions to FAILED)
 * - Testcase-level failures → non-blocking (run continues, results persisted)
 * - Artifacts written under documented storage layout (artifactsDir helper)
 * - Correlation context extracted from HAR attachments
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Db } from '@zarb/storage';
import {
  RunRepository,
  TestResultRepository,
  CorrelationContextRepository,
  RunEventRepository,
  correlationContextPath,
} from '@zarb/storage';
import type { SaveRunEventInput, UpsertTestResultInput, SaveCorrelationContextInput } from '@zarb/storage';
import { appLogger } from '@zarb/logger';

const log = appLogger.child('TestRunner');

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RunnerInput {
  runId: string;
  /** Absolute path to the target Playwright project */
  workspacePath: string;
  /** Selector: suite name, tag, or specific testcase title */
  selector?: {
    suite?: string;
    scenarioId?: string;
    tag?: string;
    testcaseId?: string;
  };
  /** Absolute path to the workbench data root (for artifact storage) */
  dataRoot: string;
  /** Absolute root directory for persisted screenshots/traces/videos/network artifacts. */
  artifactRoot?: string;
  /** Correlation header names to extract from HAR network logs */
  correlationHeaders?: string[];
  /** Called with running totals as each test completes (optional) */
  onProgress?: (counts: { total: number; passed: number; failed: number; skipped: number }) => void;
}

export interface RunnerResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** true if Playwright process itself failed to start */
  startupFailure: boolean;
  startupError?: string;
}

// ---------------------------------------------------------------------------
// Playwright JSON reporter output shapes (subset we need)
// ---------------------------------------------------------------------------

interface PWAnnotation {
  type: string;
  description?: string;
}

interface PWTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: { message?: string; value?: string };
  attachments: Array<{ name: string; path?: string; contentType: string }>;
  startTime: string;
}

interface PWTest {
  title: string;
  ok: boolean;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  annotations?: PWAnnotation[];
  results?: PWTestResult[];
}

interface PWSpec {
  title: string;
  tests?: PWTest[];
  suites?: PWSpec[];
}

interface PWReport {
  suites: PWSpec[];
}

// ---------------------------------------------------------------------------
// Flat test record after tree traversal
// ---------------------------------------------------------------------------

interface FlatTest {
  fullTitle: string;
  status: 'passed' | 'failed' | 'skipped';
  testcaseId: string;
  scenarioId?: string;
  /** true when zarb-testcase-id annotation is absent; triggers a degraded event */
  missingAnnotation: boolean;
  lastResult?: PWTestResult;
}

function resolveArtifactLayout(artifactRoot: string, runId: string, testcaseId: string): { relDir: string; absDir: string } {
  const relDir = join(basename(artifactRoot), runId, testcaseId);
  return { relDir, absDir: join(dirname(artifactRoot), relDir) };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export class TestRunner {
  private readonly runs: RunRepository;
  private readonly results: TestResultRepository;
  private readonly correlations: CorrelationContextRepository;
  private readonly events: RunEventRepository;
  /** Active child process per runId — used by cancel() */
  private readonly activeProcs = new Map<string, ReturnType<typeof spawn>>();

  constructor(private readonly db: Db) {
    this.runs = new RunRepository(db);
    this.results = new TestResultRepository(db);
    this.correlations = new CorrelationContextRepository(db);
    this.events = new RunEventRepository(db);
  }

  /**
   * cancel — terminate the in-flight Playwright process for a run.
   * No-op if the run is not currently executing.
   */
  cancel(runId: string): void {
    const proc = this.activeProcs.get(runId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcs.delete(runId);
    }
  }

  /**
   * execute — run Playwright against the target workspace and persist results.
   *
   * Non-blocking: uses child_process.spawn and returns a Promise so the caller
   * (RunService) can await it in a background task without blocking the HTTP
   * server event loop.
   *
   * Selector semantics (Phase 11):
   * - suite / tag → --grep (title-based)
   * - testcaseId / scenarioId → resolve title via `playwright test --list`,
   *   then use --grep on the resolved title so execution scope is constrained
   *   to only the matching test(s), consistent with persisted identity
   */
  async execute(input: RunnerInput): Promise<RunnerResult> {
    const { runId, workspacePath, selector, dataRoot } = input;
    const artifactRoot = input.artifactRoot ?? join(dataRoot, 'artifacts');

    if (!existsSync(workspacePath)) {
      log.error('workspacePath not found', { runId, workspacePath });
      this.appendEvent(runId, 'RUN_STEP_DEGRADED', 'run', runId, {
        reason: `workspacePath not found: ${workspacePath}`,
      });
      return { total: 0, passed: 0, failed: 0, skipped: 0, startupFailure: true, startupError: `workspacePath not found: ${workspacePath}` };
    }

    const reportFile = join(dataRoot, 'runs', `${runId}-pw-report.json`);
    mkdirSync(join(dataRoot, 'runs'), { recursive: true });

    const args = ['playwright', 'test', '--reporter=line,json'];

    if (selector?.tag) {
      args.push('--grep', `@${escapeRegex(selector.tag)}`);
    } else if (selector?.suite) {
      args.push('--grep', escapeRegex(selector.suite));
    } else if (selector?.testcaseId ?? selector?.scenarioId) {
      // Resolve testcaseId / scenarioId to concrete title(s) via --list so that
      // Playwright only executes the matching test(s), not the full suite.
      const resolved = await this.resolveIdToTitle(
        workspacePath,
        selector.testcaseId,
        selector.scenarioId,
      );
      if (resolved === null) {
        const msg = `No test found matching ${selector.testcaseId ? `testcaseId=${selector.testcaseId}` : `scenarioId=${String(selector.scenarioId)}`}`;
        this.appendEvent(runId, 'RUN_STEP_DEGRADED', 'run', runId, { reason: msg });
        return { total: 0, passed: 0, failed: 0, skipped: 0, startupFailure: true, startupError: msg };
      }
      const grepPattern = Array.isArray(resolved)
        ? `(${resolved.map(t => `^${escapeRegex(t)}$`).join('|')})`
        : `^${escapeRegex(resolved)}$`;
      args.push('--grep', grepPattern);
    }

    // Run Playwright non-blocking; capture stdout for JSON report
    // Parse line-reporter stderr for real-time progress: "[N/T] ✓ title" or "✗ title"
    const progressCounts = { total: 0, passed: 0, failed: 0, skipped: 0 };
    // Playwright line reporter: "  1 passed", "  2 failed", "[1/10]" etc.
    // More reliable: match "✓" / "✗" / "-" per-test lines
    const lineRe = /^\s*(\d+)\s+(?:passed|failed|skipped)/;
    log.info('spawning playwright', { runId, workspacePath, args: args.slice(2) });
    const t0 = Date.now();
    const rawOutput = await spawnAsync('npx', args, {
      cwd: workspacePath,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
      timeout: 10 * 60 * 1000,
      onProc: (proc) => { this.activeProcs.set(runId, proc); },
      onStderr: (line) => {
        if (!input.onProgress) return;
        // Match summary lines like "  3 passed (2s)" or "  1 failed"
        const m = lineRe.exec(line);
        if (m) {
          if (line.includes('passed')) progressCounts.passed = Number(m[1]);
          else if (line.includes('failed')) progressCounts.failed = Number(m[1]);
          else if (line.includes('skipped')) progressCounts.skipped = Number(m[1]);
          progressCounts.total = progressCounts.passed + progressCounts.failed + progressCounts.skipped;
          input.onProgress({ ...progressCounts });
        }
      },
    });
    this.activeProcs.delete(runId);

    if (rawOutput.startupError) {
      log.error('playwright startup error', { runId, error: rawOutput.startupError });
      this.appendEvent(runId, 'RUN_STEP_DEGRADED', 'run', runId, { reason: rawOutput.startupError });
      return { total: 0, passed: 0, failed: 0, skipped: 0, startupFailure: true, startupError: rawOutput.startupError };
    }

    // Parse JSON report (written to file by Playwright JSON reporter)
    let report: PWReport | null = null;
    if (existsSync(reportFile)) {
      try {
        report = JSON.parse(readFileSync(reportFile, 'utf8')) as PWReport;
      } catch { /* fallback to stdout */ }
    }
    if (!report && rawOutput.stdout) {
      try {
        report = JSON.parse(rawOutput.stdout) as PWReport;
      } catch { /* no parseable output */ }
    }

    if (!report) {
      const msg = `Playwright produced no parseable JSON report. stderr: ${rawOutput.stderr.slice(0, 500)}`;
      log.error('no parseable playwright report', { runId, stderr: rawOutput.stderr.slice(0, 300) });
      this.appendEvent(runId, 'RUN_STEP_DEGRADED', 'run', runId, { reason: msg });
      return { total: 0, passed: 0, failed: 0, skipped: 0, startupFailure: true, startupError: msg };
    }

    const allTests = flattenTests(report.suites);
    const tests = allTests;
    let passed = 0, failed = 0, skipped = 0;

    for (const t of tests) {
      const { testcaseId, scenarioId, lastResult } = t;
      const startedAt = lastResult?.startTime ?? new Date().toISOString();
      const completedAt = lastResult
        ? new Date(new Date(startedAt).getTime() + lastResult.duration).toISOString()
        : undefined;

      if (t.status === 'passed') passed++;
      else if (t.status === 'failed') failed++;
      else skipped++;

      // Copy artifacts into workbench storage layout
      const { relDir: artifactRelDir, absDir: artifactAbsDir } = resolveArtifactLayout(artifactRoot, runId, testcaseId);
      mkdirSync(artifactAbsDir, { recursive: true });

      let screenshotPath: string | undefined;
      let videoPath: string | undefined;
      let tracePath: string | undefined;
      let networkLogPath: string | undefined;

      for (const att of lastResult?.attachments ?? []) {
        if (!att.path || !existsSync(att.path)) continue;
        const dest = join(artifactAbsDir, basename(att.path));
        try { copyFileSync(att.path, dest); } catch { continue; }
        const relDest = join(artifactRelDir, basename(att.path));

        if (att.name === 'screenshot' || att.contentType.startsWith('image/')) {
          screenshotPath = relDest;
        } else if (att.name === 'video' || att.contentType.startsWith('video/')) {
          videoPath = relDest;
        } else if (att.name === 'trace') {
          tracePath = relDest;
        } else if (att.name === 'network' || att.path.endsWith('.har')) {
          // Network log / HAR — first-class artifact, persisted explicitly
          networkLogPath = relDest;
        }

        this.appendEvent(runId, 'ARTIFACT_SAVED', 'testcase', testcaseId, { path: relDest });
      }

      // Persist test result with all artifact paths including networkLogPath
      const now = new Date().toISOString();
      // Warn when zarb-testcase-id annotation is absent — testcaseId falls back
      // to title hash, which is stable but will change if the title is renamed.
      if (t.missingAnnotation) {
        this.appendEvent(runId, 'RUN_STEP_DEGRADED', 'testcase', testcaseId, {
          reason: `zarb-testcase-id annotation missing for "${t.fullTitle}"; using title hash as testcaseId`,
        });
      }
      const upsertInput: UpsertTestResultInput = {
        id: randomUUID(),
        runId,
        testcaseId,
        status: t.status,
        startedAt,
        createdAt: now,
      };
      if (scenarioId) upsertInput.scenarioId = scenarioId;
      if (t.status === 'failed') upsertInput.errorType = 'TestFailure';
      if (lastResult?.error?.message) upsertInput.errorMessage = lastResult.error.message;
      else if (lastResult?.error?.value) upsertInput.errorMessage = lastResult.error.value;
      if (lastResult?.duration !== undefined) upsertInput.durationMs = lastResult.duration;
      if (screenshotPath) upsertInput.screenshotPath = screenshotPath;
      if (videoPath) upsertInput.videoPath = videoPath;
      if (tracePath) upsertInput.tracePath = tracePath;
      if (networkLogPath) upsertInput.networkLogPath = networkLogPath;
      if (completedAt) upsertInput.completedAt = completedAt;
      this.results.upsert(upsertInput);

      // Emit per-testcase event — skipped tests do NOT emit TESTCASE_FAILED
      if (t.status === 'passed') {
        this.appendEvent(runId, 'TESTCASE_PASSED', 'testcase', testcaseId, { durationMs: lastResult?.duration });
      } else if (t.status === 'failed') {
        this.appendEvent(runId, 'TESTCASE_FAILED', 'testcase', testcaseId, { durationMs: lastResult?.duration });
      }
      // skipped: no event emitted (no dedicated skipped event type in Phase 11)

      // Extract correlation context from HAR network log
      if (networkLogPath) {
        const harAbsPath = join(dirname(artifactRoot), networkLogPath);
        const ctx = extractCorrelationContext(harAbsPath, input.correlationHeaders ?? DEFAULT_CORRELATION_HEADERS);
        if (ctx.traceIds.length > 0 || ctx.requestIds.length > 0) {
          const ctxRelPath = correlationContextPath(runId, testcaseId);
          const ctxAbsPath = join(dataRoot, ctxRelPath);
          mkdirSync(dirname(ctxAbsPath), { recursive: true });
          writeFileSync(ctxAbsPath, JSON.stringify(ctx, null, 2));

          const saveInput: SaveCorrelationContextInput = {
            id: randomUUID(),
            runId,
            testcaseId,
            traceIdsJson: JSON.stringify(ctx.traceIds),
            requestIdsJson: JSON.stringify(ctx.requestIds),
            sessionIdsJson: JSON.stringify(ctx.sessionIds),
            createdAt: now,
          };
          if (ctx.fromTime) saveInput.fromTime = ctx.fromTime;
          if (ctx.toTime) saveInput.toTime = ctx.toTime;
          this.correlations.save(saveInput);
          this.appendEvent(runId, 'CORRELATION_CONTEXT_CAPTURED', 'testcase', testcaseId, {
            traceCount: ctx.traceIds.length,
          });
        }
      }
    }

    const total = passed + failed + skipped;
    this.runs.update(runId, { total, passed, failed, skipped, updatedAt: new Date().toISOString() });
    log.info('playwright run finished', { runId, total, passed, failed, skipped, durationMs: Date.now() - t0 });

    return { total, passed, failed, skipped, startupFailure: false };
  }

  private appendEvent(
    runId: string,
    eventType: SaveRunEventInput['eventType'],
    entityType: string,
    entityId: string,
    payload?: Record<string, unknown>,
  ): void {
    const input: SaveRunEventInput = {
      id: randomUUID(),
      runId,
      eventType,
      entityType,
      entityId,
      createdAt: new Date().toISOString(),
    };
    if (payload) input.payloadJson = JSON.stringify(payload);
    this.events.save(input);
  }

  /**
   * resolveIdToTitle — use `playwright test --list --reporter=json` to find
   * the full test title(s) that correspond to a given testcaseId or scenarioId.
   *
   * - testcaseId: returns a single title string (unique asset ID)
   * - scenarioId: returns all matching titles (a scenario maps to multiple testcases)
   *
   * Returns null if nothing matches or the list call fails.
   */
  private async resolveIdToTitle(
    workspacePath: string,
    testcaseId?: string,
    scenarioId?: string,
  ): Promise<string | string[] | null> {
    const listOutput = await spawnAsync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
      cwd: workspacePath,
      env: { ...process.env },
      timeout: 30_000,
    });
    if (listOutput.startupError) return null;

    let report: PWReport;
    try { report = JSON.parse(listOutput.stdout) as PWReport; } catch { return null; }

    const candidates = flattenTests(report.suites);
    if (testcaseId) {
      return candidates.find(t => t.testcaseId === testcaseId)?.fullTitle ?? null;
    }
    if (scenarioId) {
      const titles = candidates.filter(t => t.scenarioId === scenarioId).map(t => t.fullTitle);
      return titles.length > 0 ? titles : null;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Non-blocking spawn helper
// ---------------------------------------------------------------------------

interface SpawnResult {
  stdout: string;
  stderr: string;
  startupError?: string;
}

function spawnAsync(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    onProc?: (proc: ReturnType<typeof spawn>) => void;
    onStderr?: (line: string) => void;
  },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ stdout: '', stderr: '', startupError: String(err) });
      return;
    }

    opts.onProc?.(proc);

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout, stderr, startupError: 'Playwright process timed out' });
    }, opts.timeout);

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      if (opts.onStderr) {
        for (const line of s.split('\n')) { if (line) opts.onStderr(line); }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, startupError: err.message });
    });

    proc.on('close', () => {
      clearTimeout(timer);
      // Non-zero exit is a testcase-level failure, not a startup failure
      resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Tree traversal helpers
// ---------------------------------------------------------------------------

const DEFAULT_CORRELATION_HEADERS = ['x-trace-id', 'x-b3-traceid', 'x-request-id'];

/**
 * Flatten the Playwright suite tree into a list of FlatTest records.
 *
 * Identity contract (Phase 11):
 * - `testcaseId` is always derived from `titleHash(fullTitle)` so that
 *   selector (`--grep <title>`) and persisted identity use the same source.
 * - `scenarioId` is read from the `zarb-scenario-id` annotation when present.
 * - `zarb-testcase-id` annotation is accepted as an explicit override for
 *   `testcaseId` when present; its absence is recorded as a degraded event
 *   rather than silently falling back, so callers can surface the gap.
 *
 * This keeps selection and persistence aligned: both are title-based by
 * default, and annotation overrides are opt-in.
 */
function flattenTests(suites: PWSpec[], prefix = ''): FlatTest[] {
  const out: FlatTest[] = [];
  for (const suite of suites) {
    const suiteName = prefix ? `${prefix} > ${suite.title}` : suite.title;
    for (const test of suite.tests ?? []) {
      const fullTitle = `${suiteName} > ${test.title}`;
      const lastResult = test.results?.[test.results.length - 1];

      // testcaseId: annotation override if present, otherwise title hash
      // Both are stable across runs as long as the title does not change.
      const annotationId = findAnnotation(test.annotations ?? [], 'zarb-testcase-id');
      const testcaseId = annotationId ?? titleHash(fullTitle);

      // scenarioId: annotation only — no fallback
      const annotationScenarioId = findAnnotation(test.annotations ?? [], 'zarb-scenario-id');

      const flat: FlatTest = {
        fullTitle,
        status: normalizeStatus(test.status),
        testcaseId,
        missingAnnotation: !annotationId,
      };
      if (annotationScenarioId) flat.scenarioId = annotationScenarioId;
      if (lastResult) flat.lastResult = lastResult;
      out.push(flat);
    }
    if (suite.suites) out.push(...flattenTests(suite.suites, suiteName));
  }
  return out;
}

function findAnnotation(annotations: PWAnnotation[], type: string): string | undefined {
  return annotations.find(a => a.type === type)?.description;
}

/**
 * Deterministic, filesystem-safe ID derived from the full test title.
 * Uses first 16 hex chars of SHA-256 for stability across runs.
 */
function titleHash(title: string): string {
  return createHash('sha256').update(title).digest('hex').slice(0, 16);
}

function normalizeStatus(s: string): 'passed' | 'failed' | 'skipped' {
  if (s === 'passed') return 'passed';
  if (s === 'skipped' || s === 'pending') return 'skipped';
  return 'failed';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Correlation context extraction from HAR
// ---------------------------------------------------------------------------

interface CorrelationCtx {
  traceIds: string[];
  requestIds: string[];
  sessionIds: string[];
  fromTime?: string;
  toTime?: string;
}

function extractCorrelationContext(harPath: string, headers: string[]): CorrelationCtx {
  const ctx: CorrelationCtx = { traceIds: [], requestIds: [], sessionIds: [] };
  try {
    const har = JSON.parse(readFileSync(harPath, 'utf8')) as {
      log?: {
        entries?: Array<{
          response?: { headers?: Array<{ name: string; value: string }> };
          startedDateTime?: string;
        }>;
      };
    };
    const entries = har.log?.entries ?? [];
    const lowerHeaders = headers.map(h => h.toLowerCase());
    const times: string[] = [];

    for (const entry of entries) {
      if (entry.startedDateTime) times.push(entry.startedDateTime);
      for (const h of entry.response?.headers ?? []) {
        const name = h.name.toLowerCase();
        const idx = lowerHeaders.indexOf(name);
        if (idx === -1) continue;
        const headerName = (lowerHeaders[idx] ?? '');
        if (headerName.includes('trace')) {
          if (!ctx.traceIds.includes(h.value)) ctx.traceIds.push(h.value);
        } else if (headerName.includes('request')) {
          if (!ctx.requestIds.includes(h.value)) ctx.requestIds.push(h.value);
        } else if (headerName.includes('session')) {
          if (!ctx.sessionIds.includes(h.value)) ctx.sessionIds.push(h.value);
        }
      }
    }

    if (times.length > 0) {
      const first = times[0];
      const last = times[times.length - 1];
      if (first) ctx.fromTime = first;
      if (last) ctx.toTime = last;
    }
  } catch { /* non-fatal */ }
  return ctx;
}
