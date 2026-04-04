import { describe, expect, it, vi } from 'vitest';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { SaveFindingInput } from '@zarb/storage';
import { LoginFailedError } from '../src/playwright-tool-provider.js';
import { createExplorationLoopState } from '../src/exploration/orchestration.js';
import {
  handleAuthGate,
  handleInteractiveAction,
  handleNavigateDecision,
  handleNavigationPass,
  handleRequiredLogin,
  persistPageFindings,
} from '../src/exploration/execution.js';
import type { ExplorationStep } from '../src/exploration/types.js';
import type { PageProbe } from '../src/exploration/types.js';

function makePage(url = 'https://example.com/login'): PageProbe {
  return {
    url,
    title: 'Login',
    consoleErrors: [],
    networkErrors: [],
    formCount: 1,
    linkCount: 0,
  };
}

function makeConfig(overrides: Partial<ExplorationConfig> = {}): ExplorationConfig {
  return {
    startUrls: ['https://example.com/login'],
    maxSteps: 5,
    maxPages: 3,
    loginStrategy: 'ai',
    credentialId: 'cred-1',
    ...overrides,
  };
}

function makeCredential() {
  return {
    id: 'cred-1',
    site_id: 'site-1',
    label: 'Default',
    auth_type: 'userpass',
    login_url: 'https://example.com/login',
    username_selector: null,
    password_selector: null,
    submit_selector: null,
    username: 'demo',
    password: 'secret',
    cookies_json: null,
    headers_json: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('handleRequiredLogin', () => {
  it('returns noop when interactive runtime is unavailable', async () => {
    const state = createExplorationLoopState(makeConfig());
    state.activeBrainPlan = {
      phase: 'bootstrap',
      objective: 'login first',
      reasoning: 'need auth',
      requiresLogin: true,
      loginReason: 'login page detected',
      candidateUrls: [],
      avoidUrls: [],
      preferredActions: ['fill', 'click', 'done'],
    };

    const result = await handleRequiredLogin({
      activePwProvider: null,
      authFlow: undefined,
      findCredentialById: () => makeCredential(),
      registry: { call: vi.fn() },
      config: makeConfig(),
      pageState: makePage(),
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
    });

    expect(result.outcome).toBe('noop');
    expect(state.llmError).toBeUndefined();
  });

  it('returns break when credential config is missing', async () => {
    const state = createExplorationLoopState(makeConfig({ credentialId: undefined }));
    state.activeBrainPlan = {
      phase: 'bootstrap',
      objective: 'login first',
      reasoning: 'need auth',
      requiresLogin: true,
      loginReason: 'login page detected',
      candidateUrls: [],
      avoidUrls: [],
      preferredActions: ['fill', 'click', 'done'],
    };

    const result = await handleRequiredLogin({
      activePwProvider: { applyCredential: vi.fn() },
      authFlow: undefined,
      findCredentialById: () => undefined,
      registry: { call: vi.fn() },
      config: makeConfig({ credentialId: undefined }),
      pageState: makePage(),
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
    });

    expect(result.outcome).toBe('break');
    expect(state.llmError).toBe('LOGIN_CREDENTIAL_REQUIRED');
  });

  it('returns break when static credential apply fails verification', async () => {
    const state = createExplorationLoopState(makeConfig({ loginStrategy: 'static' }));
    state.activeBrainPlan = {
      phase: 'bootstrap',
      objective: 'login first',
      reasoning: 'need auth',
      requiresLogin: true,
      loginReason: 'login page detected',
      candidateUrls: [],
      avoidUrls: [],
      preferredActions: ['fill', 'click', 'done'],
    };

    const result = await handleRequiredLogin({
      activePwProvider: {
        applyCredential: vi.fn(async () => { throw new LoginFailedError('bad login'); }),
      },
      authFlow: undefined,
      findCredentialById: () => makeCredential(),
      registry: { call: vi.fn() },
      config: makeConfig({ loginStrategy: 'static' }),
      pageState: makePage(),
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
    });

    expect(result.outcome).toBe('break');
    expect(state.llmError).toBe('LOGIN_FAILED');
  });

  it('returns continue after successful ai login and refreshes page state', async () => {
    const state = createExplorationLoopState(makeConfig());
    state.activeBrainPlan = {
      phase: 'bootstrap',
      objective: 'login first',
      reasoning: 'need auth',
      requiresLogin: true,
      loginReason: 'login page detected',
      candidateUrls: [],
      avoidUrls: [],
      preferredActions: ['fill', 'click', 'done'],
    };
    state.stepIndex = 2;
    const refreshed = makePage('https://example.com/dashboard');
    refreshed.title = 'Dashboard';
    refreshed.formCount = 0;
    refreshed.linkCount = 4;

    const result = await handleRequiredLogin({
      activePwProvider: { applyCredential: vi.fn() },
      authFlow: {
        runAiLogin: vi.fn(async () => undefined),
      },
      findCredentialById: () => makeCredential(),
      registry: {
        call: vi.fn(async () => ({
          ok: true,
          value: refreshed,
          record: {
            sessionId: 'sess-1',
            stepIndex: 2,
            toolName: 'playwright.getState',
            inputSummary: '{}',
            resultSummary: '{}',
            durationMs: 1,
            status: 'ok' as const,
          },
        })),
      },
      config: makeConfig(),
      pageState: makePage(),
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
    });

    expect(result).toEqual({ outcome: 'continue', pageState: refreshed });
    expect(state.authEstablished).toBe(true);
    expect(state.currentPage).toEqual(refreshed);
    expect(state.visitedUrls.has('https://example.com/dashboard')).toBe(true);
    expect(state.recentToolResults.at(-1)).toBe('brain login(ai) => ok');
  });
});

describe('handleInteractiveAction', () => {
  function makeStep(overrides: Partial<ExplorationStep> = {}): ExplorationStep {
    return {
      stepIndex: 0,
      action: 'click',
      selector: 'button:Save',
      reasoning: 'try save',
      ...overrides,
    };
  }

  it('returns continue when live state drift requires replanning', async () => {
    const state = createExplorationLoopState(makeConfig());
    state.stepIndex = 1;
    const live = makePage('https://example.com/dashboard');
    live.title = 'Dashboard';

    const result = await handleInteractiveAction({
      activePwProvider: {
        getPage: () => ({ locator: () => ({ count: async () => 0 }) }),
        getRecentNetworkHighlights: () => [],
      },
      registry: {
        call: vi.fn(async () => ({
          ok: true,
          value: live,
          record: {
            sessionId: 'sess-1',
            stepIndex: 1,
            toolName: 'playwright.getState',
            inputSummary: '{}',
            resultSummary: '{}',
            durationMs: 1,
            status: 'ok' as const,
          },
        })),
      },
      nextStep: makeStep(),
      pageState: makePage('https://example.com/settings'),
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
    });

    expect(result.outcome).toBe('continue');
    expect(state.currentPage).toEqual(live);
    expect(state.forceBrainReplan).toBe(true);
    expect(state.recentToolResults.at(-1)).toBe('state drift => https://example.com/dashboard');
  });

  it('returns continue when action fails but recover state is available', async () => {
    const state = createExplorationLoopState(makeConfig());
    const pageState = makePage('https://example.com/settings');
    pageState.title = 'Settings';
    const recovered = makePage('https://example.com/settings');
    recovered.title = 'Settings';

    let callIndex = 0;
    const result = await handleInteractiveAction({
      activePwProvider: {
        getPage: () => ({ locator: () => ({ count: async () => 1 }) }),
        getRecentNetworkHighlights: () => [],
      },
      registry: {
        call: vi.fn(async () => {
          callIndex += 1;
          if (callIndex === 1) {
            return {
              ok: true,
              value: pageState,
              record: { sessionId: 'sess-1', stepIndex: 0, toolName: 'playwright.getState', inputSummary: '{}', resultSummary: '{}', durationMs: 1, status: 'ok' as const },
            };
          }
          if (callIndex === 2) {
            return {
              ok: false,
              error: 'click failed',
              record: { sessionId: 'sess-1', stepIndex: 0, toolName: 'playwright.click', inputSummary: '{}', resultSummary: 'click failed', durationMs: 1, status: 'error' as const },
            };
          }
          return {
            ok: true,
            value: recovered,
            record: { sessionId: 'sess-1', stepIndex: 0, toolName: 'playwright.getState', inputSummary: '{}', resultSummary: '{}', durationMs: 1, status: 'ok' as const },
          };
        }),
      },
      nextStep: makeStep(),
      pageState,
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
    });

    expect(result.outcome).toBe('continue');
    expect(state.currentPage).toEqual(recovered);
    expect(state.recentToolResults.at(-1)).toContain('failed, replan');
  });

  it('returns handled when action succeeds and post-state is collected', async () => {
    const state = createExplorationLoopState(makeConfig());
    const pageState = makePage('https://example.com/settings');
    pageState.title = 'Settings';
    const updated = makePage('https://example.com/dashboard');
    updated.title = 'Dashboard';
    updated.formCount = 0;
    updated.linkCount = 4;

    let callIndex = 0;
    const result = await handleInteractiveAction({
      activePwProvider: {
        getPage: () => ({ locator: () => ({ count: async () => 1 }) }),
        getRecentNetworkHighlights: () => ['GET fetch status=200 https://example.com/api/save (40ms)'],
      },
      registry: {
        call: vi.fn(async () => {
          callIndex += 1;
          if (callIndex === 1) {
            return {
              ok: true,
              value: pageState,
              record: { sessionId: 'sess-1', stepIndex: 0, toolName: 'playwright.getState', inputSummary: '{}', resultSummary: '{}', durationMs: 1, status: 'ok' as const },
            };
          }
          if (callIndex === 2) {
            return {
              ok: true,
              value: { ok: true },
              record: { sessionId: 'sess-1', stepIndex: 0, toolName: 'playwright.click', inputSummary: '{}', resultSummary: '{}', durationMs: 1, status: 'ok' as const },
            };
          }
          return {
            ok: true,
            value: updated,
            record: { sessionId: 'sess-1', stepIndex: 0, toolName: 'playwright.getState', inputSummary: '{}', resultSummary: '{}', durationMs: 1, status: 'ok' as const },
          };
        }),
      },
      nextStep: makeStep(),
      pageState,
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
    });

    expect(result.outcome).toBe('handled');
    expect(state.currentPage).toEqual(updated);
    expect(state.recentSteps.at(-1)).toBe('click button:has-text("Save")');
    expect(state.recentToolResults.at(-1)).toBe('click button:has-text("Save") => Dashboard');
    expect(state.recentNetworkHighlights.at(-1)).toBe('GET fetch status=200 https://example.com/api/save (40ms)');
  });
});

describe('handleAuthGate', () => {
  it('returns pass when page is not behind an auth gate', () => {
    const state = createExplorationLoopState(makeConfig());
    const pageState = makePage('https://example.com/dashboard');
    pageState.title = 'Dashboard';
    pageState.formCount = 0;
    pageState.linkCount = 4;

    const result = handleAuthGate({
      pageState,
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result).toBe('pass');
    expect(state.forceBrainReplan).toBe(true);
    expect(state.recentToolResults).toEqual([]);
  });

  it('skips relogin loop when already authenticated on login page without auth errors', () => {
    const state = createExplorationLoopState(makeConfig());
    state.authEstablished = true;
    const logger = { log: vi.fn() };

    const result = handleAuthGate({
      pageState: makePage('https://example.com/login'),
      state,
      stepLogger: logger,
    });

    expect(result).toBe('pass');
    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'login.retry',
      status: 'warn',
      toolOutput: { skipped: true, reason: 'likely llm navigation back to login' },
    }));
  });

  it('forces replan and continues when authenticated session hits auth error', () => {
    const state = createExplorationLoopState(makeConfig());
    state.authEstablished = true;
    state.noNewFindingsStreak = 2;
    const pageState = makePage('https://example.com/dashboard');
    pageState.networkErrors = [{ url: 'https://example.com/api/me', status: 401 }];

    const result = handleAuthGate({
      pageState,
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result).toBe('continue');
    expect(state.currentPage).toEqual(pageState);
    expect(state.forceBrainReplan).toBe(true);
    expect(state.noNewFindingsStreak).toBe(0);
    expect(state.recentToolResults.at(-1)).toBe('auth gate detected => replan (https://example.com/dashboard)');
  });

  it('delegates to planner when unauthenticated session reaches login gate', () => {
    const state = createExplorationLoopState(makeConfig());
    state.noNewFindingsStreak = 2;
    const logger = { log: vi.fn() };

    const result = handleAuthGate({
      pageState: makePage('https://example.com/login'),
      state,
      stepLogger: logger,
    });

    expect(result).toBe('pass');
    expect(state.forceBrainReplan).toBe(true);
    expect(state.noNewFindingsStreak).toBe(0);
    expect(state.recentToolResults.at(-1)).toBe('auth gate detected => plan-login (https://example.com/login)');
    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'login.retry',
      status: 'warn',
      toolOutput: { delegatedToBrain: true, continueLoop: false },
    }));
  });
});

describe('handleNavigationPass', () => {
  it('navigates with playwright and records recent context', async () => {
    const state = createExplorationLoopState(makeConfig());
    state.stepIndex = 1;
    const pageState = makePage('https://example.com/dashboard');
    pageState.title = 'Dashboard';
    pageState.formCount = 0;
    pageState.linkCount = 4;

    const result = await handleNavigationPass({
      activePwProvider: {
        getRecentNetworkHighlights: () => ['GET document status=200 https://example.com/dashboard (55ms)'],
      },
      registry: {
        call: vi.fn(async () => ({
          ok: true,
          value: pageState,
          record: {
            sessionId: 'sess-1',
            stepIndex: 1,
            toolName: 'playwright.navigate',
            inputSummary: '{}',
            resultSummary: '{}',
            durationMs: 1,
            status: 'ok' as const,
          },
        })),
      },
      effectiveProbe: vi.fn(),
      state,
      stepLogger: { log: vi.fn() },
      sessionId: 'sess-1',
    });

    expect(result).toEqual({ outcome: 'navigated', pageState });
    expect(state.visitedUrls.has('https://example.com/dashboard')).toBe(true);
    expect(state.recentSteps.at(-1)).toBe('navigate https://example.com/dashboard');
    expect(state.recentToolResults.at(-1)).toBe('navigate => Dashboard forms=0 links=4');
    expect(state.recentNetworkHighlights.at(-1)).toBe('GET document status=200 https://example.com/dashboard (55ms)');
  });

  it('skips when navigation fails', async () => {
    const state = createExplorationLoopState(makeConfig());
    state.stepIndex = 2;
    const logger = { log: vi.fn() };

    const result = await handleNavigationPass({
      activePwProvider: {
        getRecentNetworkHighlights: () => [],
      },
      registry: {
        call: vi.fn(async () => ({
          ok: false,
          error: 'nav failed',
          record: {
            sessionId: 'sess-1',
            stepIndex: 2,
            toolName: 'playwright.navigate',
            inputSummary: '{}',
            resultSummary: 'nav failed',
            durationMs: 1,
            status: 'error' as const,
          },
        })),
      },
      effectiveProbe: vi.fn(),
      state,
      stepLogger: logger,
      sessionId: 'sess-1',
    });

    expect(result.outcome).toBe('skip');
    expect(state.visitedUrls.size).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'navigate',
      status: 'error',
    }));
  });
});

describe('persistPageFindings', () => {
  it('dedupes extracted findings and persists only new ones', () => {
    const state = createExplorationLoopState(makeConfig());
    state.seenFindingKeys.add('console-error:medium:https://example.com/page:boom');
    const pageState = makePage('https://example.com/page');
    const saved: SaveFindingInput[] = [];
    const findingA: SaveFindingInput = {
      id: 'f-1',
      runId: 'run-1',
      category: 'console-error',
      severity: 'medium',
      pageUrl: 'https://example.com/page',
      title: 'Console error',
      summary: 'boom',
      createdAt: new Date().toISOString(),
    };
    const findingB: SaveFindingInput = {
      id: 'f-2',
      runId: 'run-1',
      category: 'network-error',
      severity: 'high',
      pageUrl: 'https://example.com/page',
      title: 'HTTP 500',
      summary: 'https://example.com/api returned 500',
      createdAt: new Date().toISOString(),
    };

    const result = persistPageFindings({
      config: makeConfig(),
      findingExtractor: {
        extract: vi.fn(() => [findingA, findingB]),
        buildDedupeKey: (finding) => `${finding.category}:${finding.severity}:${finding.pageUrl ?? ''}:${finding.summary}`,
      },
      findings: { save: vi.fn((finding: SaveFindingInput) => saved.push(finding)) },
      pageState,
      runId: 'run-1',
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result).toEqual([findingB]);
    expect(saved).toEqual([findingB]);
    expect(state.totalFindings).toBe(1);
    expect(state.recentFindings).toEqual(['network-error: https://example.com/api returned 500']);
    expect(state.seenFindingKeys.has('network-error:high:https://example.com/page:https://example.com/api returned 500')).toBe(true);
  });
});

describe('handleNavigateDecision', () => {
  function makeStep(overrides: Partial<ExplorationStep> = {}): ExplorationStep {
    return {
      stepIndex: 0,
      action: 'navigate',
      targetUrl: 'https://example.com/dashboard',
      reasoning: 'move forward',
      ...overrides,
    };
  }

  it('marks same-url navigation for replanning', () => {
    const state = createExplorationLoopState(makeConfig());
    const pageState = makePage('https://example.com/dashboard');

    const result = handleNavigateDecision({
      nextStep: makeStep(),
      pageState,
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result.outcome).toBe('handled');
    expect(state.currentPage).toEqual(pageState);
    expect(state.forceBrainReplan).toBe(true);
    expect(state.recentToolResults.at(-1)).toBe('skip self navigate https://example.com/dashboard');
  });

  it('reroutes blocked navigate target to planner candidate', () => {
    const state = createExplorationLoopState(makeConfig());
    state.activeBrainPlan = {
      phase: 'explore',
      objective: 'stay in app',
      reasoning: 'avoid logout',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: ['https://example.com/reports'],
      avoidUrls: ['https://example.com/logout'],
      preferredActions: ['navigate', 'done'],
    };
    const pageState = makePage('https://example.com/dashboard');

    const result = handleNavigateDecision({
      nextStep: makeStep({ targetUrl: 'https://example.com/logout' }),
      pageState,
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result.outcome).toBe('continue');
    expect(state.pendingUrls[0]).toBe('https://example.com/reports');
    expect(state.currentPage).toEqual(pageState);
    expect(state.forceBrainReplan).toBe(true);
    expect(state.recentToolResults.at(-1)).toBe('policy reroute => https://example.com/reports');
  });

  it('avoids navigating back to login after auth is established', () => {
    const state = createExplorationLoopState(makeConfig());
    state.authEstablished = true;
    const pageState = makePage('https://example.com/dashboard');
    pageState.networkErrors = [];

    const result = handleNavigateDecision({
      nextStep: makeStep({ targetUrl: 'https://example.com/login' }),
      pageState,
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result.outcome).toBe('handled');
    expect(state.currentPage).toEqual(pageState);
    expect(state.forceBrainReplan).toBe(true);
    expect(state.recentToolResults.at(-1)).toBe('skip navigate to login https://example.com/login');
  });

  it('queues new target url and clears current page for next pass', () => {
    const state = createExplorationLoopState(makeConfig());
    state.currentPage = makePage('https://example.com/dashboard');
    const pageState = makePage('https://example.com/dashboard');

    const result = handleNavigateDecision({
      nextStep: makeStep({ targetUrl: 'https://example.com/reports' }),
      pageState,
      state,
      stepLogger: { log: vi.fn() },
    });

    expect(result.outcome).toBe('handled');
    expect(state.pendingUrls[0]).toBe('https://example.com/reports');
    expect(state.currentPage).toBeUndefined();
  });
});
