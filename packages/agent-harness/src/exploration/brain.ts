import type { ExplorationConfig } from '@zarb/shared-types';
import type { DomSnapshot } from '../playwright-tool-provider.js';
import { HARNESS_TEMPLATE_VERSIONS } from '../prompt-loader.js';
import { isLoginUrl } from '../playwright-tool-provider.js';
import type {
  ExplorationBrainPhase,
  ExplorationBrainPlan,
  ExplorationStep,
  PageProbe,
} from '../exploration-agent.js';
import { buildExplorationDecisionPrompt, buildExplorationPlanPrompt, summarizePromptContext } from './prompt-builder.js';
import type { HarnessSessionManager } from '../runtime/session-manager.js';
import type { StepLogger } from '@zarb/logger';

interface BrainProvider {
  complete(prompt: string, options?: {
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
  }): Promise<string>;
  readonly model: string | undefined;
}

const EXPLORATION_DECIDE_SYSTEM_PROMPT = 'You are an exploration decision agent. Return only structured JSON for the next action.';
const EXPLORATION_PLAN_SYSTEM_PROMPT = 'You are an exploration planning agent. Return only structured JSON for short-horizon plan.';

const EXPLORATION_DECIDE_TOOL = {
  type: 'function' as const,
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

const EXPLORATION_PLAN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'plan_exploration_phase',
    description: 'Plan the next exploration phase with objective and guardrails.',
    parameters: {
      type: 'object',
      properties: {
        phase: { type: 'string', enum: ['bootstrap', 'post-login', 'explore', 'recover'] },
        objective: { type: 'string' },
        requiresLogin: { type: 'boolean' },
        loginReason: { type: 'string' },
        candidateUrls: { type: 'array', items: { type: 'string' } },
        avoidUrls: { type: 'array', items: { type: 'string' } },
        preferredActions: { type: 'array', items: { type: 'string', enum: ['click', 'fill', 'navigate', 'done'] } },
        reasoning: { type: 'string' },
      },
      required: ['phase', 'objective', 'reasoning'],
      additionalProperties: false,
    },
    strict: true,
  },
};

type AuthGateMode = 'none' | 'skip' | 'replan-continue' | 'replan-plan';

export function resolveAuthGateMode(input: {
  authEstablished: boolean;
  hasAuthError: boolean;
  isOnLoginPage: boolean;
}): AuthGateMode {
  const { authEstablished, hasAuthError, isOnLoginPage } = input;
  if (!hasAuthError && !isOnLoginPage) return 'none';
  if (authEstablished && isOnLoginPage && !hasAuthError) return 'skip';
  if (authEstablished) return 'replan-continue';
  return 'replan-plan';
}

export class ExplorationBrain {
  constructor(
    private readonly provider: BrainProvider,
    private readonly sessionManager: HarnessSessionManager,
  ) {}

  async planExplorationPhase(
    page: PageProbe,
    config: ExplorationConfig,
    stepIndex: number,
    visited: string[],
    stepLogger: StepLogger,
    sessionId: string,
    dataRoot: string,
    recentSteps: string[],
    recentFindings: string[],
    recentToolResults: string[],
    recentNetworkHighlights: string[],
    authEstablished: boolean,
    mode: 'plan' | 'replan',
    actionId?: string,
  ): Promise<ExplorationBrainPlan> {
    const fallback = fallbackBrainPlan(page, config, visited, authEstablished);
    const prompt = buildExplorationPlanPrompt({
      page,
      config,
      visited,
      stepIndex,
      remainingSteps: Math.max((config.maxSteps ?? 20) - stepIndex, 0),
      remainingPages: Math.max((config.maxPages ?? 10) - visited.length, 0),
      recentSteps,
      recentFindings,
      recentToolResults,
      recentNetworkHighlights,
      authEstablished,
    });
    const promptContextSummary = [
      `planStep=${String(stepIndex)}`,
      `visited=${String(visited.length)}`,
      `auth=${authEstablished ? 'yes' : 'no'}`,
      `forms=${String(page.formCount)}`,
      `links=${String(page.linkCount)}`,
      `noscript=${includesNoScriptBanner(page) ? 'yes' : 'no'}`,
      `login=${pageLooksLikeLogin(page) || hasAuthNetworkError(page) ? 'yes' : 'no'}`,
    ].join(' ');
    let raw = '';
    try {
      raw = await this.provider.complete(prompt, {
        scene: 'explorationDecision',
        systemPrompt: EXPLORATION_PLAN_SYSTEM_PROMPT,
        responseFormat: { type: 'json_object' },
        tools: [EXPLORATION_PLAN_TOOL],
        toolChoice: 'required',
        temperature: 0,
        maxTokens: 420,
        retry: { maxAttempts: 2, retryOnEmpty: true },
      });
    } catch (e) {
      this.sessionManager.appendPromptSample(sessionId, {
        sessionId,
        stepIndex,
        timestamp: new Date().toISOString(),
        phase: 'exploration-plan',
        templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
        prompt,
        response: String(e),
        promptContextSummary,
        sampledBy: 'forced',
        metadata: {
          currentUrl: page.url,
          visitedCount: visited.length,
          fallbackPhase: fallback.phase,
        },
      }, dataRoot);
      stepLogger.log({
        component: 'ExplorationAgent',
        action: mode === 'replan' ? 'brain.replan' : 'brain.plan',
        status: 'warn',
        detail: `planner failed, fallback plan used: ${String(e)}`,
        toolInput: { currentUrl: page.url, authEstablished, visited: visited.length },
        toolOutput: { fallback },
        promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
        promptContextSummary,
        ...(actionId ? { actionId } : {}),
      });
      return fallback;
    }

    this.sessionManager.appendPromptSample(sessionId, {
      sessionId,
      stepIndex,
      timestamp: new Date().toISOString(),
      phase: 'exploration-plan',
      templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
      prompt,
      response: raw,
      promptContextSummary,
      sampledBy: 'forced',
      metadata: {
        currentUrl: page.url,
        visitedCount: visited.length,
        authEstablished,
      },
    }, dataRoot);

    if (!raw || raw.trim() === '') {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: mode === 'replan' ? 'brain.replan' : 'brain.plan',
        status: 'warn',
        detail: 'planner returned empty response, fallback plan used',
        toolInput: { currentUrl: page.url, authEstablished, visited: visited.length },
        toolOutput: { fallback },
        promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
        promptContextSummary,
        ...(actionId ? { actionId } : {}),
      });
      return fallback;
    }

    const parsed = parseJson<{
      phase?: string;
      objective?: string;
      reasoning?: string;
      requiresLogin?: boolean;
      loginReason?: string;
      candidateUrls?: string[];
      avoidUrls?: string[];
      preferredActions?: string[];
    }>(raw, {});

    const allowedHosts = deriveAllowedHosts(config, page.url);
    const normalizeUrlList = (input: string[] | undefined): string[] => {
      if (!input || input.length === 0) return [];
      return dedupeUrls(
        input
          .map((item) => normalizeAbsoluteUrl(item, page.url))
          .filter((item): item is string => !!item)
          .filter((item) => isUrlAllowedByHosts(item, allowedHosts)),
      );
    };

    const normalizedCandidates = normalizeUrlList(parsed.candidateUrls);
    const normalizedAvoidUrls = normalizeUrlList(parsed.avoidUrls);
    const phaseOptions: ExplorationBrainPhase[] = ['bootstrap', 'post-login', 'explore', 'recover'];
    const phase = phaseOptions.includes((parsed.phase ?? '') as ExplorationBrainPhase)
      ? parsed.phase as ExplorationBrainPhase
      : fallback.phase;

    const preferred = (parsed.preferredActions ?? [])
      .filter((action): action is 'click' | 'fill' | 'navigate' | 'done' =>
        action === 'click' || action === 'fill' || action === 'navigate' || action === 'done',
      );

    const mergedAvoid = dedupeUrls([
      ...fallback.avoidUrls,
      ...normalizedAvoidUrls,
      ...(authEstablished && !hasAuthNetworkError(page)
        ? config.startUrls
          .map((url) => normalizeAbsoluteUrl(url, page.url))
          .filter((url): url is string => !!url && isLoginUrl(url))
        : []),
    ]);
    const mergedCandidates = dedupeUrls([
      ...normalizedCandidates,
      ...fallback.candidateUrls,
    ]).filter((url) => !mergedAvoid.includes(url));
    const requiresLogin = authEstablished && !hasAuthNetworkError(page)
      ? false
      : Boolean(parsed.requiresLogin ?? fallback.requiresLogin);

    const plan: ExplorationBrainPlan = {
      phase,
      objective: parsed.objective?.trim() || fallback.objective,
      reasoning: parsed.reasoning?.trim() || fallback.reasoning,
      requiresLogin,
      loginReason: requiresLogin ? (parsed.loginReason?.trim() || fallback.loginReason) : '',
      candidateUrls: mergedCandidates,
      avoidUrls: mergedAvoid,
      preferredActions: preferred.length > 0 ? preferred : fallback.preferredActions,
    };

    stepLogger.log({
      component: 'ExplorationAgent',
      action: mode === 'replan' ? 'brain.replan' : 'brain.plan',
      status: 'ok',
      detail: `${plan.phase}: ${plan.objective}`,
      toolInput: { currentUrl: page.url, authEstablished, visited: visited.length },
      toolOutput: {
        phase: plan.phase,
        objective: plan.objective,
        requiresLogin: plan.requiresLogin,
        loginReason: plan.loginReason,
        candidateUrls: plan.candidateUrls,
        avoidUrls: plan.avoidUrls,
        preferredActions: plan.preferredActions,
      },
      promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
      promptContextSummary,
      ...(actionId ? { actionId } : {}),
    });

    return plan;
  }

  async decideNextStep(
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
    brainPlan?: ExplorationBrainPlan,
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
      ...(brainPlan ? { brainPlan } : {}),
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
      ...(brainPlan ? { brainPlan } : {}),
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
          ...(brainPlan ? { brainPhase: brainPlan.phase, brainObjective: brainPlan.objective } : {}),
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
          ...(brainPlan ? { brainPhase: brainPlan.phase, brainObjective: brainPlan.objective } : {}),
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
}

function getPromptSampleReason(stepIndex: number, force = false): 'first-step' | 'interval' | 'forced' | null {
  if (force) return 'forced';
  if (stepIndex === 0) return 'first-step';
  if (stepIndex > 0) return 'interval';
  return null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(raw);
    return match ? JSON.parse(match[0]) as T : fallback;
  } catch {
    return fallback;
  }
}

function hasAuthNetworkError(page: PageProbe): boolean {
  return page.networkErrors.some((entry) => entry.status === 401 || entry.status === 403);
}

function normalizeAbsoluteUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function dedupeUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of urls) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function deriveAllowedHosts(config: ExplorationConfig, fallbackUrl: string): string[] {
  if (config.allowedHosts && config.allowedHosts.length > 0) return config.allowedHosts;
  try {
    return [new URL(fallbackUrl).hostname];
  } catch {
    return [];
  }
}

function isUrlAllowedByHosts(url: string, allowedHosts: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    if (allowedHosts.length === 0) return true;
    return allowedHosts.includes(host);
  } catch {
    return false;
  }
}

function includesNoScriptBanner(page: PageProbe): boolean {
  if (page.domSummary?.noScriptWarningVisible) return true;
  const snippet = page.domSummary?.textSnippet ?? '';
  return /doesn'?t work properly without javascript enabled/i.test(snippet);
}

function pageLooksLikeLogin(page: PageProbe): boolean {
  if (isLoginUrl(page.url)) return true;
  const title = page.title ?? '';
  const hints = page.domSummary?.inputHints.join(' ') ?? '';
  const snippet = page.domSummary?.textSnippet ?? '';
  const loginCue = `${title} ${hints} ${snippet}`;
  const hasLoginKeyword = /(登录|sign[ -]?in|log[ -]?in|password|密码|username|用户名|账号|账号登录|验证码|captcha)/i.test(loginCue);
  return page.formCount > 0 && hasLoginKeyword;
}

function fallbackBrainPlan(
  page: PageProbe,
  config: ExplorationConfig,
  visited: string[],
  authEstablished: boolean,
): ExplorationBrainPlan {
  const hasAuthError = hasAuthNetworkError(page);
  const loginDetected = pageLooksLikeLogin(page) || hasAuthError;
  const defaultObjective = 'Expand coverage by interacting with visible controls before navigating.';
  const startCandidates = config.startUrls
    .map((url) => normalizeAbsoluteUrl(url, page.url))
    .filter((url): url is string => !!url);
  const visitedNonLogin = visited.filter((url) => !isLoginUrl(url));
  const loginUrls = startCandidates.filter((url) => isLoginUrl(url));
  const lastVisitedNonLogin = visitedNonLogin.length > 0 ? visitedNonLogin[visitedNonLogin.length - 1]! : '';
  const preferredActions: Array<'click' | 'fill' | 'navigate' | 'done'> =
    page.formCount > 0 || page.linkCount > 0 ? ['click', 'fill', 'navigate', 'done'] : ['navigate', 'click', 'fill', 'done'];

  if (authEstablished && isLoginUrl(page.url) && !hasAuthError) {
    return {
      phase: 'recover',
      objective: 'Leave login page after successful authentication and continue post-login exploration.',
      reasoning: 'Authenticated session should not restart login without explicit auth failure.',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: dedupeUrls([lastVisitedNonLogin, ...startCandidates.filter((url) => !isLoginUrl(url))]),
      avoidUrls: dedupeUrls(loginUrls),
      preferredActions: ['navigate', 'click', 'fill', 'done'],
    };
  }

  if (!authEstablished && loginDetected) {
    return {
      phase: 'bootstrap',
      objective: 'Complete login first, then proceed with authenticated exploration.',
      reasoning: hasAuthError ? 'Auth-related network errors indicate session is not authorized.' : 'Current page appears to be a login gate.',
      requiresLogin: true,
      loginReason: hasAuthError ? 'network auth error (401/403)' : 'login page detected',
      candidateUrls: dedupeUrls([page.url, ...startCandidates]),
      avoidUrls: [],
      preferredActions: ['fill', 'click', 'done'],
    };
  }

  if (includesNoScriptBanner(page)) {
    return {
      phase: authEstablished ? 'recover' : 'bootstrap',
      objective: 'Recover from non-interactive page and enter a route with real interactive controls.',
      reasoning: 'No-script banner indicates current route is not a useful exploration target.',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: dedupeUrls([...startCandidates.filter((url) => !isLoginUrl(url)), lastVisitedNonLogin]),
      avoidUrls: authEstablished ? dedupeUrls(loginUrls) : [],
      preferredActions: ['navigate', 'click', 'fill', 'done'],
    };
  }

  if (authEstablished && !isLoginUrl(page.url)) {
    return {
      phase: 'post-login',
      objective: 'Stay in authenticated area and explore meaningful user workflows.',
      reasoning: 'Session is authenticated and current page is in post-login scope.',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: dedupeUrls([...startCandidates.filter((url) => !isLoginUrl(url)), ...visitedNonLogin.slice(-2)]),
      avoidUrls: dedupeUrls(loginUrls),
      preferredActions,
    };
  }

  return {
    phase: 'explore',
    objective: defaultObjective,
    reasoning: 'Default fallback when no stronger planning signal is available.',
    requiresLogin: false,
    loginReason: '',
    candidateUrls: dedupeUrls(startCandidates),
    avoidUrls: [],
    preferredActions,
  };
}
