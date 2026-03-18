import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { FindingRepository, SiteCredentialRepository } from '@zarb/storage';
import { HarnessSessionManager } from './session-manager.js';
import { ToolRegistry } from './tool-registry.js';
import { StepLogger, appLogger } from '@zarb/logger';
import type { PlaywrightToolProvider } from './playwright-tool-provider.js';

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
            try {
              await this.playwrightProvider.applyCredential(cred, baseUrl);
            } catch (credErr) {
              log.warn('applyCredential failed, continuing without auth', { error: String(credErr) });
              console.warn('[ExplorationAgent] applyCredential failed, continuing without auth:', credErr);
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

    // Create Harness session for audit trail
    const session = this.sessionManager.startSession({
      runId,
      kind: 'exploration',
      agentName: 'ExplorationAgent',
      policy: { sessionBudgetMs: (config.maxSteps ?? 20) * 30_000, toolCallTimeoutMs: 30_000, allowedHosts, allowedWriteScopes: [], requireApprovalFor: [], reviewOnVerifyFailureAllowed: false },
      dataRoot,
    });

    const stepLogger = new StepLogger(join(dataRoot, 'runs', runId, 'steps.ndjson'), onStep);
    stepLogger.log({ component: 'ExplorationAgent', action: 'explore.start', detail: `urls=${config.startUrls.join(',')}, maxSteps=${String(config.maxSteps)}`, status: 'ok' });
    log.info('exploration started', { runId, startUrls: config.startUrls, maxSteps: config.maxSteps, maxPages: config.maxPages });

    const maxSteps = config.maxSteps ?? 20;
    const maxPages = config.maxPages ?? 10;
    const visitedUrls = new Set<string>();
    const pendingUrls: string[] = [...config.startUrls];
    let stepIndex = 0;
    let noNewFindingsStreak = 0;
    let totalFindings = 0;
    let llmError: string | undefined;

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
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(raw);
    return match ? JSON.parse(match[0]) as T : fallback;
  } catch {
    return fallback;
  }
}
