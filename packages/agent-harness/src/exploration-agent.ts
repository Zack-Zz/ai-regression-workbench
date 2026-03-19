import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { FindingRepository, SiteCredentialRepository } from '@zarb/storage';
import { HarnessSessionManager } from './session-manager.js';
import { ToolRegistry } from './tool-registry.js';
import { StepLogger, appLogger } from '@zarb/logger';
import type { DomSnapshot, PlaywrightToolProvider } from './playwright-tool-provider.js';
import { LoginFailedError, isLoginUrl } from './playwright-tool-provider.js';
import { HARNESS_TEMPLATE_VERSIONS, renderHarnessTemplate } from './prompt-loader.js';

const log = appLogger.child('ExplorationAgent');

export interface AIProvider {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  isConfigured(): boolean;
  readonly model?: string;
}

interface AICompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    };
  }>;
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  retry?: {
    maxAttempts?: number;
    retryOnEmpty?: boolean;
  };
  scene?: 'explorationDecision' | 'explorationLogin';
}

const EXPLORATION_DECIDE_SYSTEM_PROMPT = 'You are an exploration decision agent. Return only structured JSON for the next action.';
const LOGIN_DECIDE_SYSTEM_PROMPT = 'You are a login decision agent. Return only structured JSON for the next login action.';

const EXPLORATION_DECIDE_TOOL: NonNullable<AICompletionOptions['tools']>[number] = {
  type: 'function',
  function: {
    name: 'decide_exploration_action',
    description: 'Choose the next exploration action.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'fill', 'navigate', 'done'] },
        selector: { type: 'string' },
        value: { type: 'string' },
        targetUrl: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['action', 'reasoning'],
      additionalProperties: false,
    },
    strict: true,
  },
};

const LOGIN_DECIDE_TOOL: NonNullable<AICompletionOptions['tools']>[number] = {
  type: 'function',
  function: {
    name: 'decide_login_action',
    description: 'Choose the next login action.',
    parameters: {
      type: 'object',
      properties: {
        isLoginPage: { type: 'boolean' },
        action: { type: 'string', enum: ['fill', 'click', 'done'] },
        selector: { type: 'string' },
        value: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['isLoginPage', 'action', 'reasoning'],
      additionalProperties: false,
    },
    strict: true,
  },
};

export interface PageProbe {
  url: string;
  title: string;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  formCount: number;
  linkCount: number;
  domSummary?: {
    headings: string[];
    primaryButtons: string[];
    navLinks: string[];
    inputHints: string[];
    ctaCandidates?: string[];
    textSnippet?: string;
  };
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

export interface ExplorationPromptContext {
  page: PageProbe;
  config: ExplorationConfig;
  stepIndex: number;
  visited: string[];
  recentSteps: string[];
  recentFindings: string[];
  recentToolResults: string[];
  recentNetworkHighlights: string[];
  supportedActions: string;
  remainingSteps: number;
  remainingPages: number;
  domSnapshot?: DomSnapshot;
}

function summarizeFocusAreas(config: ExplorationConfig): string[] {
  const focusAreas = config.focusAreas ?? ['navigation', 'forms', 'console-errors', 'network-errors'];
  const directives: string[] = [];
  if (focusAreas.includes('navigation')) directives.push('prioritize meaningful user flows and page transitions');
  if (focusAreas.includes('forms')) directives.push('exercise visible forms, search boxes, filters, and submission paths');
  if (focusAreas.includes('auth')) directives.push('watch for auth walls, session expiry, and redirects to login');
  if (focusAreas.includes('console-errors')) directives.push('capture client-side exceptions and broken page behavior');
  if (focusAreas.includes('network-errors')) directives.push('surface failed APIs, bad status codes, and degraded responses');
  if (focusAreas.includes('smoke')) directives.push('cover key happy paths before going deep');
  return directives;
}

function summarizeDomSnapshot(domSnapshot?: DomSnapshot): string {
  if (!domSnapshot) return 'No structured DOM snapshot available.';
  const inputs = domSnapshot.inputs.slice(0, 8).map((input) =>
    `${input.selector} [type=${input.type}${input.name ? `, name=${input.name}` : ''}${input.label ? `, label=${input.label}` : ''}${input.placeholder ? `, placeholder=${input.placeholder}` : ''}]`
  );
  const buttons = domSnapshot.buttons.slice(0, 8).map((button) =>
    `${button.selector} [text=${button.text || '—'}${button.type ? `, type=${button.type}` : ''}]`
  );
  const forms = domSnapshot.forms.slice(0, 5).map((form, index) =>
    `form#${String(index + 1)} [action=${form.action ?? '—'}, method=${form.method ?? '—'}, inputs=${String(form.inputCount)}]`
  );
  return [
    `Inputs: ${inputs.length > 0 ? inputs.join(' | ') : 'none'}`,
    `Buttons: ${buttons.length > 0 ? buttons.join(' | ') : 'none'}`,
    `Forms: ${forms.length > 0 ? forms.join(' | ') : 'none'}`,
  ].join('\n');
}

function listOrFallback(items: string[], fallback: string): string {
  return items.length > 0 ? items.join('\n') : fallback;
}

function summarizePromptContext(ctx: ExplorationPromptContext): string {
  return [
    `remainingSteps=${String(ctx.remainingSteps)}`,
    `remainingPages=${String(ctx.remainingPages)}`,
    `visited=${String(ctx.visited.length)}`,
    `recentSteps=${String(ctx.recentSteps.length)}`,
    `recentFindings=${String(ctx.recentFindings.length)}`,
    `recentToolResults=${String(ctx.recentToolResults.length)}`,
    `recentNetwork=${String(ctx.recentNetworkHighlights.length)}`,
    `actions=${ctx.supportedActions.replace(/"/g, '')}`,
    `focusAreas=${(ctx.config.focusAreas ?? []).join('|') || 'general'}`,
  ].join(' ');
}

function pushRecent(list: string[], value: string, limit = 8): void {
  list.push(value);
  while (list.length > limit) list.shift();
}

function getPromptSampleReason(stepIndex: number, force = false): 'first-step' | 'interval' | 'forced' | null {
  if (force) return 'forced';
  if (stepIndex === 0) return 'first-step';
  if (stepIndex > 0 && stepIndex % 5 === 0) return 'interval';
  return null;
}

function buildPageSnapshot(pageState: PageProbe): NonNullable<import('@zarb/logger').StepRecord['pageState']> {
  return {
    url: pageState.url,
    title: pageState.title,
    formCount: pageState.formCount,
    linkCount: pageState.linkCount,
    consoleErrors: pageState.consoleErrors.length,
    networkErrors: pageState.networkErrors.length,
    ...(pageState.domSummary?.headings ? { headings: pageState.domSummary.headings } : {}),
    ...(pageState.domSummary?.primaryButtons ? { primaryButtons: pageState.domSummary.primaryButtons } : {}),
    ...(pageState.domSummary?.navLinks ? { navLinks: pageState.domSummary.navLinks } : {}),
    ...(pageState.domSummary?.ctaCandidates ? { ctaCandidates: pageState.domSummary.ctaCandidates } : {}),
    ...(pageState.domSummary?.inputHints ? { inputHints: pageState.domSummary.inputHints } : {}),
    ...(pageState.domSummary?.textSnippet ? { textSnippet: pageState.domSummary.textSnippet } : {}),
  };
}

export function buildExplorationDecisionPrompt(ctx: ExplorationPromptContext): string {
  const focusDirectives = summarizeFocusAreas(ctx.config).map((item) => `- ${item}`);
  const domSummary = ctx.page.domSummary
    ? [
      `Headings: ${ctx.page.domSummary.headings.join(' | ') || 'none'}`,
      `Primary buttons: ${ctx.page.domSummary.primaryButtons.join(' | ') || 'none'}`,
      `Nav links: ${ctx.page.domSummary.navLinks.join(' | ') || 'none'}`,
      `Input hints: ${ctx.page.domSummary.inputHints.join(' | ') || 'none'}`,
      `CTA candidates: ${ctx.page.domSummary.ctaCandidates?.join(' | ') || 'none'}`,
      `Text snippet: ${ctx.page.domSummary.textSnippet ?? 'none'}`,
    ].join('\n')
    : 'No page summary available.';
  return renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.explorationDecision, {
    startUrls: ctx.config.startUrls.join(', '),
    allowedHosts: (ctx.config.allowedHosts ?? []).join(', ') || 'derived from start URL',
    stepIndex: String(ctx.stepIndex),
    remainingBudget: `${String(ctx.remainingSteps)} steps, ${String(ctx.remainingPages)} pages`,
    focusAreas: listOrFallback(focusDirectives, '- general exploration'),
    currentPage: `${ctx.page.url} (title: "${ctx.page.title}")`,
    observedCounts: `forms=${String(ctx.page.formCount)}, links=${String(ctx.page.linkCount)}, consoleErrors=${String(ctx.page.consoleErrors.length)}, networkErrors=${String(ctx.page.networkErrors.length)}`,
    consoleErrors: ctx.page.consoleErrors.slice(0, 3).join(' | ') || 'none',
    networkErrors: ctx.page.networkErrors.slice(0, 3).map((item) => `${item.status} ${item.url}`).join(' | ') || 'none',
    availableControls: `${summarizeDomSnapshot(ctx.domSnapshot)}\n${domSummary}`,
    visitedPages: ctx.visited.slice(-8).join(', ') || 'none',
    recentSteps: ctx.recentSteps.length > 0 ? ctx.recentSteps.join(' | ') : 'none',
    recentFindings: ctx.recentFindings.length > 0 ? ctx.recentFindings.join(' | ') : 'none',
    recentToolResults: ctx.recentToolResults.length > 0 ? ctx.recentToolResults.join(' | ') : 'none',
    recentNetworkHighlights: ctx.recentNetworkHighlights.length > 0 ? ctx.recentNetworkHighlights.join(' | ') : 'none',
    supportedActions: ctx.supportedActions,
  });
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
      contextRefs: {
        startUrls: config.startUrls,
        allowedHosts,
        maxSteps: config.maxSteps ?? 20,
        maxPages: config.maxPages ?? 10,
        focusAreas: config.focusAreas ?? [],
        credentialId: config.credentialId ?? null,
        loginStrategy: config.loginStrategy ?? 'none',
        promptTemplates: {
          explorationDecision: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
          explorationLogin: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
        },
      },
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
              const loginErr = await this.runAiLogin(baseUrl, cred, stepLogger, session.session_id, dataRoot);
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
    const recentSteps: string[] = [];
    const recentFindings: string[] = [];
    const recentToolResults: string[] = [];
    const recentNetworkHighlights: string[] = [];
    const seenFindingKeys = new Set<string>();
    let currentPage: PageProbe | undefined;
    let stepIndex = 0;
    let noNewFindingsStreak = 0;
    let totalFindings = 0;
    let llmError: string | undefined;
    // Auth retry state: sliding window of 30 min, max 3 retries
    const authRetryTimestamps: number[] = [];
    const AUTH_RETRY_WINDOW_MS = 30 * 60 * 1000;
    const AUTH_RETRY_MAX = 3;

    try {
      while (stepIndex < maxSteps && visitedUrls.size < maxPages && (currentPage !== undefined || pendingUrls.length > 0)) {
        let pageState: PageProbe;
        if (!currentPage) {
          const url = pendingUrls.shift()!;
          if (visitedUrls.has(url)) continue;

          const navStart = Date.now();
          const navActionId = `pw-nav-${String(stepIndex)}-${String(navStart)}`;
          if (activePwProvider) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'navigate',
              status: 'pending',
              detail: url,
              toolInput: { url },
              actionId: navActionId,
              tool: 'playwright',
            });
            const result = await registry.call<PageProbe>('playwright.navigate', { url }, { sessionId: session.session_id, stepIndex });
            if (!result.ok) {
              stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', detail: url, status: 'error', durationMs: Date.now() - navStart, toolInput: { url }, actionId: navActionId, toolOutput: { error: result.error }, tool: 'playwright' });
              continue;
            }
            pageState = result.value!;
          } else {
            try { pageState = await effectiveProbe(url); } catch {
              stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', detail: url, status: 'error', durationMs: Date.now() - navStart, toolInput: { url }, tool: 'fetch' });
              continue;
            }
          }

          visitedUrls.add(pageState.url);
          const navDuration = Date.now() - navStart;
          stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', detail: url, status: 'ok', durationMs: navDuration, toolInput: { url }, toolOutput: pageState, ...(activePwProvider ? { actionId: navActionId } : {}), pageState: buildPageSnapshot(pageState), tool: activePwProvider ? 'playwright' : 'fetch' });
          pushRecent(recentSteps, `navigate ${pageState.url}`);
          pushRecent(recentToolResults, `navigate => ${pageState.title || pageState.url} forms=${String(pageState.formCount)} links=${String(pageState.linkCount)}`);
          if (activePwProvider) {
            for (const highlight of activePwProvider.getRecentNetworkHighlights(3)) pushRecent(recentNetworkHighlights, highlight, 6);
          }
        } else {
          pageState = currentPage;
        }

        // Persist findings from this page
        const newFindings = this.extractFindings(runId, pageState, config).filter((finding) => {
          const key = `${finding.category}:${finding.severity}:${finding.pageUrl ?? ''}:${finding.summary}`;
          if (seenFindingKeys.has(key)) return false;
          seenFindingKeys.add(key);
          return true;
        });
        for (const f of newFindings) { this.findings.save(f); totalFindings++; }
        if (newFindings.length > 0) {
          for (const finding of newFindings.map((f) => `${f.category}: ${f.summary}`)) pushRecent(recentFindings, finding);
          stepLogger.log({
            component: 'ExplorationAgent', action: 'findings', status: 'ok',
            detail: `${String(newFindings.length)} findings on ${pageState.url}`,
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
              const loginErr = await this.runAiLogin(pageState.url, cred, stepLogger, session.session_id, dataRoot);
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
        const domSnapshot = activePwProvider ? await activePwProvider.collectDomSnapshot().catch(() => undefined) : undefined;
        const promptContextSummary = summarizePromptContext({
          page: pageState,
          config,
          stepIndex,
          visited: [...visitedUrls],
          recentSteps,
          recentFindings,
          recentToolResults,
          recentNetworkHighlights,
          supportedActions: activePwProvider ? '"click"|"fill"|"navigate"|"done"' : '"navigate"|"done"',
          remainingSteps: Math.max((config.maxSteps ?? 20) - stepIndex, 0),
          remainingPages: Math.max((config.maxPages ?? 10) - visitedUrls.size, 0),
          ...(domSnapshot ? { domSnapshot } : {}),
        });
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'llm.decide',
          status: 'pending',
          detail: `deciding next step from ${pageState.url}`,
          toolInput: { currentUrl: pageState.url, formCount: pageState.formCount, linkCount: pageState.linkCount },
          actionId: llmActionId,
          promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
          promptContextSummary,
        });
        const nextStep = await this.decideNextStep(pageState, config, stepIndex, [...visitedUrls], stepLogger, session.session_id, dataRoot, llmActionId, recentSteps, recentFindings, recentToolResults, recentNetworkHighlights, domSnapshot);
        if (nextStep.llmError) {
          llmError = nextStep.llmError;
          log.warn('LLM error during exploration, stopping early', { runId, llmError });
          break;
        }
        stepLogger.log({
          component: 'ExplorationAgent', action: 'llm.decide', status: 'ok', durationMs: Date.now() - llmStart,
          detail: `action=${nextStep.action}${nextStep.targetUrl ? ` url=${nextStep.targetUrl}` : ''}`,
          toolInput: { currentUrl: pageState.url, formCount: pageState.formCount, linkCount: pageState.linkCount },
          toolOutput: { action: nextStep.action, targetUrl: nextStep.targetUrl, selector: nextStep.selector },
          reason: nextStep.reasoning,
          actionId: llmActionId,
          promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
          promptContextSummary,
          ...(this.provider.model ? { model: this.provider.model } : {}),
        });
        if (nextStep.action === 'done') break;
        if (nextStep.action === 'navigate' && nextStep.targetUrl) {
          if (!visitedUrls.has(nextStep.targetUrl)) pendingUrls.unshift(nextStep.targetUrl);
          currentPage = undefined;
        } else if ((nextStep.action === 'click' || nextStep.action === 'fill') && activePwProvider && nextStep.selector) {
          const actionStart = Date.now();
          const actionId = `pw-${nextStep.action}-${String(stepIndex)}-${String(actionStart)}`;
          const toolName = nextStep.action === 'click' ? 'playwright.click' : 'playwright.fill';
          const toolInput = nextStep.action === 'click'
            ? { selector: nextStep.selector }
            : { selector: nextStep.selector, value: nextStep.value ?? '' };
          stepLogger.log({
            component: 'ExplorationAgent',
            action: nextStep.action,
            detail: nextStep.selector,
            status: 'pending',
            toolInput,
            actionId,
            ...(nextStep.reasoning ? { reason: nextStep.reasoning } : {}),
            tool: 'playwright',
          });
          const actionResult = await registry.call<Record<string, unknown>>(toolName, toolInput, { sessionId: session.session_id, stepIndex });
          if (!actionResult.ok) {
            stepLogger.log({ component: 'ExplorationAgent', action: nextStep.action, detail: nextStep.selector, status: 'error', durationMs: Date.now() - actionStart, toolInput, toolOutput: { error: actionResult.error }, reason: nextStep.reasoning, actionId, tool: 'playwright' });
            currentPage = undefined;
            break;
          }
          pushRecent(recentSteps, `${nextStep.action} ${nextStep.selector}`);
          const stateStart = Date.now();
          const stateActionId = `pw-get-state-${String(stepIndex)}-${String(stateStart)}`;
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'state.capture',
            status: 'pending',
            detail: 'playwright.getState',
            toolInput: {},
            actionId: stateActionId,
            tool: 'playwright',
          });
          const stateResult = await registry.call<PageProbe>('playwright.getState', {}, { sessionId: session.session_id, stepIndex });
          if (!stateResult.ok) {
            currentPage = undefined;
            pushRecent(recentToolResults, `${nextStep.action} ${nextStep.selector} => state unavailable`);
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'state.capture',
              status: 'error',
              detail: 'playwright.getState',
              durationMs: Date.now() - stateStart,
              toolInput: {},
              toolOutput: { error: stateResult.error },
              actionId: stateActionId,
              tool: 'playwright',
            });
          } else {
            currentPage = stateResult.value!;
            if (!visitedUrls.has(currentPage.url) && visitedUrls.size < maxPages) visitedUrls.add(currentPage.url);
            pushRecent(recentToolResults, `${nextStep.action} ${nextStep.selector} => ${currentPage.title || currentPage.url}`);
            for (const highlight of activePwProvider.getRecentNetworkHighlights(3)) pushRecent(recentNetworkHighlights, highlight, 6);
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'state.capture',
              status: 'ok',
              detail: currentPage.url,
              durationMs: Date.now() - stateStart,
              toolInput: {},
              toolOutput: currentPage,
              pageState: buildPageSnapshot(currentPage),
              actionId: stateActionId,
              tool: 'playwright',
            });
          }
          stepLogger.log({
            component: 'ExplorationAgent',
            action: nextStep.action,
            detail: nextStep.selector,
            status: 'ok',
            durationMs: Date.now() - actionStart,
            toolInput,
            toolOutput: actionResult.value,
            ...(currentPage ? { pageState: buildPageSnapshot(currentPage) } : {}),
            ...(nextStep.reasoning ? { reason: nextStep.reasoning } : {}),
            actionId,
            tool: 'playwright',
          });
        } else {
          if ((nextStep.action === 'click' || nextStep.action === 'fill') && nextStep.selector) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: nextStep.action,
              detail: nextStep.selector,
              status: 'warn',
              toolInput: { selector: nextStep.selector, value: nextStep.value },
              toolOutput: { error: 'INTERACTIVE_ACTION_UNAVAILABLE_IN_FETCH_MODE' },
              reason: nextStep.reasoning,
              tool: 'fetch',
            });
          }
          currentPage = undefined;
        }

        this.sessionManager.appendStep(session.session_id, {
          stepIndex,
          description: `${nextStep.action}: ${pageState.url}`,
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
    sessionId: string,
    dataRoot: string,
    actionId?: string,
    recentSteps: string[] = [],
    recentFindings: string[] = [],
    recentToolResults: string[] = [],
    recentNetworkHighlights: string[] = [],
    domSnapshot?: DomSnapshot,
  ): Promise<ExplorationStep> {
    const prompt = buildExplorationDecisionPrompt({
      page,
      config,
      stepIndex,
      visited,
      recentSteps,
      recentFindings,
      recentToolResults,
      recentNetworkHighlights,
      supportedActions: domSnapshot ? '"click"|"fill"|"navigate"|"done"' : '"navigate"|"done"',
      remainingSteps: Math.max((config.maxSteps ?? 20) - stepIndex, 0),
      remainingPages: Math.max((config.maxPages ?? 10) - visited.length, 0),
      ...(domSnapshot ? { domSnapshot } : {}),
    });

    let raw = '';
    const toolInput = { currentUrl: page.url, formCount: page.formCount, linkCount: page.linkCount };
    const promptContextSummary = summarizePromptContext({
      page,
      config,
      stepIndex,
      visited,
      recentSteps,
      recentFindings,
      recentToolResults,
      recentNetworkHighlights,
      supportedActions: domSnapshot ? '"click"|"fill"|"navigate"|"done"' : '"navigate"|"done"',
      remainingSteps: Math.max((config.maxSteps ?? 20) - stepIndex, 0),
      remainingPages: Math.max((config.maxPages ?? 10) - visited.length, 0),
      ...(domSnapshot ? { domSnapshot } : {}),
    });
    try {
      raw = await this.provider.complete(prompt, {
        scene: 'explorationDecision',
        systemPrompt: EXPLORATION_DECIDE_SYSTEM_PROMPT,
        responseFormat: { type: 'json_object' },
        tools: [EXPLORATION_DECIDE_TOOL],
        toolChoice: 'required',
        temperature: 0,
        maxTokens: 360,
        retry: { maxAttempts: 2, retryOnEmpty: true },
      });
    } catch (e) {
      this.sessionManager.appendPromptSample(sessionId, {
        sessionId,
        stepIndex,
        timestamp: new Date().toISOString(),
        phase: 'exploration-decision',
        templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
        prompt,
        response: String(e),
        promptContextSummary,
        sampledBy: getPromptSampleReason(stepIndex, true) ?? 'forced',
        metadata: {
          currentUrl: page.url,
          visitedCount: visited.length,
          supportedActions: domSnapshot ? ['click', 'fill', 'navigate', 'done'] : ['navigate', 'done'],
        },
      }, dataRoot);
      stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'error', detail: `LLM call threw: ${String(e)}`, reason: 'LLM unavailable', toolInput, toolOutput: { error: String(e) }, promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision, ...(actionId ? { actionId } : {}) });
      return { stepIndex, action: 'done', reasoning: 'LLM unavailable', llmError: 'LLM_CALL_FAILED' };
    }

    const sampledBy = getPromptSampleReason(stepIndex);
    if (sampledBy) {
      this.sessionManager.appendPromptSample(sessionId, {
        sessionId,
        stepIndex,
        timestamp: new Date().toISOString(),
        phase: 'exploration-decision',
        templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
        prompt,
        response: raw,
        promptContextSummary,
        sampledBy,
        metadata: {
          currentUrl: page.url,
          visitedCount: visited.length,
          supportedActions: domSnapshot ? ['click', 'fill', 'navigate', 'done'] : ['navigate', 'done'],
          recentToolResults,
          recentNetworkHighlights,
        },
      }, dataRoot);
    }

    if (!raw || raw.trim() === '') {
      stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'error', detail: 'LLM returned empty response', reason: 'empty response', toolInput, toolOutput: { status: 'empty' }, promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision, ...(actionId ? { actionId } : {}) });
      return { stepIndex, action: 'done', reasoning: 'LLM returned empty response', llmError: 'LLM_EMPTY_RESPONSE' };
    }

    const parsed = parseJson<{ action?: string; targetUrl?: string; selector?: string; value?: string; reasoning?: string }>(raw, {});

    if ((parsed.action === 'click' || parsed.action === 'fill') && !domSnapshot) {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'llm.decide',
        status: 'warn',
        detail: `LLM returned ${parsed.action} without interactive runtime — treating as done`,
        toolInput,
        toolOutput: parsed,
        promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
        ...(actionId ? { actionId } : {}),
      });
      return { stepIndex, action: 'done', reasoning: parsed.reasoning ?? 'interactive action unavailable in fetch mode' };
    }

    if (parsed.action === 'click' && parsed.selector) {
      return { stepIndex, action: 'click', selector: parsed.selector, reasoning: parsed.reasoning ?? '', targetUrl: undefined, value: undefined };
    }

    if (parsed.action === 'fill' && parsed.selector) {
      return { stepIndex, action: 'fill', selector: parsed.selector, value: parsed.value ?? '', reasoning: parsed.reasoning ?? '', targetUrl: undefined };
    }

    // navigate without a targetUrl is meaningless — treat as done
    if (parsed.action !== 'done' && parsed.action !== 'click' && parsed.action !== 'fill' && !parsed.targetUrl) {
      stepLogger.log({ component: 'ExplorationAgent', action: 'llm.decide', status: 'warn', detail: 'LLM returned navigate without targetUrl — treating as done', toolInput, toolOutput: parsed, promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision, ...(actionId ? { actionId } : {}) });
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
    sessionId: string,
    dataRoot: string,
  ): Promise<string | undefined> {
    const pw = this.playwrightProvider;
    if (!pw) return 'LOGIN_AI_FAILED';

    const MAX_LOGIN_STEPS = 10;
    const MAX_SAME_ACTION_STREAK = 2;
    const loginUrl = cred.login_url ?? startUrl;
    const t0 = Date.now();
    const loginActionId = `login-ai-${String(t0)}`;
    const aiInput = { strategy: 'ai', url: loginUrl };
    const recentLoginActions: string[] = [];
    let lastDecisionSig = '';
    let sameDecisionStreak = 0;

    stepLogger.log({ component: 'ExplorationAgent', action: 'login.start', status: 'pending', detail: `strategy=ai url=${loginUrl}`, toolInput: aiInput, actionId: loginActionId, tool: 'playwright' });

    const loginNavigateActionId = `login-nav-${String(t0)}`;
    try {
      const page = pw.getPage();
      stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', status: 'pending', detail: loginUrl, toolInput: { url: loginUrl }, actionId: loginNavigateActionId, tool: 'playwright' });
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', status: 'ok', detail: loginUrl, durationMs: Date.now() - t0, toolInput: { url: loginUrl }, actionId: loginNavigateActionId, tool: 'playwright' });
    } catch (e) {
      stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', status: 'error', detail: String(e), durationMs: Date.now() - t0, toolInput: { url: loginUrl }, toolOutput: { error: String(e) }, actionId: loginNavigateActionId, tool: 'playwright' });
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

      const promptContextSummary = `login url=${snapshot.url} inputs=${String(snapshot.inputs.length)} buttons=${String(snapshot.buttons.length)} forms=${String(snapshot.forms.length)}`;
      const inputFillState = snapshot.inputs
        .map((input) => `${input.selector}:${input.filled ? 'filled' : 'empty'}`)
        .join(' | ') || 'none';
      const actionHistory = recentLoginActions.join(' | ') || 'none';
      const prompt = renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.explorationLogin, {
        currentPage: `${snapshot.url} (title: "${snapshot.title}")`,
        inputs: JSON.stringify(snapshot.inputs.map(({ type, name, placeholder, label, selector, filled }) => ({ type, name, placeholder, label, selector, filled }))),
        inputFillState,
        buttons: JSON.stringify(snapshot.buttons.map(({ text, type, selector }) => ({ text, type, selector }))),
        forms: JSON.stringify(snapshot.forms),
        actionHistory,
        username: cred.username ?? '',
      });

      let raw = '';
      const llmStart = Date.now();
      const llmActionId = `login-llm-${String(i)}-${String(llmStart)}`;
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'llm.decide',
        status: 'pending',
        detail: `login step ${String(i + 1)}`,
        toolInput: { currentUrl: snapshot.url, inputs: snapshot.inputs.length, buttons: snapshot.buttons.length, forms: snapshot.forms.length },
        actionId: llmActionId,
        promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
        promptContextSummary,
        ...(this.provider.model ? { model: this.provider.model } : {}),
      });
      try {
        raw = await this.provider.complete(prompt, {
          scene: 'explorationLogin',
          systemPrompt: LOGIN_DECIDE_SYSTEM_PROMPT,
          responseFormat: { type: 'json_object' },
          tools: [LOGIN_DECIDE_TOOL],
          toolChoice: 'required',
          temperature: 0,
          maxTokens: 320,
          retry: { maxAttempts: 2, retryOnEmpty: true },
        });
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'llm.decide',
          status: 'ok',
          detail: `login step ${String(i + 1)} action candidate`,
          durationMs: Date.now() - llmStart,
          toolInput: { currentUrl: snapshot.url, inputs: snapshot.inputs.length, buttons: snapshot.buttons.length, forms: snapshot.forms.length },
          toolOutput: { responsePreview: raw.slice(0, 240) },
          actionId: llmActionId,
          promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
          promptContextSummary,
          ...(this.provider.model ? { model: this.provider.model } : {}),
        });
      } catch (e) {
        this.sessionManager.appendPromptSample(sessionId, {
          sessionId,
          stepIndex: i,
          timestamp: new Date().toISOString(),
          phase: 'exploration-login',
          templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
          prompt,
          response: String(e),
          promptContextSummary,
          sampledBy: getPromptSampleReason(i, true) ?? 'forced',
          metadata: {
            currentUrl: snapshot.url,
            inputs: snapshot.inputs.length,
            buttons: snapshot.buttons.length,
            forms: snapshot.forms.length,
          },
        }, dataRoot);
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'llm.decide',
          status: 'error',
          detail: `LLM call failed: ${String(e)}`,
          durationMs: Date.now() - llmStart,
          toolInput: { currentUrl: snapshot.url, inputs: snapshot.inputs.length, buttons: snapshot.buttons.length, forms: snapshot.forms.length },
          toolOutput: { error: String(e) },
          actionId: llmActionId,
          promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
          promptContextSummary,
          ...(this.provider.model ? { model: this.provider.model } : {}),
        });
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.failed', status: 'error', detail: `LLM call failed: ${String(e)}`, durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { error: String(e) }, actionId: loginActionId, tool: 'playwright', promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin, promptContextSummary });
        return 'LOGIN_AI_FAILED';
      }

      const sampledBy = getPromptSampleReason(i);
      if (sampledBy) {
        this.sessionManager.appendPromptSample(sessionId, {
          sessionId,
          stepIndex: i,
          timestamp: new Date().toISOString(),
          phase: 'exploration-login',
          templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
          prompt,
          response: raw,
          promptContextSummary,
          sampledBy,
          metadata: {
            currentUrl: snapshot.url,
            inputs: snapshot.inputs.length,
            buttons: snapshot.buttons.length,
            forms: snapshot.forms.length,
          },
        }, dataRoot);
      }

      let decision = parseJson<{ isLoginPage?: boolean; action?: string; selector?: string; value?: string; reasoning?: string }>(raw, {});

      const decisionSig = `${decision.action ?? 'unknown'}::${decision.selector ?? ''}::${decision.value ?? ''}`;
      if (decisionSig === lastDecisionSig) sameDecisionStreak++;
      else sameDecisionStreak = 0;
      lastDecisionSig = decisionSig;

      if (sameDecisionStreak >= MAX_SAME_ACTION_STREAK) {
        const passwordInput = snapshot.inputs.find((input) => input.type === 'password');
        if (passwordInput && decision.selector !== passwordInput.selector) {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.retry',
            status: 'warn',
            detail: `LLM repeated action, forcing password fill selector=${passwordInput.selector}`,
            toolInput: { repeatedAction: decisionSig, streak: sameDecisionStreak + 1 },
            toolOutput: { forcedAction: 'fill', selector: passwordInput.selector, value: '__PASSWORD__' },
            tool: 'playwright',
          });
          decision = {
            ...decision,
            action: 'fill',
            selector: passwordInput.selector,
            value: '__PASSWORD__',
            reasoning: decision.reasoning ?? 'fallback: avoid repeated username fill',
          };
        } else {
          const submit = snapshot.buttons[0];
          if (submit?.selector) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.retry',
              status: 'warn',
              detail: `LLM repeated action, forcing submit click selector=${submit.selector}`,
              toolInput: { repeatedAction: decisionSig, streak: sameDecisionStreak + 1 },
              toolOutput: { forcedAction: 'click', selector: submit.selector },
              tool: 'playwright',
            });
            decision = {
              ...decision,
              action: 'click',
              selector: submit.selector,
              reasoning: decision.reasoning ?? 'fallback: avoid repeated fill loop',
            };
          }
        }
      }

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
          pushRecent(recentLoginActions, `fill ${decision.selector} value=${isPassword ? '[REDACTED]' : (decision.value ?? '')}`, 10);
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
          pushRecent(recentLoginActions, `click ${decision.selector}`, 10);
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
