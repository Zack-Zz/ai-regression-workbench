import type { ExplorationConfig } from '@zarb/shared-types';
import type { SaveFindingInput, SiteCredentialRow } from '@zarb/storage';
import { isLoginUrl, LoginFailedError, type PlaywrightToolProvider } from '../playwright-tool-provider.js';
import type { ToolCallResult, ToolRegistry } from '../runtime/tool-registry.js';
import type { ExplorationLoopState } from './orchestration.js';
import { normalizeActionSelector, normalizeUrlForDecision } from './action-utils.js';
import { resolveAuthGateMode } from './brain.js';
import { hasAuthNetworkError } from './heuristics.js';
import { buildPageSnapshot } from './page-state.js';
import { pushRecent } from './recent-context.js';
import type { ExplorationStep, PageProbe } from './types.js';

interface StepLoggerLike {
  log(entry: Record<string, unknown>): void;
}

interface ExplorationAuthFlowLike {
  runAiLogin(
    startUrl: string,
    cred: SiteCredentialRow,
    config: ExplorationConfig,
    stepLogger: StepLoggerLike,
    sessionId: string,
    dataRoot: string,
  ): Promise<string | undefined>;
}

interface InteractivePwProviderLike {
  getPage(): {
    locator(selector: string): {
      count(): Promise<number>;
    };
  };
  getRecentNetworkHighlights(limit?: number): string[];
}

interface NavigationPwProviderLike {
  getRecentNetworkHighlights(limit?: number): string[];
}

interface FindingExtractorLike {
  extract(runId: string, page: PageProbe, config: ExplorationConfig): SaveFindingInput[];
  buildDedupeKey(finding: Pick<SaveFindingInput, 'category' | 'severity' | 'pageUrl' | 'summary'>): string;
}

interface FindingRepositoryLike {
  save(input: SaveFindingInput): void;
}

interface RequiredLoginInput {
  activePwProvider: Pick<PlaywrightToolProvider, 'applyCredential'> | null;
  authFlow: ExplorationAuthFlowLike | undefined;
  findCredentialById: (credentialId: string) => SiteCredentialRow | undefined;
  registry: Pick<ToolRegistry, 'call'>;
  config: ExplorationConfig;
  pageState: PageProbe;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
  sessionId: string;
  dataRoot: string;
}

type RequiredLoginResult =
  | { outcome: 'noop'; pageState: PageProbe }
  | { outcome: 'break'; pageState: PageProbe }
  | { outcome: 'continue'; pageState: PageProbe };

interface InteractiveActionInput {
  activePwProvider: InteractivePwProviderLike | null;
  registry: Pick<ToolRegistry, 'call'>;
  nextStep: ExplorationStep;
  pageState: PageProbe;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
  sessionId: string;
}

type InteractiveActionResult =
  | { outcome: 'unhandled' }
  | { outcome: 'continue' }
  | { outcome: 'break' }
  | { outcome: 'handled' };

interface NavigationPassInput {
  activePwProvider: NavigationPwProviderLike | null;
  registry: Pick<ToolRegistry, 'call'>;
  effectiveProbe: (url: string) => Promise<PageProbe>;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
  sessionId: string;
}

type NavigationPassResult =
  | { outcome: 'skip' }
  | { outcome: 'navigated'; pageState: PageProbe };

interface PersistPageFindingsInput {
  config: ExplorationConfig;
  findingExtractor: FindingExtractorLike;
  findings: FindingRepositoryLike;
  pageState: PageProbe;
  runId: string;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
}

interface AuthGateInput {
  pageState: PageProbe;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
}

interface NavigateDecisionInput {
  nextStep: ExplorationStep;
  pageState: PageProbe;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
}

type NavigateDecisionResult =
  | { outcome: 'unhandled' }
  | { outcome: 'continue' }
  | { outcome: 'handled' };

export async function handleRequiredLogin(input: RequiredLoginInput): Promise<RequiredLoginResult> {
  const {
    activePwProvider,
    authFlow,
    findCredentialById,
    registry,
    config,
    pageState,
    state,
    stepLogger,
    sessionId,
    dataRoot,
  } = input;

  if (!state.activeBrainPlan?.requiresLogin || state.authEstablished) {
    return { outcome: 'noop', pageState };
  }

  if (!activePwProvider) {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'brain.login',
      status: 'warn',
      detail: 'planner requested login but interactive runtime is unavailable',
      toolInput: {
        currentUrl: pageState.url,
        requiresLogin: state.activeBrainPlan.requiresLogin,
        loginReason: state.activeBrainPlan.loginReason,
      },
      toolOutput: { skipped: true, reason: 'NO_PLAYWRIGHT_RUNTIME' },
    });
    return { outcome: 'noop', pageState };
  }

  const credentialId = config.credentialId;
  if (!credentialId) {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'brain.login',
      status: 'error',
      detail: 'planner requested login but no credential configured',
      toolInput: {
        currentUrl: pageState.url,
        requiresLogin: state.activeBrainPlan.requiresLogin,
        loginReason: state.activeBrainPlan.loginReason,
      },
      toolOutput: { error: 'LOGIN_CREDENTIAL_REQUIRED' },
    });
    state.llmError = 'LOGIN_CREDENTIAL_REQUIRED';
    return { outcome: 'break', pageState };
  }

  const cred = findCredentialById(credentialId);
  if (!cred) {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'brain.login',
      status: 'error',
      detail: `credential not found: ${credentialId}`,
      toolInput: { credentialId },
      toolOutput: { error: 'LOGIN_CREDENTIAL_NOT_FOUND' },
    });
    state.llmError = 'LOGIN_CREDENTIAL_NOT_FOUND';
    return { outcome: 'break', pageState };
  }

  const strategy = config.loginStrategy ?? 'ai';
  const brainLoginActionId = `brain-login-${String(state.stepIndex)}-${String(Date.now())}`;
  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'brain.login',
    status: 'pending',
    detail: `${strategy} login required before exploration`,
    toolInput: {
      strategy,
      currentUrl: pageState.url,
      requiresLogin: state.activeBrainPlan.requiresLogin,
      loginReason: state.activeBrainPlan.loginReason,
    },
    actionId: brainLoginActionId,
    tool: 'playwright',
  });

  let loginErr: string | undefined;
  const loginStart = Date.now();
  if (strategy === 'ai') {
    loginErr = authFlow
      ? await authFlow.runAiLogin(pageState.url, cred, config, stepLogger, sessionId, dataRoot)
      : 'LOGIN_AI_FAILED';
  } else {
    try {
      await activePwProvider.applyCredential(cred, pageState.url);
    } catch (credErr) {
      loginErr = credErr instanceof LoginFailedError ? 'LOGIN_FAILED' : 'LOGIN_AI_FAILED';
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
    state.llmError = loginErr;
    return { outcome: 'break', pageState };
  }

  state.authEstablished = true;
  state.forceBrainReplan = true;
  state.noNewFindingsStreak = 0;

  const stateResult = await registry.call<PageProbe>('playwright.getState', {}, {
    sessionId,
    stepIndex: state.stepIndex,
  }) as ToolCallResult<PageProbe>;

  let nextPageState = pageState;
  if (stateResult.ok && stateResult.value) {
    nextPageState = stateResult.value;
    state.currentPage = stateResult.value;
    if (!state.visitedUrls.has(nextPageState.url) && state.visitedUrls.size < state.maxPages) {
      state.visitedUrls.add(nextPageState.url);
    }
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'state.capture',
      status: 'ok',
      detail: `post-login refresh ${nextPageState.url}`,
      toolOutput: nextPageState,
      pageState: buildPageSnapshot(nextPageState),
      tool: 'playwright',
    });
  } else {
    state.currentPage = pageState;
  }

  pushRecent(state.recentToolResults, `brain login(${strategy}) => ok`);
  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'brain.login',
    status: 'ok',
    detail: `login completed via ${strategy}`,
    durationMs: Date.now() - loginStart,
    toolInput: { strategy, currentUrl: pageState.url },
    toolOutput: { authEstablished: true, currentUrl: nextPageState.url },
    actionId: brainLoginActionId,
    tool: 'playwright',
  });

  return { outcome: 'continue', pageState: nextPageState };
}

export async function handleNavigationPass(input: NavigationPassInput): Promise<NavigationPassResult> {
  const {
    activePwProvider,
    registry,
    effectiveProbe,
    state,
    stepLogger,
    sessionId,
  } = input;

  const url = state.pendingUrls.shift();
  if (!url || state.visitedUrls.has(url)) {
    return { outcome: 'skip' };
  }

  const navStart = Date.now();
  const navActionId = `pw-nav-${String(state.stepIndex)}-${String(navStart)}`;
  let pageState: PageProbe;

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
    const result = await registry.call<PageProbe>('playwright.navigate', { url }, {
      sessionId,
      stepIndex: state.stepIndex,
    }) as ToolCallResult<PageProbe>;
    if (!result.ok || !result.value) {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'navigate',
        detail: url,
        status: 'error',
        durationMs: Date.now() - navStart,
        toolInput: { url },
        actionId: navActionId,
        toolOutput: { error: result.error },
        tool: 'playwright',
      });
      return { outcome: 'skip' };
    }
    pageState = result.value;
  } else {
    try {
      pageState = await effectiveProbe(url);
    } catch {
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'navigate',
        detail: url,
        status: 'error',
        durationMs: Date.now() - navStart,
        toolInput: { url },
        tool: 'fetch',
      });
      return { outcome: 'skip' };
    }
  }

  state.visitedUrls.add(pageState.url);
  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'navigate',
    detail: url,
    status: 'ok',
    durationMs: Date.now() - navStart,
    toolInput: { url },
    toolOutput: pageState,
    ...(activePwProvider ? { actionId: navActionId } : {}),
    pageState: buildPageSnapshot(pageState),
    tool: activePwProvider ? 'playwright' : 'fetch',
  });
  pushRecent(state.recentSteps, `navigate ${pageState.url}`);
  pushRecent(
    state.recentToolResults,
    `navigate => ${pageState.title || pageState.url} forms=${String(pageState.formCount)} links=${String(pageState.linkCount)}`,
  );
  if (activePwProvider) {
    for (const highlight of activePwProvider.getRecentNetworkHighlights(3)) {
      pushRecent(state.recentNetworkHighlights, highlight, 6);
    }
  }

  return { outcome: 'navigated', pageState };
}

export function persistPageFindings(input: PersistPageFindingsInput): SaveFindingInput[] {
  const {
    config,
    findingExtractor,
    findings,
    pageState,
    runId,
    state,
    stepLogger,
  } = input;

  const newFindings = findingExtractor.extract(runId, pageState, config).filter((finding) => {
    const key = findingExtractor.buildDedupeKey(finding);
    if (state.seenFindingKeys.has(key)) {
      return false;
    }
    state.seenFindingKeys.add(key);
    return true;
  });

  for (const finding of newFindings) {
    findings.save(finding);
    state.totalFindings += 1;
  }

  if (newFindings.length > 0) {
    for (const finding of newFindings.map((item) => `${item.category}: ${item.summary}`)) {
      pushRecent(state.recentFindings, finding);
    }
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'findings',
      status: 'ok',
      detail: `${String(newFindings.length)} findings on ${pageState.url}`,
      toolOutput: newFindings.map((item) => ({
        category: item.category,
        severity: item.severity,
        title: item.title,
        summary: item.summary,
      })),
    });
  }

  return newFindings;
}

export function handleAuthGate(input: AuthGateInput): 'pass' | 'continue' {
  const { pageState, state, stepLogger } = input;
  const hasAuthError = hasAuthNetworkError(pageState);
  const isOnLoginPage = isLoginUrl(pageState.url);
  const authGateMode = resolveAuthGateMode({
    authEstablished: state.authEstablished,
    hasAuthError,
    isOnLoginPage,
  });

  if (authGateMode === 'none') {
    return 'pass';
  }

  if (authGateMode === 'skip') {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'login.retry',
      status: 'warn',
      detail: 'already authenticated; skip re-login on login URL without auth errors',
      toolInput: { url: pageState.url, hasAuthError, isOnLoginPage },
      toolOutput: { skipped: true, reason: 'likely llm navigation back to login' },
    });
    return 'pass';
  }

  if (authGateMode === 'replan-continue') {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'login.retry',
      status: 'warn',
      detail: 'auth gate detected, delegating to brain replanning',
      toolInput: { url: pageState.url, hasAuthError, isOnLoginPage },
      toolOutput: { delegatedToBrain: true },
    });
    state.currentPage = pageState;
    state.forceBrainReplan = true;
    state.noNewFindingsStreak = 0;
    pushRecent(state.recentToolResults, `auth gate detected => replan (${pageState.url})`);
    return 'continue';
  }

  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'login.retry',
    status: 'warn',
    detail: 'auth gate detected, planner will decide login next',
    toolInput: { url: pageState.url, hasAuthError, isOnLoginPage },
    toolOutput: { delegatedToBrain: true, continueLoop: false },
  });
  state.forceBrainReplan = true;
  state.noNewFindingsStreak = 0;
  pushRecent(state.recentToolResults, `auth gate detected => plan-login (${pageState.url})`);
  return 'pass';
}

export function handleNavigateDecision(input: NavigateDecisionInput): NavigateDecisionResult {
  const { nextStep, pageState, state, stepLogger } = input;

  if (nextStep.action !== 'navigate' || !nextStep.targetUrl) {
    return { outcome: 'unhandled' };
  }

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
    state.currentPage = pageState;
    state.forceBrainReplan = true;
    pushRecent(state.recentToolResults, `skip self navigate ${nextStep.targetUrl}`);
    return { outcome: 'handled' };
  }

  if (state.activeBrainPlan?.avoidUrls.includes(nextStep.targetUrl)) {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'policy.guard',
      status: 'warn',
      detail: `planner blocked navigate target ${nextStep.targetUrl}`,
      toolInput: { targetUrl: nextStep.targetUrl, avoidUrls: state.activeBrainPlan.avoidUrls },
      toolOutput: { policy: 'avoidUrls' },
      reason: nextStep.reasoning,
    });
    const alternative = state.activeBrainPlan.candidateUrls.find((url) => !state.visitedUrls.has(url));
    if (alternative) {
      if (!state.visitedUrls.has(alternative)) {
        state.pendingUrls.unshift(alternative);
      }
      pushRecent(state.recentToolResults, `policy reroute => ${alternative}`);
    } else {
      pushRecent(state.recentToolResults, 'policy blocked navigate with no alternative');
    }
    state.currentPage = pageState;
    state.forceBrainReplan = true;
    state.noNewFindingsStreak = 0;
    return { outcome: 'continue' };
  }

  const targetIsLoginPage = isLoginUrl(nextStep.targetUrl);
  const currentHasAuthError = hasAuthNetworkError(pageState);
  if (state.authEstablished && targetIsLoginPage && !currentHasAuthError) {
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
    state.currentPage = pageState;
    state.noNewFindingsStreak = 0;
    state.forceBrainReplan = true;
    pushRecent(state.recentToolResults, `skip navigate to login ${nextStep.targetUrl}`);
    return { outcome: 'handled' };
  }

  if (!state.visitedUrls.has(nextStep.targetUrl)) {
    state.pendingUrls.unshift(nextStep.targetUrl);
  }
  state.currentPage = undefined;
  return { outcome: 'handled' };
}

export async function handleInteractiveAction(input: InteractiveActionInput): Promise<InteractiveActionResult> {
  const {
    activePwProvider,
    registry,
    nextStep,
    pageState,
    state,
    stepLogger,
    sessionId,
  } = input;

  if ((nextStep.action !== 'click' && nextStep.action !== 'fill') || !nextStep.selector) {
    return { outcome: 'unhandled' };
  }

  if (!activePwProvider) {
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
    state.currentPage = undefined;
    return { outcome: 'handled' };
  }

  const resolvedSelector = normalizeActionSelector(nextStep.action, nextStep.selector);
  const liveStateBeforeAction = await registry.call<PageProbe>('playwright.getState', {}, {
    sessionId,
    stepIndex: state.stepIndex,
  }) as ToolCallResult<PageProbe>;

  if (liveStateBeforeAction.ok && liveStateBeforeAction.value) {
    const live = liveStateBeforeAction.value;
    const urlDrifted = normalizeUrlForDecision(live.url) !== normalizeUrlForDecision(pageState.url);
    const selectorCount = await activePwProvider.getPage().locator(resolvedSelector).count().catch(() => 0);
    const selectorMissing = selectorCount === 0;
    if (urlDrifted || selectorMissing) {
      state.currentPage = live;
      if (!state.visitedUrls.has(state.currentPage.url) && state.visitedUrls.size < state.maxPages) {
        state.visitedUrls.add(state.currentPage.url);
      }
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'state.capture',
        status: 'warn',
        detail: `state drift before ${nextStep.action}, replanning`,
        toolInput: { expectedUrl: pageState.url, selector: nextStep.selector, resolvedSelector },
        toolOutput: { actualUrl: live.url, urlDrifted, selectorMissing },
        pageState: buildPageSnapshot(state.currentPage),
        tool: 'playwright',
      });
      state.noNewFindingsStreak = 0;
      state.forceBrainReplan = true;
      pushRecent(state.recentToolResults, `state drift => ${state.currentPage.url}`);
      return { outcome: 'continue' };
    }
  }

  const actionStart = Date.now();
  const actionId = `pw-${nextStep.action}-${String(state.stepIndex)}-${String(actionStart)}`;
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

  const actionResult = await registry.call<Record<string, unknown>>(toolName, toolInput, {
    sessionId,
    stepIndex: state.stepIndex,
  });
  if (!actionResult.ok) {
    stepLogger.log({
      component: 'ExplorationAgent',
      action: nextStep.action,
      detail: resolvedSelector,
      status: 'error',
      durationMs: Date.now() - actionStart,
      toolInput: { ...toolInput, originalSelector: nextStep.selector },
      toolOutput: { error: actionResult.error },
      reason: nextStep.reasoning,
      actionId,
      tool: 'playwright',
    });
    const recoverState = await registry.call<PageProbe>('playwright.getState', {}, {
      sessionId,
      stepIndex: state.stepIndex,
    }) as ToolCallResult<PageProbe>;
    if (recoverState.ok && recoverState.value) {
      state.currentPage = recoverState.value;
      if (!state.visitedUrls.has(state.currentPage.url) && state.visitedUrls.size < state.maxPages) {
        state.visitedUrls.add(state.currentPage.url);
      }
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'state.capture',
        status: 'warn',
        detail: `action failed, replanning from live page ${state.currentPage.url}`,
        toolOutput: state.currentPage,
        pageState: buildPageSnapshot(state.currentPage),
        tool: 'playwright',
      });
      state.noNewFindingsStreak = 0;
      state.forceBrainReplan = true;
      pushRecent(state.recentToolResults, `${nextStep.action} ${resolvedSelector} => failed, replan ${state.currentPage.url}`);
      return { outcome: 'continue' };
    }
    state.currentPage = undefined;
    return { outcome: 'break' };
  }

  pushRecent(state.recentSteps, `${nextStep.action} ${resolvedSelector}`);
  const stateStart = Date.now();
  const stateActionId = `pw-get-state-${String(state.stepIndex)}-${String(stateStart)}`;
  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'state.capture',
    status: 'pending',
    detail: 'playwright.getState',
    toolInput: {},
    actionId: stateActionId,
    tool: 'playwright',
  });
  const stateResult = await registry.call<PageProbe>('playwright.getState', {}, {
    sessionId,
    stepIndex: state.stepIndex,
  }) as ToolCallResult<PageProbe>;
  if (!stateResult.ok) {
    state.currentPage = undefined;
    pushRecent(state.recentToolResults, `${nextStep.action} ${nextStep.selector} => state unavailable`);
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
    state.currentPage = stateResult.value!;
    if (!state.visitedUrls.has(state.currentPage.url) && state.visitedUrls.size < state.maxPages) {
      state.visitedUrls.add(state.currentPage.url);
    }
    pushRecent(state.recentToolResults, `${nextStep.action} ${resolvedSelector} => ${state.currentPage.title || state.currentPage.url}`);
    for (const highlight of activePwProvider.getRecentNetworkHighlights(3)) {
      pushRecent(state.recentNetworkHighlights, highlight, 6);
    }
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'state.capture',
      status: 'ok',
      detail: state.currentPage.url,
      durationMs: Date.now() - stateStart,
      toolInput: {},
      toolOutput: state.currentPage,
      pageState: buildPageSnapshot(state.currentPage),
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
    ...(state.currentPage ? { pageState: buildPageSnapshot(state.currentPage) } : {}),
    ...(nextStep.reasoning ? { reason: nextStep.reasoning } : {}),
    actionId,
    tool: 'playwright',
  });

  return { outcome: 'handled' };
}
