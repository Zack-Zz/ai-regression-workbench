import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { FindingRepository, SiteCredentialRepository } from '@zarb/storage';
import { HarnessSessionManager } from './runtime/session-manager.js';
import { ToolRegistry } from './runtime/tool-registry.js';
import { StepLogger, appLogger } from '@zarb/logger';
import type { DomSnapshot, PlaywrightToolProvider, VerificationChallenge } from './playwright-tool-provider.js';
import { LoginFailedError, isLoginUrl } from './playwright-tool-provider.js';
import { HARNESS_TEMPLATE_VERSIONS, renderHarnessTemplate } from './prompt-loader.js';
import { PlaywrightExplorationBrowserAdapter } from './exploration/browser-adapter.js';
import type { ExplorationBrowserAdapter } from './exploration/browser-adapter.js';
import {
  buildExplorationDecisionPrompt as buildExplorationDecisionPromptFromModule,
  buildExplorationPlanPrompt as buildExplorationPlanPromptFromModule,
  summarizePromptContext as summarizePromptContextFromModule,
} from './exploration/prompt-builder.js';
import { ExplorationFindingExtractor } from './exploration/finding-extractor.js';
import { ExplorationBrain, resolveAuthGateMode as resolveAuthGateModeFromBrain } from './exploration/brain.js';
import {
  ExplorationAuthFlow,
  estimateSliderDragDistance as estimateSliderDragDistanceFromAuth,
  isCaptchaChallengeError as isCaptchaChallengeErrorFromAuth,
  looksLoggedInBySnapshot as looksLoggedInBySnapshotFromAuth,
} from './exploration/auth-flow.js';

const log = appLogger.child('ExplorationAgent');

export interface AIProvider {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  isConfigured(): boolean;
  readonly model: string | undefined;
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
const EXPLORATION_PLAN_SYSTEM_PROMPT = 'You are an exploration planning agent. Return only structured JSON for short-horizon plan.';
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

const EXPLORATION_PLAN_TOOL: NonNullable<AICompletionOptions['tools']>[number] = {
  type: 'function',
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

export type ExplorationBrainPhase = 'bootstrap' | 'post-login' | 'explore' | 'recover';

export interface ExplorationBrainPlan {
  phase: ExplorationBrainPhase;
  objective: string;
  reasoning: string;
  requiresLogin: boolean;
  loginReason: string;
  candidateUrls: string[];
  avoidUrls: string[];
  preferredActions: Array<'click' | 'fill' | 'navigate' | 'done'>;
}

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
    noScriptWarningVisible?: boolean;
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
  brainPlan?: ExplorationBrainPlan;
  domSnapshot?: DomSnapshot;
}

export interface ExplorationPlanPromptContext {
  page: PageProbe;
  config: ExplorationConfig;
  visited: string[];
  stepIndex: number;
  remainingSteps: number;
  remainingPages: number;
  recentSteps: string[];
  recentFindings: string[];
  recentToolResults: string[];
  recentNetworkHighlights: string[];
  authEstablished: boolean;
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
  const clickables = (domSnapshot.clickables ?? []).slice(0, 14).map((item) =>
    `${item.selector} [text=${item.text}${item.role ? `, role=${item.role}` : ''}${item.area ? `, area=${item.area}` : ''}]`
  );
  return [
    `Inputs: ${inputs.length > 0 ? inputs.join(' | ') : 'none'}`,
    `Buttons: ${buttons.length > 0 ? buttons.join(' | ') : 'none'}`,
    `Forms: ${forms.length > 0 ? forms.join(' | ') : 'none'}`,
    `Clickables: ${clickables.length > 0 ? clickables.join(' | ') : 'none'}`,
  ].join('\n');
}

function listOrFallback(items: string[], fallback: string): string {
  return items.length > 0 ? items.join('\n') : fallback;
}

function summarizePromptContext(ctx: ExplorationPromptContext): string {
  const fields = [
    `remainingSteps=${String(ctx.remainingSteps)}`,
    `remainingPages=${String(ctx.remainingPages)}`,
    `visited=${String(ctx.visited.length)}`,
    `recentSteps=${String(ctx.recentSteps.length)}`,
    `recentFindings=${String(ctx.recentFindings.length)}`,
    `recentToolResults=${String(ctx.recentToolResults.length)}`,
    `recentNetwork=${String(ctx.recentNetworkHighlights.length)}`,
    `actions=${ctx.supportedActions.replace(/"/g, '')}`,
    `focusAreas=${(ctx.config.focusAreas ?? []).join('|') || 'general'}`,
  ];
  if (ctx.brainPlan) {
    fields.push(`brainPhase=${ctx.brainPlan.phase}`);
    fields.push(`brainLogin=${ctx.brainPlan.requiresLogin ? 'yes' : 'no'}`);
    fields.push(`brainCandidates=${String(ctx.brainPlan.candidateUrls.length)}`);
    fields.push(`brainAvoid=${String(ctx.brainPlan.avoidUrls.length)}`);
  }
  return fields.join(' ');
}

function pushRecent(list: string[], value: string, limit = 8): void {
  list.push(value);
  while (list.length > limit) list.shift();
}

function getPromptSampleReason(stepIndex: number, force = false): 'first-step' | 'interval' | 'forced' | null {
  if (force) return 'forced';
  if (stepIndex === 0) return 'first-step';
  if (stepIndex > 0) return 'interval';
  return null;
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function normalizeUrlForDecision(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function escapeSelectorText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeActionSelector(action: ExplorationStep['action'], selector: string): string {
  if (action !== 'click') return selector;
  if (selector.startsWith('link:')) {
    const text = selector.slice('link:'.length).trim();
    if (text) return `a:has-text("${escapeSelectorText(text)}")`;
  }
  if (selector.startsWith('button:')) {
    const text = selector.slice('button:'.length).trim();
    if (text) return `button:has-text("${escapeSelectorText(text)}")`;
  }
  return selector;
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
    if (!value) continue;
    if (seen.has(value)) continue;
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
      reasoning: hasAuthError
        ? 'Auth-related network errors indicate session is not authorized.'
        : 'Current page appears to be a login gate.',
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
      candidateUrls: dedupeUrls([
        ...startCandidates.filter((url) => !isLoginUrl(url)),
        lastVisitedNonLogin,
      ]),
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

function summarizeBrainPlan(plan?: ExplorationBrainPlan): string {
  if (!plan) return 'none';
  return [
    `phase=${plan.phase}`,
    `objective=${plan.objective}`,
    `requiresLogin=${plan.requiresLogin ? 'yes' : 'no'}`,
    `loginReason=${plan.loginReason || 'none'}`,
    `candidateUrls=${plan.candidateUrls.join(', ') || 'none'}`,
    `avoidUrls=${plan.avoidUrls.join(', ') || 'none'}`,
    `preferredActions=${plan.preferredActions.join('|') || 'none'}`,
  ].join('\n');
}

function isManualLoginEnabled(config?: ExplorationConfig): boolean {
  if (config?.manualInterventionOnCaptcha !== undefined) return config.manualInterventionOnCaptcha;
  return parseBooleanFlag(process.env['ZARB_MANUAL_LOGIN']) ?? true;
}

function getManualLoginTimeoutMs(config?: ExplorationConfig): number {
  if (config?.manualLoginTimeoutMs !== undefined) {
    const configured = Number(config.manualLoginTimeoutMs);
    if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  }
  const raw = process.env['ZARB_MANUAL_LOGIN_TIMEOUT_MS'];
  if (!raw) return 180_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 180_000;
  return Math.floor(parsed);
}

function isAutoSliderEnabled(config?: ExplorationConfig): boolean {
  if (config?.captchaAutoSolve !== undefined) return config.captchaAutoSolve;
  return parseBooleanFlag(process.env['ZARB_SLIDER_AUTO']) ?? true;
}

function getAutoSliderAttempts(config?: ExplorationConfig): number {
  if (config?.captchaAutoSolveAttempts !== undefined) {
    const configured = Number(config.captchaAutoSolveAttempts);
    if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.min(3, Math.floor(configured)));
  }
  const raw = process.env['ZARB_SLIDER_AUTO_ATTEMPTS'];
  if (!raw) return 2;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateSliderDragDistance(input: {
  gapX: number;
  originalWidth: number;
  sliderWidth: number;
  travelWidth: number;
}): number {
  const originalWidth = Number(input.originalWidth);
  const sliderWidth = Number(input.sliderWidth);
  const travelWidth = Number(input.travelWidth);
  const gapX = Number(input.gapX);
  if (!Number.isFinite(originalWidth) || !Number.isFinite(sliderWidth) || !Number.isFinite(travelWidth) || !Number.isFinite(gapX)) return 0;
  if (originalWidth <= 1 || travelWidth <= 0) return 0;
  const movableImageWidth = Math.max(1, originalWidth - Math.max(0, sliderWidth));
  const ratio = clamp(gapX / movableImageWidth, 0, 1);
  return clamp(ratio * travelWidth, 0, travelWidth);
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

export function isCaptchaChallengeError(errorMessage: string): boolean {
  return isCaptchaChallengeErrorFromAuth(errorMessage);
}

export function looksLoggedInBySnapshot(snapshot: DomSnapshot): boolean {
  return looksLoggedInBySnapshotFromAuth(snapshot);
}

type AuthGateMode = 'none' | 'skip' | 'replan-continue' | 'replan-plan';

export function resolveAuthGateMode(input: {
  authEstablished: boolean;
  hasAuthError: boolean;
  isOnLoginPage: boolean;
}): AuthGateMode {
  return resolveAuthGateModeFromBrain(input);
}

const SLIDER_HANDLE_SELECTORS = [
  '.verify-move-block',
  '.verify-move',
  '.verify-move-btn',
  '.verify-slider-btn',
  '.geetest_slider_button',
  '.nc_iconfont.btn_slide',
  '[class*="verify"] [class*="move-block"]',
  '[class*="verify"] [class*="move"]',
  '[class*="verify"] [class*="drag"]',
  '[class*="slider"][class*="button"]',
  '[class*="slider"][class*="handle"]',
  '[class*="slider"][class*="btn"]',
];

const SLIDER_TRACK_SELECTORS = [
  '.verify-bar-area',
  '.verify-slider',
  '.geetest_slider',
  '.nc_scale',
  '.verify-con',
  '.verify-content',
  '[class*="slider"][class*="track"]',
  '[class*="verify"][class*="content"]',
];

interface SliderGeometry {
  handleSelector: string;
  trackSelector: string;
  handleBox: { x: number; y: number; width: number; height: number };
  trackBox: { x: number; y: number; width: number; height: number };
  startX: number;
  startY: number;
  travelWidth: number;
}

interface SliderGapDetection {
  gapX: number;
  score: number;
  confidence: number;
  scanY: number;
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
    brainPlan: summarizeBrainPlan(ctx.brainPlan),
    supportedActions: ctx.supportedActions,
  });
}

export function buildExplorationPlanPrompt(ctx: ExplorationPlanPromptContext): string {
  const focusDirectives = summarizeFocusAreas(ctx.config).map((item) => `- ${item}`);
  const loginDetected = pageLooksLikeLogin(ctx.page) || hasAuthNetworkError(ctx.page);
  return renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.explorationPlan, {
    startUrls: ctx.config.startUrls.join(', '),
    allowedHosts: (ctx.config.allowedHosts ?? []).join(', ') || 'derived from start URL',
    currentPage: `${ctx.page.url} (title: "${ctx.page.title}")`,
    observedCounts: `forms=${String(ctx.page.formCount)}, links=${String(ctx.page.linkCount)}, consoleErrors=${String(ctx.page.consoleErrors.length)}, networkErrors=${String(ctx.page.networkErrors.length)}`,
    noScriptSignal: includesNoScriptBanner(ctx.page) ? 'yes' : 'no',
    loginDetected: loginDetected ? 'yes' : 'no',
    authEstablished: ctx.authEstablished ? 'yes' : 'no',
    remainingBudget: `${String(ctx.remainingSteps)} steps, ${String(ctx.remainingPages)} pages`,
    focusAreas: listOrFallback(focusDirectives, '- general exploration'),
    visitedPages: ctx.visited.slice(-12).join(', ') || 'none',
    recentSteps: ctx.recentSteps.length > 0 ? ctx.recentSteps.join(' | ') : 'none',
    recentFindings: ctx.recentFindings.length > 0 ? ctx.recentFindings.join(' | ') : 'none',
    recentToolResults: ctx.recentToolResults.length > 0 ? ctx.recentToolResults.join(' | ') : 'none',
    recentNetworkHighlights: ctx.recentNetworkHighlights.length > 0 ? ctx.recentNetworkHighlights.join(' | ') : 'none',
    stepIndex: String(ctx.stepIndex),
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
  private readonly findingExtractor = new ExplorationFindingExtractor();
  private readonly browserAdapter: ExplorationBrowserAdapter | undefined;
  private readonly brain: ExplorationBrain;
  private readonly authFlow: ExplorationAuthFlow | undefined;

  constructor(
    private readonly db: Db,
    private readonly provider: AIProvider,
    private readonly playwrightProvider?: PlaywrightToolProvider,
  ) {
    this.findings = new FindingRepository(db);
    this.sessionManager = new HarnessSessionManager(db);
    this.credentials = new SiteCredentialRepository(db);
    this.browserAdapter = playwrightProvider ? new PlaywrightExplorationBrowserAdapter(playwrightProvider) : undefined;
    this.brain = new ExplorationBrain(provider, this.sessionManager);
    this.authFlow = this.browserAdapter ? new ExplorationAuthFlow(provider, this.sessionManager, this.browserAdapter) : undefined;
  }

  private async findSliderGeometry(page: import('playwright').Page): Promise<SliderGeometry | undefined> {
    await page.waitForTimeout(300);
    for (const handleSelector of SLIDER_HANDLE_SELECTORS) {
      const handle = page.locator(handleSelector).first();
      const handleVisible = await handle.isVisible({ timeout: 800 }).catch(() => false);
      if (!handleVisible) continue;
      const handleBox = await handle.boundingBox();
      if (!handleBox) continue;
      if (handleBox.width < 10 || handleBox.height < 10) continue;
      if (handleBox.width > 120 || handleBox.height > 120) continue;

      let trackBox: { x: number; y: number; width: number; height: number } | null = null;
      let matchedTrackSelector: string | null = null;
      for (const trackSelector of SLIDER_TRACK_SELECTORS) {
        const track = page.locator(trackSelector).first();
        const trackVisible = await track.isVisible({ timeout: 200 }).catch(() => false);
        if (!trackVisible) continue;
        const box = await track.boundingBox();
        if (!box) continue;
        if (box.width <= handleBox.width + 40) continue;
        const handleCenterY = handleBox.y + handleBox.height / 2;
        const handleCenterX = handleBox.x + handleBox.width / 2;
        const trackCenterY = box.y + box.height / 2;
        const yDiff = Math.abs(handleCenterY - trackCenterY);
        if (handleCenterX < box.x - 24 || handleCenterX > box.x + box.width + 24) continue;
        if (handleCenterX > box.x + box.width * 0.72) continue;
        if (yDiff <= Math.max(40, handleBox.height * 2.2)) {
          trackBox = box;
          matchedTrackSelector = trackSelector;
          break;
        }
      }
      if (!trackBox) continue;

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      const estimatedTravel = Math.max(24, trackBox.width - Math.max(12, handleBox.width) - 8);
      const maxEndX = trackBox.x + trackBox.width - Math.max(6, handleBox.width / 2);
      const endX = Math.max(startX + 24, Math.min(maxEndX, startX + estimatedTravel));
      const travelWidth = Math.max(24, endX - startX);
      return {
        handleSelector,
        trackSelector: matchedTrackSelector ?? '.verify-slider',
        handleBox,
        trackBox,
        startX,
        startY,
        travelWidth,
      };
    }
    return undefined;
  }

  private async dragWithDistance(
    page: import('playwright').Page,
    geometry: SliderGeometry,
    distance: number,
    effectiveTimeMs: number,
  ): Promise<void> {
    const clampedDistance = clamp(distance, 20, geometry.travelWidth);
    const totalMs = clamp(effectiveTimeMs + 140 + Math.floor(Math.random() * 220), 320, 2_400);
    const steps = Math.max(20, Math.min(90, Math.round(totalMs / 18)));
    const avgDelay = totalMs / steps;
    await page.mouse.move(geometry.startX, geometry.startY, { steps: 4 });
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const accel = progress < 0.78
        ? 1 - Math.pow(1 - progress, 2.15)
        : 0.94 + (progress - 0.78) * 0.28;
      const x = geometry.startX + clampedDistance * Math.min(1, accel);
      const wobble = Math.sin(progress * Math.PI * 1.6) * 0.8 + (Math.random() - 0.5) * 0.45;
      await page.mouse.move(x, geometry.startY + wobble, { steps: 1 });
      await page.waitForTimeout(Math.max(4, Math.round(avgDelay + (Math.random() - 0.5) * 5)));
    }
    await page.waitForTimeout(50 + Math.floor(Math.random() * 70));
    await page.mouse.up();
  }

  private async detectSliderGapX(
    page: import('playwright').Page,
    challenge: VerificationChallenge,
  ): Promise<SliderGapDetection | undefined> {
    return page.evaluate(async (payload) => {
      const g = globalThis as unknown as {
        document: {
          createElement: (name: string) => {
            width: number;
            height: number;
            getContext: (kind: string) => {
              drawImage: (...args: unknown[]) => void;
              getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
            } | null;
          };
        };
        Image: new () => {
          src: string;
          crossOrigin?: string;
          naturalWidth?: number;
          naturalHeight?: number;
          width?: number;
          height?: number;
          decode?: () => Promise<void>;
          onload?: () => void;
          onerror?: () => void;
        };
      };

      const normalizeImageSrc = (raw: string): string => {
        if (!raw) return raw;
        if (raw.startsWith('data:image/')) return raw;
        if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw;
        const compact = raw.replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 128) return `data:image/png;base64,${compact}`;
        return raw;
      };

      const waitImageLoad = (image: {
        complete?: boolean;
        naturalWidth?: number;
        onload?: () => void;
        onerror?: () => void;
      }): Promise<void> => new Promise((resolve, reject) => {
        if (image.complete && Number(image.naturalWidth ?? 0) > 0) {
          resolve();
          return;
        }
        const done = (): void => { resolve(); };
        const failed = (): void => { reject(new Error('image load failed')); };
        image.onload = done;
        image.onerror = failed;
      });

      const loadImage = async (srcRaw: string): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> => {
        const src = normalizeImageSrc(srcRaw);
        if (!src) return null;
        const image = new g.Image();
        image.crossOrigin = 'anonymous';
        image.src = src;
        try {
          if (typeof image.decode === 'function') {
            await image.decode();
          } else {
            await waitImageLoad(image);
          }
        } catch {
          try {
            await waitImageLoad(image);
          } catch {
            return null;
          }
        }
        const width = Number(image.naturalWidth ?? image.width ?? 0);
        const height = Number(image.naturalHeight ?? image.height ?? 0);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
        const canvas = g.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        try {
          ctx.drawImage(image as unknown as object, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          return { width, height, data: imageData.data };
        } catch {
          return null;
        }
      };

      const back = await loadImage(payload.backImage);
      const slider = await loadImage(payload.slidingImage);
      if (!back || !slider) return undefined;
      if (back.width < 60 || back.height < 30 || slider.width < 12 || slider.height < 12) return undefined;

      const alphaThreshold = 28;
      const contourPoints: Array<{ x: number; y: number }> = [];
      for (let y = 1; y < slider.height - 1; y++) {
        for (let x = 1; x < slider.width - 1; x++) {
          const idx = (y * slider.width + x) * 4 + 3;
          const alpha = slider.data[idx] ?? 0;
          if (alpha < alphaThreshold) continue;
          const left = slider.data[(y * slider.width + (x - 1)) * 4 + 3] ?? 0;
          const right = slider.data[(y * slider.width + (x + 1)) * 4 + 3] ?? 0;
          const up = slider.data[((y - 1) * slider.width + x) * 4 + 3] ?? 0;
          const down = slider.data[((y + 1) * slider.width + x) * 4 + 3] ?? 0;
          if (left < alphaThreshold || right < alphaThreshold || up < alphaThreshold || down < alphaThreshold) {
            if (((x + y) & 1) === 0) contourPoints.push({ x, y });
          }
        }
      }
      if (contourPoints.length < 30) return undefined;

      const gray = new Float32Array(back.width * back.height);
      for (let y = 0; y < back.height; y++) {
        for (let x = 0; x < back.width; x++) {
          const idx = (y * back.width + x) * 4;
          const r = back.data[idx] ?? 0;
          const gch = back.data[idx + 1] ?? 0;
          const b = back.data[idx + 2] ?? 0;
          gray[y * back.width + x] = 0.299 * r + 0.587 * gch + 0.114 * b;
        }
      }

      const edge = new Float32Array(back.width * back.height);
      for (let y = 1; y < back.height - 1; y++) {
        for (let x = 1; x < back.width - 1; x++) {
          const idx = y * back.width + x;
          const gx =
            -(gray[idx - back.width - 1] ?? 0) - 2 * (gray[idx - 1] ?? 0) - (gray[idx + back.width - 1] ?? 0) +
            (gray[idx - back.width + 1] ?? 0) + 2 * (gray[idx + 1] ?? 0) + (gray[idx + back.width + 1] ?? 0);
          const gy =
            (gray[idx - back.width - 1] ?? 0) + 2 * (gray[idx - back.width] ?? 0) + (gray[idx - back.width + 1] ?? 0) -
            (gray[idx + back.width - 1] ?? 0) - 2 * (gray[idx + back.width] ?? 0) - (gray[idx + back.width + 1] ?? 0);
          edge[idx] = Math.abs(gx) + Math.abs(gy);
        }
      }

      const maxX = back.width - slider.width;
      if (maxX < 0) return undefined;

      const randomY = Number(payload.randomY);
      const preferredY = Number.isFinite(randomY) ? Math.round(randomY) : 0;
      let minY = Math.max(0, preferredY - 10);
      let maxY = Math.min(back.height - slider.height, preferredY + 10);
      if (minY > maxY) {
        minY = 0;
        maxY = Math.max(0, back.height - slider.height);
      }

      let bestX = -1;
      let bestY = minY;
      let bestScore = Number.NEGATIVE_INFINITY;
      let secondBest = Number.NEGATIVE_INFINITY;
      for (let y = minY; y <= maxY; y++) {
        for (let x = 0; x <= maxX; x++) {
          let score = 0;
          for (const point of contourPoints) {
            score += edge[(y + point.y) * back.width + (x + point.x)] ?? 0;
          }
          const normalized = score / contourPoints.length;
          if (normalized > bestScore) {
            secondBest = bestScore;
            bestScore = normalized;
            bestX = x;
            bestY = y;
          } else if (normalized > secondBest) {
            secondBest = normalized;
          }
        }
      }
      if (bestX < 0 || !Number.isFinite(bestScore)) return undefined;
      if (bestScore < 40) return undefined;
      const confidence = bestScore / Math.max(1, secondBest);
      if (!Number.isFinite(confidence) || confidence < 1.01) return undefined;
      return { gapX: bestX, score: bestScore, confidence, scanY: bestY };
    }, {
      backImage: challenge.backImage,
      slidingImage: challenge.slidingImage,
      randomY: challenge.randomY,
    });
  }

  private async dragSliderPrecisely(
    page: import('playwright').Page,
    pw: PlaywrightToolProvider,
    stepLogger: StepLogger,
    loginActionId: string,
    attempt: number,
    attempts: number,
  ): Promise<boolean> {
    const challenge = await pw.getLatestVerificationChallenge(1_600);
    if (!challenge) {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.captcha',
        status: 'warn',
        detail: 'precise slider skipped: verification challenge payload unavailable',
        toolInput: { attempt, attempts, timeoutMs: 1600 },
        actionId: loginActionId,
        tool: 'playwright',
      });
      return false;
    }
    const geometry = await this.findSliderGeometry(page);
    if (!geometry) {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.captcha',
        status: 'warn',
        detail: 'precise slider skipped: draggable handle geometry unavailable',
        toolInput: { attempt, attempts },
        actionId: loginActionId,
        tool: 'playwright',
      });
      return false;
    }
    const detection = await this.detectSliderGapX(page, challenge).catch(() => undefined);
    if (!detection) {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.captcha',
        status: 'warn',
        detail: 'precise slider gap detection unavailable, fallback to heuristic drag',
        toolInput: { attempt, attempts, challenge: { w: challenge.originalWidth, h: challenge.originalHeight, sliderW: challenge.sliderWidth, randomY: challenge.randomY } },
        actionId: loginActionId,
        tool: 'playwright',
      });
      return false;
    }
    const baseDistance = estimateSliderDragDistanceFromAuth({
      gapX: detection.gapX,
      originalWidth: challenge.originalWidth,
      sliderWidth: challenge.sliderWidth,
      travelWidth: geometry.travelWidth,
    });
    const attemptNudges = [0, 4, -4];
    const attemptNudge = attemptNudges[(attempt - 1) % attemptNudges.length] ?? 0;
    const compensation = Math.max(1, Math.min(6, geometry.handleBox.width * 0.08));
    const targetDistance = clamp(baseDistance + compensation + attemptNudge, 20, geometry.travelWidth);
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'login.captcha',
      status: 'pending',
      detail: `precise slider drag prepared distance=${targetDistance.toFixed(1)}px`,
      toolInput: {
        attempt,
        attempts,
        gapX: detection.gapX,
        score: Number(detection.score.toFixed(2)),
        confidence: Number(detection.confidence.toFixed(3)),
        scanY: detection.scanY,
        challenge: {
          originalWidth: challenge.originalWidth,
          sliderWidth: challenge.sliderWidth,
          effectiveTime: challenge.effectiveTime,
        },
        geometry: {
          travelWidth: Number(geometry.travelWidth.toFixed(2)),
          startX: Number(geometry.startX.toFixed(2)),
          startY: Number(geometry.startY.toFixed(2)),
        },
      },
      actionId: loginActionId,
      tool: 'playwright',
    });
    await this.dragWithDistance(page, geometry, targetDistance, challenge.effectiveTime);
    return true;
  }

  private async dragSliderOnce(page: import('playwright').Page): Promise<boolean> {
    const geometry = await this.findSliderGeometry(page);
    if (geometry) {
      await this.dragWithDistance(page, geometry, Math.max(36, geometry.travelWidth - 3), 760);
      return true;
    }

    // Fallback: drag directly on slider track when no handle selector is detectable.
    for (const trackSelector of SLIDER_TRACK_SELECTORS) {
      const track = page.locator(trackSelector).first();
      const visible = await track.isVisible({ timeout: 300 }).catch(() => false);
      if (!visible) continue;
      const box = await track.boundingBox();
      if (!box || box.width < 120 || box.height < 20) continue;
      const startX = box.x + Math.max(4, Math.min(12, box.width * 0.08));
      const startY = box.y + box.height / 2;
      const endX = box.x + box.width - Math.max(10, Math.min(18, box.width * 0.08));
      await page.mouse.move(startX, startY, { steps: 3 });
      await page.mouse.down();
      const steps = 26;
      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const x = startX + (endX - startX) * progress;
        const wobbleY = startY + Math.sin(progress * Math.PI * 1.25) * 0.75 + (Math.random() - 0.5) * 0.35;
        await page.mouse.move(x, wobbleY, { steps: 1 });
        await page.waitForTimeout(8 + Math.floor(Math.random() * 10));
      }
      await page.waitForTimeout(60);
      await page.mouse.up();
      return true;
    }

    return false;
  }

  private async hasVisibleSliderCaptcha(page: import('playwright').Page): Promise<boolean> {
    for (const selector of [...SLIDER_HANDLE_SELECTORS, ...SLIDER_TRACK_SELECTORS]) {
      const visible = await page.locator(selector).first().isVisible({ timeout: 200 }).catch(() => false);
      if (visible) return true;
    }
    const keywordVisible = await page.getByText(/拖动滑块|滑块|验证码|captcha|geetest|verify/i).first().isVisible({ timeout: 250 }).catch(() => false);
    return keywordVisible;
  }

  private async tryAutoSolveSliderCaptcha(
    pw: PlaywrightToolProvider,
    submitSelector: string,
    stepLogger: StepLogger,
    loginActionId: string,
    config?: ExplorationConfig,
  ): Promise<'resolved' | 'retry' | 'failed'> {
    if (!isAutoSliderEnabled(config)) return 'failed';

    const page = pw.getPage();
    const configuredAttempts = config?.captchaAutoSolveAttempts;
    const attempts = configuredAttempts === undefined && !pw.isHeaded()
      ? Math.max(2, getAutoSliderAttempts(config))
      : getAutoSliderAttempts(config);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.captcha',
        status: 'pending',
        detail: `auto slider attempt ${String(attempt)}/${String(attempts)}`,
        toolInput: { submitSelector, attempt, attempts },
        actionId: loginActionId,
        tool: 'playwright',
      });

      let dragged = await this.dragSliderPrecisely(page, pw, stepLogger, loginActionId, attempt, attempts).catch(() => false);
      if (!dragged) {
        dragged = await this.dragSliderOnce(page).catch(() => false);
        if (dragged) {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.captcha',
            status: 'warn',
            detail: 'fallback slider drag used',
            toolInput: { attempt, attempts },
            actionId: loginActionId,
            tool: 'playwright',
          });
        }
      }
      if (!dragged) {
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'login.captcha',
          status: 'warn',
          detail: 'no visible slider handle found',
          toolInput: { attempt, attempts },
          actionId: loginActionId,
          tool: 'playwright',
        });
        continue;
      }

      await page.waitForTimeout(600);
      const blockingPromptVisible = await page
        .getByText(/拖动滑块解锁|请按住滑块|drag the slider|slide to verify/i)
        .first()
        .isVisible({ timeout: 250 })
        .catch(() => false);
      if (blockingPromptVisible) {
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'login.captcha',
          status: 'warn',
          detail: 'slider prompt still visible after drag, retrying',
          toolInput: { attempt, attempts },
          actionId: loginActionId,
          tool: 'playwright',
        });
        continue;
      }
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => undefined),
          page.click(submitSelector, { timeout: 8_000 }),
        ]);
      } catch (e) {
        const submitErr = String(e);
        if (isCaptchaChallengeError(submitErr)) {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.captcha',
            status: 'warn',
            detail: 'slider still blocks submit click',
            toolOutput: { error: submitErr },
            toolInput: { attempt, attempts },
            actionId: loginActionId,
            tool: 'playwright',
          });
          continue;
        }
      }

      const snapshot = await pw.collectDomSnapshot().catch(() => undefined);
      const hasPasswordInput = snapshot?.inputs.some(inp => inp.type === 'password') ?? true;
      if (!hasPasswordInput || (snapshot && !isLoginUrl(snapshot.url))) {
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'login.captcha',
          status: 'ok',
          detail: 'auto slider solved login',
          toolInput: { attempt, attempts },
          actionId: loginActionId,
          tool: 'playwright',
        });
        return 'resolved';
      }

      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.captcha',
        status: 'ok',
        detail: 'slider passed, continue login flow',
        toolInput: { attempt, attempts },
        actionId: loginActionId,
        tool: 'playwright',
      });
      return 'retry';
    }

    return 'failed';
  }

  private async handleCaptchaLoginChallenge(
    pw: PlaywrightToolProvider,
    submitSelector: string,
    stepLogger: StepLogger,
    loginActionId: string,
    config: ExplorationConfig,
    t0: number,
    aiInput: { strategy: string; url: string },
  ): Promise<'resolved' | 'retry' | 'failed'> {
    const autoResult = await this.tryAutoSolveSliderCaptcha(pw, submitSelector, stepLogger, loginActionId, config);
    if (autoResult === 'resolved') {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.verify',
        status: 'ok',
        detail: 'auto slider login completed',
        durationMs: Date.now() - t0,
        toolInput: aiInput,
        toolOutput: { mode: 'auto-slider' },
        actionId: loginActionId,
        tool: 'playwright',
      });
      return 'resolved';
    }
    if (autoResult === 'retry') return 'retry';

    if (pw.isHeaded() && isManualLoginEnabled(config)) {
      const manualTimeoutMs = getManualLoginTimeoutMs(config);
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.manual',
        status: 'pending',
        detail: `captcha detected, waiting manual action up to ${String(manualTimeoutMs)}ms`,
        toolInput: { timeoutMs: manualTimeoutMs },
        toolOutput: { mode: 'headed' },
        actionId: loginActionId,
        tool: 'playwright',
      });
      const manualOk = await this.waitForManualLoginCompletion(pw, manualTimeoutMs);
      if (manualOk) {
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'login.verify',
          status: 'ok',
          detail: 'manual login completed',
          durationMs: Date.now() - t0,
          toolInput: aiInput,
          toolOutput: { mode: 'manual' },
          actionId: loginActionId,
          tool: 'playwright',
        });
        return 'resolved';
      }
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'login.manual',
        status: 'error',
        detail: 'manual login timeout',
        durationMs: Date.now() - t0,
        toolInput: { timeoutMs: manualTimeoutMs },
        actionId: loginActionId,
        tool: 'playwright',
      });
    }
    return 'failed';
  }

  private async waitForManualLoginCompletion(pw: PlaywrightToolProvider, timeoutMs: number): Promise<boolean> {
    const page = pw.getPage();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await pw.collectDomSnapshot().catch(() => undefined);
      if (snapshot && (looksLoggedInBySnapshot(snapshot) || !isLoginUrl(snapshot.url))) return true;
      await page.waitForTimeout(1000);
    }
    return false;
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
        browserMode: config.browserMode ?? 'headless',
        captchaAutoSolve: config.captchaAutoSolve ?? true,
        captchaAutoSolveAttempts: config.captchaAutoSolveAttempts ?? 1,
        manualInterventionOnCaptcha: config.manualInterventionOnCaptcha ?? true,
        manualLoginTimeoutMs: config.manualLoginTimeoutMs ?? 180000,
        promptTemplates: {
          explorationPlan: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
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
    if (this.browserAdapter) {
      try {
        await this.browserAdapter.launch({ headless: config.browserMode !== 'headed' });
        this.browserAdapter.registerTools(registry);
        effectiveProbe = this.browserAdapter.buildProbe();
        activePwProvider = this.browserAdapter as unknown as PlaywrightToolProvider;
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
    let authEstablished = false;
    let activeBrainPlan: ExplorationBrainPlan | undefined;
    let brainPlanStepIndex = -1;
    let forceBrainReplan = true;

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
        const newFindings = this.findingExtractor.extract(runId, pageState, config).filter((finding) => {
          const key = this.findingExtractor.buildDedupeKey(finding);
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

        // Auth gate detection: 401/403 in network errors or redirect to login page.
        // For unauthenticated sessions, let planner/login logic run instead of looping with immediate continue.
        const hasAuthError = hasAuthNetworkError(pageState);
        const isOnLoginPage = isLoginUrl(pageState.url);
        const authGateMode = resolveAuthGateModeFromBrain({ authEstablished, hasAuthError, isOnLoginPage });
        if (authGateMode === 'skip') {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.retry',
            status: 'warn',
            detail: 'already authenticated; skip re-login on login URL without auth errors',
            toolInput: { url: pageState.url, hasAuthError, isOnLoginPage },
            toolOutput: { skipped: true, reason: 'likely llm navigation back to login' },
          });
        } else if (authGateMode === 'replan-continue') {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.retry',
            status: 'warn',
            detail: 'auth gate detected, delegating to brain replanning',
            toolInput: { url: pageState.url, hasAuthError, isOnLoginPage },
            toolOutput: { delegatedToBrain: true },
          });
          currentPage = pageState;
          forceBrainReplan = true;
          noNewFindingsStreak = 0;
          pushRecent(recentToolResults, `auth gate detected => replan (${pageState.url})`);
          continue;
        } else if (authGateMode === 'replan-plan') {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.retry',
            status: 'warn',
            detail: 'auth gate detected, planner will decide login next',
            toolInput: { url: pageState.url, hasAuthError, isOnLoginPage },
            toolOutput: { delegatedToBrain: true, continueLoop: false },
          });
          forceBrainReplan = true;
          noNewFindingsStreak = 0;
          pushRecent(recentToolResults, `auth gate detected => plan-login (${pageState.url})`);
        }

        const shouldPlan = !activeBrainPlan
          || forceBrainReplan
          || stepIndex === 0
          || (stepIndex - brainPlanStepIndex >= 3)
          || noNewFindingsStreak >= 2;
        if (shouldPlan) {
          const planningStart = Date.now();
          const planActionId = `brain-plan-${String(stepIndex)}-${String(planningStart)}`;
          stepLogger.log({
            component: 'ExplorationAgent',
            action: activeBrainPlan ? 'brain.replan' : 'brain.plan',
            status: 'pending',
            detail: `planning from ${pageState.url}`,
            toolInput: {
              currentUrl: pageState.url,
              authEstablished,
              visited: visitedUrls.size,
              noNewFindingsStreak,
              reason: forceBrainReplan ? 'forced' : stepIndex === 0 ? 'first-step' : noNewFindingsStreak >= 2 ? 'stalled' : 'interval',
            },
            actionId: planActionId,
            promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
          });
          activeBrainPlan = await this.brain.planExplorationPhase(
            pageState,
            config,
            stepIndex,
            [...visitedUrls],
            stepLogger,
            session.session_id,
            dataRoot,
            recentSteps,
            recentFindings,
            recentToolResults,
            recentNetworkHighlights,
            authEstablished,
            activeBrainPlan ? 'replan' : 'plan',
            planActionId,
          );
          pushRecent(recentToolResults, `brain ${activeBrainPlan.phase} => ${activeBrainPlan.objective}`);
          brainPlanStepIndex = stepIndex;
          forceBrainReplan = false;
        }

        if (activeBrainPlan?.requiresLogin && !authEstablished) {
          if (!activePwProvider) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'brain.login',
              status: 'warn',
              detail: 'planner requested login but interactive runtime is unavailable',
              toolInput: {
                currentUrl: pageState.url,
                requiresLogin: activeBrainPlan.requiresLogin,
                loginReason: activeBrainPlan.loginReason,
              },
              toolOutput: { skipped: true, reason: 'NO_PLAYWRIGHT_RUNTIME' },
            });
          } else {
            const credentialId = config.credentialId;
            if (!credentialId) {
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'brain.login',
                status: 'error',
                detail: 'planner requested login but no credential configured',
                toolInput: {
                  currentUrl: pageState.url,
                  requiresLogin: activeBrainPlan.requiresLogin,
                  loginReason: activeBrainPlan.loginReason,
                },
                toolOutput: { error: 'LOGIN_CREDENTIAL_REQUIRED' },
              });
              llmError = 'LOGIN_CREDENTIAL_REQUIRED';
              break;
            }
            const cred = this.credentials.findById(credentialId);
            if (!cred) {
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'brain.login',
                status: 'error',
                detail: `credential not found: ${credentialId}`,
                toolInput: { credentialId },
                toolOutput: { error: 'LOGIN_CREDENTIAL_NOT_FOUND' },
              });
              llmError = 'LOGIN_CREDENTIAL_NOT_FOUND';
              break;
            }

            const strategy = config.loginStrategy ?? 'ai';
            const brainLoginActionId = `brain-login-${String(stepIndex)}-${String(Date.now())}`;
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'brain.login',
              status: 'pending',
              detail: `${strategy} login required before exploration`,
              toolInput: {
                strategy,
                currentUrl: pageState.url,
                requiresLogin: activeBrainPlan.requiresLogin,
                loginReason: activeBrainPlan.loginReason,
              },
              actionId: brainLoginActionId,
              tool: 'playwright',
            });

            let loginErr: string | undefined;
            const loginStart = Date.now();
            if (strategy === 'ai') {
              loginErr = this.authFlow
                ? await this.authFlow.runAiLogin(pageState.url, cred, config, stepLogger, session.session_id, dataRoot)
                : 'LOGIN_AI_FAILED';
            } else {
              try {
                await activePwProvider.applyCredential(cred, pageState.url);
              } catch (credErr) {
                const isLoginFailed = credErr instanceof LoginFailedError;
                loginErr = isLoginFailed ? 'LOGIN_FAILED' : 'LOGIN_AI_FAILED';
              }
            }

            if (loginErr) {
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'brain.login',
                status: 'error',
                detail: loginErr,
                durationMs: Date.now() - loginStart,
                toolInput: { strategy, currentUrl: pageState.url },
                toolOutput: { error: loginErr },
                actionId: brainLoginActionId,
                tool: 'playwright',
              });
              llmError = loginErr;
              break;
            }

            authEstablished = true;
            forceBrainReplan = true;
            noNewFindingsStreak = 0;
            const stateResult = await registry.call<PageProbe>('playwright.getState', {}, { sessionId: session.session_id, stepIndex });
            if (stateResult.ok && stateResult.value) {
              pageState = stateResult.value;
              currentPage = stateResult.value;
              if (!visitedUrls.has(pageState.url) && visitedUrls.size < maxPages) visitedUrls.add(pageState.url);
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'state.capture',
                status: 'ok',
                detail: `post-login refresh ${pageState.url}`,
                toolOutput: pageState,
                pageState: buildPageSnapshot(pageState),
                tool: 'playwright',
              });
            } else {
              currentPage = pageState;
            }
            pushRecent(recentToolResults, `brain login(${strategy}) => ok`);
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'brain.login',
              status: 'ok',
              detail: `login completed via ${strategy}`,
              durationMs: Date.now() - loginStart,
              toolInput: { strategy, currentUrl: pageState.url },
              toolOutput: { authEstablished: true, currentUrl: pageState.url },
              actionId: brainLoginActionId,
              tool: 'playwright',
            });
            continue;
          }
        }

        // Ask LLM executor for next action
        const llmStart = Date.now();
        const llmActionId = `llm-${String(llmStart)}`;
        const domSnapshot = activePwProvider ? await activePwProvider.collectDomSnapshot().catch(() => undefined) : undefined;
        const promptContextSummary = summarizePromptContextFromModule({
          page: pageState,
          config,
          stepIndex,
          visited: [...visitedUrls],
          recentSteps,
          recentFindings,
          recentToolResults,
          recentNetworkHighlights,
          ...(activeBrainPlan ? { brainPlan: activeBrainPlan } : {}),
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
          ...(activeBrainPlan ? { reason: `plan=${activeBrainPlan.phase}: ${activeBrainPlan.objective}` } : {}),
        });
        const nextStep = await this.brain.decideNextStep(
          pageState,
          config,
          stepIndex,
          [...visitedUrls],
          stepLogger,
          session.session_id,
          dataRoot,
          llmActionId,
          recentSteps,
          recentFindings,
          recentToolResults,
          recentNetworkHighlights,
          activeBrainPlan,
          domSnapshot,
        );
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
        if (activeBrainPlan && nextStep.action !== 'done' && !activeBrainPlan.preferredActions.includes(nextStep.action)) {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'policy.guard',
            status: 'warn',
            detail: `action ${nextStep.action} outside preferredActions; replanning`,
            toolInput: { action: nextStep.action, preferredActions: activeBrainPlan.preferredActions },
            reason: nextStep.reasoning,
          });
          forceBrainReplan = true;
          currentPage = pageState;
          noNewFindingsStreak = 0;
          pushRecent(recentToolResults, `policy rejected action ${nextStep.action}`);
          continue;
        }
        if (nextStep.action === 'done') break;
        if (nextStep.action === 'navigate' && nextStep.targetUrl) {
          if (normalizeUrlForDecision(nextStep.targetUrl) === normalizeUrlForDecision(pageState.url)) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'navigate',
              status: 'warn',
              detail: `skip self navigation target ${nextStep.targetUrl}`,
              toolInput: { currentUrl: pageState.url, targetUrl: nextStep.targetUrl },
              toolOutput: { skipped: true, reason: 'same-url navigation has no new coverage' },
              reason: nextStep.reasoning,
              tool: 'playwright',
            });
            currentPage = pageState;
            forceBrainReplan = true;
            pushRecent(recentToolResults, `skip self navigate ${nextStep.targetUrl}`);
          } else if (activeBrainPlan?.avoidUrls.includes(nextStep.targetUrl)) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'policy.guard',
              status: 'warn',
              detail: `planner blocked navigate target ${nextStep.targetUrl}`,
              toolInput: { targetUrl: nextStep.targetUrl, avoidUrls: activeBrainPlan.avoidUrls },
              toolOutput: { policy: 'avoidUrls' },
              reason: nextStep.reasoning,
            });
            const alternative = activeBrainPlan.candidateUrls.find((url) => !visitedUrls.has(url));
            if (alternative) {
              if (!visitedUrls.has(alternative)) pendingUrls.unshift(alternative);
              pushRecent(recentToolResults, `policy reroute => ${alternative}`);
            } else {
              pushRecent(recentToolResults, 'policy blocked navigate with no alternative');
            }
            currentPage = pageState;
            forceBrainReplan = true;
            noNewFindingsStreak = 0;
            continue;
          } else {
            const targetIsLoginPage = isLoginUrl(nextStep.targetUrl);
            const currentHasAuthError = hasAuthNetworkError(pageState);
            if (authEstablished && targetIsLoginPage && !currentHasAuthError) {
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'navigate',
                status: 'warn',
                detail: `skip navigation back to login after successful auth: ${nextStep.targetUrl}`,
                toolInput: { fromUrl: pageState.url, targetUrl: nextStep.targetUrl },
                toolOutput: { skipped: true, reason: 'avoid relogin loop' },
                reason: nextStep.reasoning,
                tool: 'playwright',
              });
              currentPage = pageState;
              noNewFindingsStreak = 0;
              forceBrainReplan = true;
              pushRecent(recentToolResults, `skip navigate to login ${nextStep.targetUrl}`);
            } else {
              if (!visitedUrls.has(nextStep.targetUrl)) pendingUrls.unshift(nextStep.targetUrl);
              currentPage = undefined;
            }
          }
        } else if ((nextStep.action === 'click' || nextStep.action === 'fill') && activePwProvider && nextStep.selector) {
          const resolvedSelector = normalizeActionSelector(nextStep.action, nextStep.selector);
          const liveStateBeforeAction = await registry.call<PageProbe>('playwright.getState', {}, { sessionId: session.session_id, stepIndex });
          if (liveStateBeforeAction.ok && liveStateBeforeAction.value) {
            const live = liveStateBeforeAction.value;
            const urlDrifted = normalizeUrlForDecision(live.url) !== normalizeUrlForDecision(pageState.url);
            const selectorCount = await activePwProvider.getPage().locator(resolvedSelector).count().catch(() => 0);
            const selectorMissing = selectorCount === 0;
            if (urlDrifted || selectorMissing) {
              currentPage = live;
              if (!visitedUrls.has(currentPage.url) && visitedUrls.size < maxPages) visitedUrls.add(currentPage.url);
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'state.capture',
                status: 'warn',
                detail: `state drift before ${nextStep.action}, replanning`,
                toolInput: { expectedUrl: pageState.url, selector: nextStep.selector, resolvedSelector },
                toolOutput: { actualUrl: live.url, urlDrifted, selectorMissing },
                pageState: buildPageSnapshot(currentPage),
                tool: 'playwright',
              });
              noNewFindingsStreak = 0;
              forceBrainReplan = true;
              pushRecent(recentToolResults, `state drift => ${currentPage.url}`);
              continue;
            }
          }

          const actionStart = Date.now();
          const actionId = `pw-${nextStep.action}-${String(stepIndex)}-${String(actionStart)}`;
          const toolName = nextStep.action === 'click' ? 'playwright.click' : 'playwright.fill';
          const toolInput = nextStep.action === 'click'
            ? { selector: resolvedSelector }
            : { selector: resolvedSelector, value: nextStep.value ?? '' };
          stepLogger.log({
            component: 'ExplorationAgent',
            action: nextStep.action,
            detail: resolvedSelector,
            status: 'pending',
            toolInput: { ...toolInput, originalSelector: nextStep.selector },
            actionId,
            ...(nextStep.reasoning ? { reason: nextStep.reasoning } : {}),
            tool: 'playwright',
          });
          const actionResult = await registry.call<Record<string, unknown>>(toolName, toolInput, { sessionId: session.session_id, stepIndex });
          if (!actionResult.ok) {
            stepLogger.log({ component: 'ExplorationAgent', action: nextStep.action, detail: resolvedSelector, status: 'error', durationMs: Date.now() - actionStart, toolInput: { ...toolInput, originalSelector: nextStep.selector }, toolOutput: { error: actionResult.error }, reason: nextStep.reasoning, actionId, tool: 'playwright' });
            const recoverState = await registry.call<PageProbe>('playwright.getState', {}, { sessionId: session.session_id, stepIndex });
            if (recoverState.ok && recoverState.value) {
              currentPage = recoverState.value;
              if (!visitedUrls.has(currentPage.url) && visitedUrls.size < maxPages) visitedUrls.add(currentPage.url);
              stepLogger.log({
                component: 'ExplorationAgent',
                action: 'state.capture',
                status: 'warn',
                detail: `action failed, replanning from live page ${currentPage.url}`,
                toolOutput: currentPage,
                pageState: buildPageSnapshot(currentPage),
                tool: 'playwright',
              });
              noNewFindingsStreak = 0;
              forceBrainReplan = true;
              pushRecent(recentToolResults, `${nextStep.action} ${resolvedSelector} => failed, replan ${currentPage.url}`);
              continue;
            }
            currentPage = undefined;
            break;
          }
          pushRecent(recentSteps, `${nextStep.action} ${resolvedSelector}`);
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
            pushRecent(recentToolResults, `${nextStep.action} ${resolvedSelector} => ${currentPage.title || currentPage.url}`);
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
            detail: resolvedSelector,
            status: 'ok',
            durationMs: Date.now() - actionStart,
            toolInput: { ...toolInput, originalSelector: nextStep.selector },
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

  private async planExplorationPhase(
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
    const prompt = buildExplorationPlanPromptFromModule({
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
    brainPlan?: ExplorationBrainPlan,
    domSnapshot?: DomSnapshot,
  ): Promise<ExplorationStep> {
    const prompt = buildExplorationDecisionPromptFromModule({
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
    const promptContextSummary = summarizePromptContextFromModule({
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
    config: ExplorationConfig,
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
      if (looksLoggedInBySnapshot(snapshot) && i > 0) {
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.verify', status: 'ok', detail: 'login indicators cleared in live snapshot', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { url: snapshot.url, title: snapshot.title }, actionId: loginActionId, tool: 'playwright' });
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

      if (!decision.isLoginPage) {
        const liveSnapshot = await pw.collectDomSnapshot().catch(() => snapshot);
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'login.verify',
          status: 'ok',
          detail: decision.reasoning ?? 'LLM says login page gone',
          durationMs: Date.now() - t0,
          toolInput: aiInput,
          toolOutput: { url: liveSnapshot.url, reasoning: decision.reasoning },
          actionId: loginActionId,
          tool: 'playwright',
        });
        return undefined;
      }

      if (decision.action === 'done') {
        const liveSnapshot = await pw.collectDomSnapshot().catch(() => snapshot);
        const stillLooksLikeLogin = isLoginUrl(liveSnapshot.url) || liveSnapshot.inputs.some((inp) => inp.type === 'password');
        if (stillLooksLikeLogin) {
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.retry',
            status: 'warn',
            detail: 'LLM returned done but page still looks like login; retrying',
            toolInput: { url: liveSnapshot.url, decision },
            tool: 'playwright',
          });
          await pw.getPage().waitForTimeout(600);
          continue;
        }
        stepLogger.log({
          component: 'ExplorationAgent',
          action: 'login.verify',
          status: 'ok',
          detail: decision.reasoning ?? 'LLM done and login indicators cleared',
          durationMs: Date.now() - t0,
          toolInput: aiInput,
          toolOutput: { url: liveSnapshot.url, reasoning: decision.reasoning },
          actionId: loginActionId,
          tool: 'playwright',
        });
        return undefined;
      }

      if (decision.action === 'fill' && decision.selector) {
        const isPassword = decision.value === '__PASSWORD__';
        const actualValue = isPassword ? (cred.password ?? '') : (decision.value ?? '');
        const logValue = isPassword ? '[REDACTED]' : (decision.value ?? '');
        const fillStart = Date.now();
        try {
          const page = pw.getPage();
          const liveBeforeFill = await pw.collectDomSnapshot().catch(() => snapshot);
          if (looksLoggedInBySnapshot(liveBeforeFill)) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.verify',
              status: 'ok',
              detail: 'login completed before fill action',
              durationMs: Date.now() - t0,
              toolInput: aiInput,
              toolOutput: { url: liveBeforeFill.url, mode: 'state-drift' },
              actionId: loginActionId,
              tool: 'playwright',
            });
            return undefined;
          }
          const fillSelectorCount = await page.locator(decision.selector).count().catch(() => 0);
          if (fillSelectorCount === 0) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.retry',
              status: 'warn',
              detail: `fill selector missing before action, re-evaluating: ${decision.selector}`,
              toolInput: { selector: decision.selector },
              toolOutput: { url: liveBeforeFill.url },
              tool: 'playwright',
            });
            await page.waitForTimeout(300);
            continue;
          }
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
          const liveBeforeClick = await pw.collectDomSnapshot().catch(() => snapshot);
          if (looksLoggedInBySnapshot(liveBeforeClick)) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.verify',
              status: 'ok',
              detail: 'login completed before click action',
              durationMs: Date.now() - t0,
              toolInput: aiInput,
              toolOutput: { url: liveBeforeClick.url, mode: 'state-drift' },
              actionId: loginActionId,
              tool: 'playwright',
            });
            return undefined;
          }
          const clickSelectorCount = await page.locator(decision.selector).count().catch(() => 0);
          if (clickSelectorCount === 0) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.retry',
              status: 'warn',
              detail: `click selector missing before action, re-evaluating: ${decision.selector}`,
              toolInput: { selector: decision.selector },
              toolOutput: { url: liveBeforeClick.url },
              tool: 'playwright',
            });
            await page.waitForTimeout(300);
            continue;
          }
          const beforeUrl = page.url();
          await page.click(decision.selector, { timeout: 10_000 });
          await Promise.race([
            page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 4_000 }).catch(() => undefined),
            page.waitForTimeout(450),
          ]);
          pushRecent(recentLoginActions, `click ${decision.selector}`, 10);
          const liveAfterClick = await pw.collectDomSnapshot().catch(() => snapshot);
          stepLogger.log({
            component: 'ExplorationAgent',
            action: 'login.click',
            status: 'ok',
            detail: `selector=${decision.selector}`,
            durationMs: Date.now() - clickStart,
            toolInput: { selector: decision.selector },
            toolOutput: { ok: true, url: liveAfterClick.url },
            tool: 'playwright',
            ...(decision.reasoning ? { reason: decision.reasoning } : {}),
          });
          if (looksLoggedInBySnapshot(liveAfterClick)) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.verify',
              status: 'ok',
              detail: 'login indicators cleared after click',
              durationMs: Date.now() - t0,
              toolInput: aiInput,
              toolOutput: { url: liveAfterClick.url, mode: 'post-click-check' },
              actionId: loginActionId,
              tool: 'playwright',
            });
            return undefined;
          }

          const captchaVisible = await this.hasVisibleSliderCaptcha(page).catch(() => false);
          if (captchaVisible) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.captcha',
              status: 'pending',
              detail: 'slider challenge visible after submit click',
              toolInput: { selector: decision.selector, url: liveAfterClick.url },
              actionId: loginActionId,
              tool: 'playwright',
            });
            const captchaResult = await this.handleCaptchaLoginChallenge(
              pw,
              decision.selector,
              stepLogger,
              loginActionId,
              config,
              t0,
              aiInput,
            );
            if (captchaResult === 'resolved') return undefined;
            if (captchaResult === 'retry') {
              pushRecent(recentLoginActions, 'captcha auto-solved, retry login', 10);
              continue;
            }
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.failed',
              status: 'error',
              detail: 'captcha challenge blocks automated login',
              durationMs: Date.now() - t0,
              toolInput: aiInput,
              toolOutput: { error: 'CAPTCHA_VISIBLE_AFTER_CLICK' },
              actionId: loginActionId,
              tool: 'playwright',
            });
            return 'LOGIN_CAPTCHA_REQUIRED';
          }
        } catch (e) {
          const clickError = String(e);
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.click', status: 'error', detail: clickError, durationMs: Date.now() - clickStart, toolInput: { selector: decision.selector }, toolOutput: { error: clickError }, tool: 'playwright' });
          if (isCaptchaChallengeError(clickError)) {
            const captchaResult = await this.handleCaptchaLoginChallenge(
              pw,
              decision.selector,
              stepLogger,
              loginActionId,
              config,
              t0,
              aiInput,
            );
            if (captchaResult === 'resolved') {
              return undefined;
            }
            if (captchaResult === 'retry') {
              pushRecent(recentLoginActions, 'captcha auto-solved, retry login', 10);
              continue;
            }
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.failed',
              status: 'error',
              detail: 'captcha challenge blocks automated login',
              durationMs: Date.now() - t0,
              toolInput: aiInput,
              toolOutput: { error: clickError },
              actionId: loginActionId,
              tool: 'playwright',
            });
            return 'LOGIN_CAPTCHA_REQUIRED';
          }
          const liveAfterError = await pw.collectDomSnapshot().catch(() => undefined);
          if (liveAfterError && looksLoggedInBySnapshot(liveAfterError)) {
            stepLogger.log({
              component: 'ExplorationAgent',
              action: 'login.verify',
              status: 'ok',
              detail: 'login succeeded despite click error',
              durationMs: Date.now() - t0,
              toolInput: aiInput,
              toolOutput: { url: liveAfterError.url, mode: 'post-error-check', clickError },
              actionId: loginActionId,
              tool: 'playwright',
            });
            return undefined;
          }
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
