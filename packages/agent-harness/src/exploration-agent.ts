import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { FindingRepository, SiteCredentialRepository } from '@zarb/storage';
import { HarnessSessionManager } from './session-manager.js';
import { ToolRegistry } from './tool-registry.js';
import { StepLogger, appLogger } from '@zarb/logger';
import type { PlaywrightToolProvider } from './playwright-tool-provider.js';
import { LoginFailedError, isLoginUrl } from './playwright-tool-provider.js';

const log = appLogger.child('ExplorationAgent');

export interface AIProvider {
  complete(prompt: string): Promise<string>;
  isConfigured(): boolean;
  readonly model?: string;
}

export interface PageProbe {
  url: string;
  title: string;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  formCount: number;
  linkCount: number;
  screenshot?: string;
}

export interface ExplorationStep {
  stepIndex: number;
  action: 'navigate' | 'click' | 'fill' | 'done';
  targetUrl?: string | undefined;
  selector?: string | undefined;
  value?: string | undefined;
  reasoning: string;
  llmError?: string;
}

export interface ExplorationResult {
  findingCount: number;
  stepsExecuted: number;
  pagesVisited: number;
  /** Set when exploration stopped early due to LLM failure */
  llmError?: string;
}

/**
 * ExplorationAgent — drives AI-guided site exploration.
 *
 * Design: agent-harness-design.md §6.1
 * - LLM decides next action (navigate/click/fill/done)
 * - Playwright probe collects page state after each action
 * - Findings are persisted to DB
 * - Hard budget: maxSteps / maxPages
 * - Soft stop: no new findings for 3 consecutive steps
 */
export class ExplorationAgent {
  private readonly findings: FindingRepository;
  private readonly sessionManager: HarnessSessionManager;
  private readonly credentials: SiteCredentialRepository;

  constructor(
    private readonly db: Db,
    private readonly provider: AIProvider,
    private readonly playwrightProvider?: PlaywrightToolProvider,
  ) {
    this.findings = new FindingRepository(db);
    this.sessionManager = new HarnessSessionManager(db);
    this.credentials = new SiteCredentialRepository(db);
  }

  async explore(
    runId: string,
    config: ExplorationConfig,
    probe: (url: string) => Promise<PageProbe>,
    dataRoot = '',
    onStep?: () => void,
  ): Promise<ExplorationResult> {
    // Build ToolRegistry with policy from config
    const allowedHosts = config.allowedHosts ?? [];
    const registry = new ToolRegistry({
      requireApprovalFor: [],
      toolCallTimeoutMs: 30_000,
      allowedHosts,
      allowedWriteScopes: [],
    });

    // Create Harness session for audit trail
    const session = this.sessionManager.startSession({
      runId,
      kind: 'exploration',
      agentName: 'ExplorationAgent',
      policy: { sessionBudgetMs: (config.maxSteps ?? 20) * 30_000, toolCallTimeoutMs: 30_000, allowedHosts, allowedWriteScopes: [], requireApprovalFor: [], reviewOnVerifyFailureAllowed: false },
      dataRoot,
    });

    const stepLogger = new StepLogger(join(dataRoot, 'runs', runId, 'steps.ndjson'), onStep);
    stepLogger.log({ component: 'ExplorationAgent', action: 'explore.start', status: 'ok', detail: `urls=${config.startUrls.join(',')}, maxSteps=${String(config.maxSteps)}`, toolInput: { startUrls: config.startUrls, maxSteps: config.maxSteps, maxPages: config.maxPages } });
    log.info('exploration started', { runId, startUrls: config.startUrls, maxSteps: config.maxSteps, maxPages: config.maxPages });

    // If PlaywrightToolProvider is available, launch it and use its probe
    let activePwProvider: PlaywrightToolProvider | null = null;
    let effectiveProbe = probe;
    if (this.playwrightProvider) {
      try {
        await this.playwrightProvider.launch();
        // Apply credential if specified
        if (config.credentialId) {
          const cred = this.credentials.findById(config.credentialId);
          if (cred) {
            const baseUrl = config.startUrls[0] ?? '';
            const strategy = config.loginStrategy ?? 'ai';
            if (strategy === 'ai') {
              const loginErr = await this.runAiLogin(baseUrl, cred, stepLogger);
              if (loginErr) {
                log.warn('AI login failed', { runId, reason: loginErr });
                stepLogger.log({ component: 'ExplorationAgent', action: 'explore.done', status: 'error', detail: loginErr });
                return { findingCount: 0, stepsExecuted: 0, pagesVisited: 0, llmError: loginErr };
              }
            } else {
              const t0 = Date.now();
              const loginActionId = `login-static-${String(t0)}`;
              const staticInput = { strategy: 'static', url: baseUrl, authType: cred.auth_type };
              stepLogger.log({ component: 'ExplorationAgent', action: 'login.start', status: 'pending', detail: `strategy=static url=${baseUrl}`, toolInput: staticInput, actionId: loginActionId, tool: 'playwright' });
              try {
                await this.playwrightProvider.applyCredential(cred, baseUrl);
                stepLogger.log({ component: 'ExplorationAgent', action: 'login.verify', status: 'ok', detail: 'static credential applied', durationMs: Date.now() - t0, toolInput: staticInput, toolOutput: { authType: cred.auth_type }, actionId: loginActionId, tool: 'playwright' });
              } catch (credErr) {
                const isLoginFailed = credErr instanceof LoginFailedError;
                log.warn('applyCredential failed', { error: String(credErr), loginFailed: isLoginFailed });
                if (isLoginFailed) {
                  stepLogger.log({ component: 'ExplorationAgent', action: 'login.failed', status: 'error', detail: `static credential rejected`, durationMs: Date.now() - t0, toolInput: staticInput, toolOutput: { error: String(credErr) }, actionId: loginActionId, tool: 'playwright' });
                  stepLogger.log({ component: 'ExplorationAgent', action: 'explore.done', status: 'error', detail: 'LOGIN_FAILED' });
                  return { findingCount: 0, stepsExecuted: 0, pagesVisited: 0, llmError: 'LOGIN_FAILED' };
                }
                // Other errors (network etc.) — continue without auth
              }
            }
          }
        }
        this.playwrightProvider.registerTools(registry);
        effectiveProbe = this.playwrightProvider.buildProbe();
        activePwProvider = this.playwrightProvider;
      } catch (e) {
        // Playwright unavailable (e.g. no browser installed) — fall back to probe callback
        log.warn('Playwright launch failed, falling back to fetch', { error: String(e) });
        console.warn('[ExplorationAgent] Playwright launch failed, falling back to fetch:', e);
      }
    }

    const maxSteps = config.maxSteps ?? 20;
    const maxPages = config.maxPages ?? 10;
    const visitedUrls = new Set<string>();
    const pendingUrls: string[] = [...config.startUrls];
    let stepIndex = 0;
    let noNewFindingsStreak = 0;
    let totalFindings = 0;
    let llmError: string | undefined;
    // Auth retry state: sliding window of 30 min, max 3 retries
    const authRetryTimestamps: number[] = [];
    const AUTH_RETRY_WINDOW_MS = 30 * 60 * 1000;
    const AUTH_RETRY_MAX = 3;

    try {
      while (stepIndex < maxSteps && visitedUrls.size < maxPages && pendingUrls.length > 0) {
        const url = pendingUrls.shift()!;
        if (visitedUrls.has(url)) continue;
        visitedUrls.add(url);

        // Navigate via ToolRegistry (enforces allowedHosts) or fall back to probe
        let pageState: PageProbe;
        const navStart = Date.now();
        if (activePwProvider) {
          const result = await registry.call<PageProbe>('playwright.navigate', { url }, { sessionId: session.session_id, stepIndex });
          if (!result.ok) {
            stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', detail: url, status: 'error', durationMs: Date.now() - navStart, toolInput: { url }, tool: 'playwright' });
            continue;
          }
          pageState = result.value!;
        } else {
          try { pageState = await effectiveProbe(url); } catch {
            stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', detail: url, status: 'error', durationMs: Date.now() - navStart, toolInput: { url }, tool: 'fetch' });
            continue;
          }
        }
        const navDuration = Date.now() - navStart;
        const pageSnapshot = { url: pageState.url, title: pageState.title, formCount: pageState.formCount, linkCount: pageState.linkCount, consoleErrors: pageState.consoleErrors.length, networkErrors: pageState.networkErrors.length };
        stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', detail: url, status: 'ok', durationMs: navDuration, toolInput: { url }, toolOutput: pageState, pageState: pageSnapshot, tool: activePwProvider ? 'playwright' : 'fetch' });

        // Persist findings from this page
        const newFindings = this.extractFindings(runId, pageState, config);
        for (const f of newFindings) { this.findings.save(f); totalFindings++; }
        if (newFindings.length > 0) {
          stepLogger.log({
            component: 'ExplorationAgent', action: 'findings', status: 'ok',
            detail: `${String(newFindings.length)} findings on ${url}`,
            toolOutput: newFindings.map(f => ({ category: f.category, severity: f.severity, title: f.title, summary: f.summary })),
          });
        }

        noNewFindingsStreak = newFindings.length === 0 ? noNewFindingsStreak + 1 : 0;
        if (noNewFindingsStreak >= 3) break;

        // Auth expiry detection: 401/403 in network errors or redirect to login page
        const hasAuthError = pageState.networkErrors.some(e => e.status === 401 || e.status === 403);
        const isOnLoginPage = isLoginUrl(pageState.url);
        if ((hasAuthError || isOnLoginPage) && config.credentialId && activePwProvider) {
          const now = Date.now();
          // Evict timestamps outside the sliding window
          while (authRetryTimestamps.length > 0 && now - authRetryTimestamps[0]! > AUTH_RETRY_WINDOW_MS) {
            authRetryTimestamps.shift();
          }
          authRetryTimestamps.push(now);
          if (authRetryTimestamps.length > AUTH_RETRY_MAX) {
            stepLogger.log({ component: 'ExplorationAgent', action: 'login.retry', status: 'error', detail: 'AUTH_RETRY_EXCEEDED', toolInput: { url: pageState.url, hasAuthError, isOnLoginPage }, toolOutput: { retryCount: authRetryTimestamps.length, maxRetries: AUTH_RETRY_MAX } });
            log.warn('auth retry exceeded', { runId });
            llmError = 'AUTH_RETRY_EXCEEDED';
            break;
          }
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.retry', status: 'warn', detail: `retry ${String(authRetryTimestamps.length)} of ${String(AUTH_RETRY_MAX)}`, toolInput: { url: pageState.url, hasAuthError, isOnLoginPage }, toolOutput: { retryCount: authRetryTimestamps.length } });
          const cred = this.credentials.findById(config.credentialId);
          if (cred) {
            const strategy = config.loginStrategy ?? 'ai';
            if (strategy === 'ai') {
              const loginErr = await this.runAiLogin(pageState.url, cred, stepLogger);
              if (loginErr) { llmError = loginErr; break; }
            } else {
              try {
                await activePwProvider.applyCredential(cred, config.startUrls[0] ?? '');
              } catch { /* continue */ }
            }
          }
        }

        // Ask LLM for next action
        const llmStart = Date.now();
        const llmActionId = `llm-${String(llmStart)}`;
        stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'pending', detail: `deciding next step from ${url}`, toolInput: { currentUrl: url, formCount: pageState.formCount, linkCount: pageState.linkCount }, actionId: llmActionId });
        const nextStep = await this.decideNextStep(pageState, config, stepIndex, [...visitedUrls], stepLogger, llmActionId);
        if (nextStep.llmError) {
          llmError = nextStep.llmError;
          log.warn('LLM error during exploration, stopping early', { runId, llmError });
          break;
        }
        if (nextStep.action !== 'done') {
          stepLogger.log({
            component: 'ExplorationAgent', action: 'llm.decide', status: 'ok', durationMs: Date.now() - llmStart,
            detail: `action=${nextStep.action}${nextStep.targetUrl ? ` url=${nextStep.targetUrl}` : ''}`,
            toolInput: { currentUrl: url, formCount: pageState.formCount, linkCount: pageState.linkCount },
            toolOutput: { action: nextStep.action, targetUrl: nextStep.targetUrl },
            reason: nextStep.reasoning,
            actionId: llmActionId,
            ...(this.provider.model ? { model: this.provider.model } : {}),
          });
        }
        if (nextStep.action === 'done') break;
        if (nextStep.action === 'navigate' && nextStep.targetUrl) {
          if (!visitedUrls.has(nextStep.targetUrl)) pendingUrls.unshift(nextStep.targetUrl);
        }

        this.sessionManager.appendStep(session.session_id, {
          stepIndex,
          description: `navigate: ${url}`,
          outcome: `findings: ${String(newFindings.length)}, errors: ${String(pageState.consoleErrors.length + pageState.networkErrors.length)}`,
          timestamp: new Date().toISOString(),
        }, dataRoot);

        onStep?.();
        stepIndex++;
      }
    } finally {
      if (activePwProvider) {
        if (dataRoot) {
          activePwProvider.flushNetworkLog(join(dataRoot, 'runs', runId, 'network.jsonl'));
        }
        await activePwProvider.close().catch(() => undefined);
      }
    }

    stepLogger.log({ component: 'ExplorationAgent', action: 'explore.done', detail: `steps=${String(stepIndex)}, pages=${String(visitedUrls.size)}, findings=${String(totalFindings)}`, status: 'ok' });
    log.info('exploration done', { runId, stepsExecuted: stepIndex, pagesVisited: visitedUrls.size, findingCount: totalFindings, llmError });
    this.sessionManager.completeSession(session.session_id);
    return { findingCount: totalFindings, stepsExecuted: stepIndex, pagesVisited: visitedUrls.size, ...(llmError ? { llmError } : {}) };
  }

  private extractFindings(
    runId: string,
    page: PageProbe,
    config: ExplorationConfig,
  ): import('@zarb/storage').SaveFindingInput[] {
    const results: import('@zarb/storage').SaveFindingInput[] = [];
    const now = new Date().toISOString();
    const focusAreas = config.focusAreas ?? ['console-errors', 'network-errors'];

    if (focusAreas.includes('console-errors')) {
      for (const err of page.consoleErrors.slice(0, 5)) {
        results.push({
          id: randomUUID(), runId, category: 'console-error', severity: 'medium',
          pageUrl: page.url, title: 'Console error', summary: err, createdAt: now,
        });
      }
    }

    if (focusAreas.includes('network-errors')) {
      for (const req of page.networkErrors.slice(0, 5)) {
        const severity = req.status >= 500 ? 'high' : 'medium';
        results.push({
          id: randomUUID(), runId, category: 'network-error', severity,
          pageUrl: page.url, title: `HTTP ${String(req.status)}`,
          summary: `${req.url} returned ${String(req.status)}`, createdAt: now,
        });
      }
    }

    return results;
  }

  private async decideNextStep(
    page: PageProbe,
    config: ExplorationConfig,
    stepIndex: number,
    visited: string[],
    stepLogger: StepLogger,
    actionId?: string,
  ): Promise<ExplorationStep> {
    const focusAreas = config.focusAreas ?? [];
    const prompt = [
      'You are an AI site exploration agent. Decide the next action to take.',
      `Current page: ${page.url} (title: "${page.title}")`,
      `Console errors: ${page.consoleErrors.length}, Network errors: ${page.networkErrors.length}`,
      `Forms: ${page.formCount}, Links: ${page.linkCount}`,
      `Focus areas: ${focusAreas.join(', ') || 'general'}`,
      `Already visited: ${visited.slice(-5).join(', ')}`,
      `Step: ${String(stepIndex)}`,
      '',
      'Respond with JSON only: {"action":"navigate"|"done","targetUrl":"...","reasoning":"..."}',
      'Choose "done" if the page has been thoroughly explored or there is nothing new to find.',
    ].join('\n');

    let raw = '';
    const toolInput = { currentUrl: page.url, formCount: page.formCount, linkCount: page.linkCount };
    try {
      raw = await this.provider.complete(prompt);
    } catch (e) {
      stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'error', detail: `LLM call threw: ${String(e)}`, reason: 'LLM unavailable', toolInput, toolOutput: { error: String(e) }, ...(actionId ? { actionId } : {}) });
      return { stepIndex, action: 'done', reasoning: 'LLM unavailable', llmError: 'LLM_CALL_FAILED' };
    }

    if (!raw || raw.trim() === '') {
      stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'error', detail: 'LLM returned empty response', reason: 'empty response', toolInput, toolOutput: { status: 'empty' }, ...(actionId ? { actionId } : {}) });
      return { stepIndex, action: 'done', reasoning: 'LLM returned empty response', llmError: 'LLM_EMPTY_RESPONSE' };
    }

    const parsed = parseJson<{ action?: string; targetUrl?: string; reasoning?: string }>(raw, {});

    // navigate without a targetUrl is meaningless — treat as done
    if (parsed.action !== 'done' && !parsed.targetUrl) {
      stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'warn', detail: 'LLM returned navigate without targetUrl — treating as done', toolInput, toolOutput: parsed, ...(actionId ? { actionId } : {}) });
      return { stepIndex, action: 'done', reasoning: parsed.reasoning ?? 'no targetUrl in LLM response' };
    }

    return {
      stepIndex,
      action: (parsed.action === 'done' ? 'done' : 'navigate') as ExplorationStep['action'],
      targetUrl: parsed.targetUrl,
      reasoning: parsed.reasoning ?? '',
    };
  }

  /**
   * AI-driven interactive login.
   * Navigates to startUrl, collects DOM snapshot, asks LLM to fill credentials step by step.
   * Returns an error code string on failure, or undefined on success.
   */
  private async runAiLogin(
    startUrl: string,
    cred: import('@zarb/storage').SiteCredentialRow,
    stepLogger: StepLogger,
  ): Promise<string | undefined> {
    const pw = this.playwrightProvider;
    if (!pw) return 'LOGIN_AI_FAILED';

    const MAX_LOGIN_STEPS = 10;
    const loginUrl = cred.login_url ?? startUrl;
    const t0 = Date.now();
    const loginActionId = `login-ai-${String(t0)}`;
    const aiInput = { strategy: 'ai', url: loginUrl };

    stepLogger.log({ component: 'ExplorationAgent', action: 'login.start', status: 'pending', detail: `strategy=ai url=${loginUrl}`, toolInput: aiInput, actionId: loginActionId, tool: 'playwright' });

    try {
      const page = pw.getPage();
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      stepLogger.log({ component: 'ExplorationAgent', action: 'login.start', status: 'error', detail: String(e), durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { error: String(e) }, actionId: loginActionId, tool: 'playwright' });
      return 'LOGIN_AI_FAILED';
    }

    for (let i = 0; i < MAX_LOGIN_STEPS; i++) {
      const snapshot = await pw.collectDomSnapshot();
      const hasPasswordInput = snapshot.inputs.some(inp => inp.type === 'password');

      if (!hasPasswordInput && i > 0) {
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.verify', status: 'ok', detail: 'no password input, login assumed successful', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { url: snapshot.url, title: snapshot.title }, actionId: loginActionId, tool: 'playwright' });
        return undefined;
      }

      const prompt = [
        'You are an AI login agent. Analyze the page DOM and decide the next action.',
        '',
        `Page: ${snapshot.url} (title: "${snapshot.title}")`,
        `Inputs: ${JSON.stringify(snapshot.inputs.map(({ type, name, placeholder, label, selector }) => ({ type, name, placeholder, label, selector })))}`,
        `Buttons: ${JSON.stringify(snapshot.buttons.map(({ text, type, selector }) => ({ text, type, selector })))}`,
        '',
        `Credentials: username="${cred.username ?? ''}", password=[AVAILABLE]`,
        '',
        'Respond with JSON only:',
        '{"isLoginPage":true|false,"action":"fill"|"click"|"done","selector":"...","value":"...","reasoning":"..."}',
        'For fill with password, set value to "__PASSWORD__" and the system will substitute it.',
        'Set action="done" if login appears complete.',
      ].join('\n');

      let raw = '';
      try {
        raw = await this.provider.complete(prompt);
      } catch (e) {
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.failed', status: 'error', detail: `LLM call failed: ${String(e)}`, durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { error: String(e) }, actionId: loginActionId, tool: 'playwright' });
        return 'LOGIN_AI_FAILED';
      }

      const decision = parseJson<{ isLoginPage?: boolean; action?: string; selector?: string; value?: string; reasoning?: string }>(raw, {});

      if (!decision.isLoginPage || decision.action === 'done') {
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.verify', status: 'ok', detail: decision.reasoning ?? 'LLM says done', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { url: snapshot.url, reasoning: decision.reasoning }, actionId: loginActionId, tool: 'playwright' });
        return undefined;
      }

      if (decision.action === 'fill' && decision.selector) {
        const isPassword = decision.value === '__PASSWORD__';
        const actualValue = isPassword ? (cred.password ?? '') : (decision.value ?? '');
        const logValue = isPassword ? '[REDACTED]' : (decision.value ?? '');
        const fillStart = Date.now();
        try {
          const page = pw.getPage();
          await page.fill(decision.selector, actualValue, { timeout: 10_000 });
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.fill', status: 'ok', detail: `selector=${decision.selector} value=${logValue}`, durationMs: Date.now() - fillStart, toolInput: { selector: decision.selector, value: logValue }, toolOutput: { ok: true }, tool: 'playwright', ...(decision.reasoning ? { reason: decision.reasoning } : {}) });
        } catch (e) {
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.fill', status: 'error', detail: String(e), durationMs: Date.now() - fillStart, toolInput: { selector: decision.selector, value: logValue }, toolOutput: { error: String(e) }, tool: 'playwright' });
          return 'LOGIN_AI_FAILED';
        }
      } else if (decision.action === 'click' && decision.selector) {
        const clickStart = Date.now();
        try {
          const page = pw.getPage();
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined),
            page.click(decision.selector, { timeout: 10_000 }),
          ]);
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.click', status: 'ok', detail: `selector=${decision.selector}`, durationMs: Date.now() - clickStart, toolInput: { selector: decision.selector }, toolOutput: { ok: true }, tool: 'playwright', ...(decision.reasoning ? { reason: decision.reasoning } : {}) });
        } catch (e) {
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.click', status: 'error', detail: String(e), durationMs: Date.now() - clickStart, toolInput: { selector: decision.selector }, toolOutput: { error: String(e) }, tool: 'playwright' });
          return 'LOGIN_AI_FAILED';
        }
      }
    }

    stepLogger.log({ component: 'ExplorationAgent', action: 'login.failed', status: 'error', detail: 'exceeded max login steps', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { maxSteps: MAX_LOGIN_STEPS }, actionId: loginActionId, tool: 'playwright' });
    return 'LOGIN_AI_STEP_EXCEEDED';
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(raw);
    return match ? JSON.parse(match[0]) as T : fallback;
  } catch {
    return fallback;
  }
}
