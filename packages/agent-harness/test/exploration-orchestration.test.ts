import { describe, expect, it } from 'vitest';
import type { ExplorationConfig } from '@zarb/shared-types';
import { HARNESS_TEMPLATE_VERSIONS } from '../src/prompt-loader.js';
import {
  applyPreferredActionGuard,
  buildExplorationDecisionContext,
  buildExplorationContextRefs,
  buildExplorationPolicy,
  createExplorationSessionStep,
  createExplorationLoopState,
  getExplorationPlanningReason,
} from '../src/exploration/orchestration.js';
import type { ExplorationStep, PageProbe } from '../src/exploration/types.js';

function makePage(url = 'https://example.com/dashboard'): PageProbe {
  return {
    url,
    title: 'Dashboard',
    consoleErrors: [],
    networkErrors: [],
    formCount: 1,
    linkCount: 4,
  };
}

describe('exploration orchestration helpers', () => {
  it('builds exploration policy from config and allowed hosts', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com'],
      maxSteps: 7,
      maxPages: 3,
    };

    expect(buildExplorationPolicy(config, ['example.com'])).toEqual({
      sessionBudgetMs: 210000,
      toolCallTimeoutMs: 30000,
      allowedHosts: ['example.com'],
      allowedWriteScopes: [],
      requireApprovalFor: [],
      reviewOnVerifyFailureAllowed: false,
    });
  });

  it('builds context refs with stable defaults', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com'],
      maxSteps: 5,
      maxPages: 2,
    };

    expect(buildExplorationContextRefs(config, ['example.com'])).toEqual({
      startUrls: ['https://example.com'],
      allowedHosts: ['example.com'],
      maxSteps: 5,
      maxPages: 2,
      approxTokenBudget: 10000,
      enableAutoCompact: true,
      maxCompactions: 1,
      focusAreas: [],
      credentialId: null,
      loginStrategy: 'none',
      browserMode: 'headless',
      captchaAutoSolve: true,
      captchaAutoSolveAttempts: 1,
      manualInterventionOnCaptcha: true,
      manualLoginTimeoutMs: 180000,
      promptTemplates: {
        explorationPlan: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
        explorationDecision: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
        explorationLogin: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
      },
    });
  });

  it('creates initial loop state from config', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com', 'https://example.com/admin'],
      maxSteps: 9,
      maxPages: 4,
    };

    expect(createExplorationLoopState(config)).toEqual({
      maxSteps: 9,
      maxPages: 4,
      visitedUrls: new Set<string>(),
      pendingUrls: ['https://example.com', 'https://example.com/admin'],
      recentSteps: [],
      recentFindings: [],
      recentToolResults: [],
      recentNetworkHighlights: [],
      seenFindingKeys: new Set<string>(),
      currentPage: undefined,
      stepIndex: 0,
      noNewFindingsStreak: 0,
      totalFindings: 0,
      llmError: undefined,
      authEstablished: false,
      activeBrainPlan: undefined,
      brainPlanStepIndex: -1,
      forceBrainReplan: true,
      tokenBudget: 10000,
      enableAutoCompact: true,
      usedTokens: 0,
      compactionsUsed: 0,
      maxCompactions: 1,
      compactCarryover: undefined,
    });
  });

  it('computes planning reason from loop state signals', () => {
    expect(getExplorationPlanningReason({
      hasActiveBrainPlan: false,
      forceBrainReplan: false,
      stepIndex: 0,
      brainPlanStepIndex: -1,
      noNewFindingsStreak: 0,
    })).toBe('first-step');

    expect(getExplorationPlanningReason({
      hasActiveBrainPlan: true,
      forceBrainReplan: true,
      stepIndex: 4,
      brainPlanStepIndex: 3,
      noNewFindingsStreak: 0,
    })).toBe('forced');

    expect(getExplorationPlanningReason({
      hasActiveBrainPlan: true,
      forceBrainReplan: false,
      stepIndex: 5,
      brainPlanStepIndex: 2,
      noNewFindingsStreak: 0,
    })).toBe('interval');

    expect(getExplorationPlanningReason({
      hasActiveBrainPlan: true,
      forceBrainReplan: false,
      stepIndex: 2,
      brainPlanStepIndex: 1,
      noNewFindingsStreak: 2,
    })).toBe('stalled');

    expect(getExplorationPlanningReason({
      hasActiveBrainPlan: true,
      forceBrainReplan: false,
      stepIndex: 2,
      brainPlanStepIndex: 1,
      noNewFindingsStreak: 0,
    })).toBeNull();
  });

  it('builds decision context from loop state and runtime capabilities', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com'],
      maxSteps: 6,
      maxPages: 3,
      focusAreas: ['navigation', 'forms'],
    };
    const state = createExplorationLoopState(config);
    state.stepIndex = 2;
    state.visitedUrls.add('https://example.com');
    state.recentSteps.push('navigate https://example.com');
    state.recentFindings.push('console-error: boom');
    state.recentToolResults.push('navigate => Dashboard');
    state.recentNetworkHighlights.push('GET document status=200 https://example.com (50ms)');
    state.activeBrainPlan = {
      phase: 'explore',
      objective: 'cover main app paths',
      reasoning: 'normal exploration',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: ['https://example.com/reports'],
      avoidUrls: [],
      preferredActions: ['click', 'navigate', 'done'],
    };

    const context = buildExplorationDecisionContext({
      pageState: makePage(),
      config,
      state,
      interactiveAvailable: true,
    });

    expect(context.supportedActions).toBe('"click"|"fill"|"navigate"|"done"');
    expect(context.remainingSteps).toBe(4);
    expect(context.remainingPages).toBe(2);
    expect(context.brainPlan?.objective).toBe('cover main app paths');
    expect(context.recentFindings).toEqual(['console-error: boom']);
    expect(context.compactCarryover).toBeUndefined();
  });

  it('applies preferred action guard and triggers replanning for unsupported action', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com'],
      maxSteps: 6,
      maxPages: 3,
    };
    const state = createExplorationLoopState(config);
    state.activeBrainPlan = {
      phase: 'explore',
      objective: 'stay on guided path',
      reasoning: 'planner guidance',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: [],
      avoidUrls: [],
      preferredActions: ['navigate', 'done'],
    };
    const pageState = makePage();
    const nextStep: ExplorationStep = {
      stepIndex: 2,
      action: 'click',
      selector: 'button:Save',
      reasoning: 'try submit',
    };
    const logs: Array<Record<string, unknown>> = [];

    const result = applyPreferredActionGuard({
      nextStep,
      pageState,
      state,
      stepLogger: { log: (entry) => logs.push(entry) },
    });

    expect(result).toBe('continue');
    expect(state.forceBrainReplan).toBe(true);
    expect(state.currentPage).toEqual(pageState);
    expect(state.noNewFindingsStreak).toBe(0);
    expect(state.recentToolResults.at(-1)).toBe('policy rejected action click');
    expect(logs.at(-1)).toEqual(expect.objectContaining({
      action: 'policy.guard',
      status: 'warn',
    }));
  });

  it('creates a stable session step record from page and findings', () => {
    const step = createExplorationSessionStep({
      stepIndex: 3,
      nextStep: {
        stepIndex: 3,
        action: 'navigate',
        targetUrl: 'https://example.com/reports',
        reasoning: 'go to reports',
      },
      pageState: {
        ...makePage('https://example.com/reports'),
        consoleErrors: ['TypeError'],
        networkErrors: [{ url: 'https://example.com/api/reports', status: 500 }],
      },
      findingCount: 2,
      timestamp: '2026-04-04T10:00:00.000Z',
    });

    expect(step).toEqual({
      stepIndex: 3,
      description: 'navigate: https://example.com/reports',
      outcome: 'findings: 2, errors: 2',
      timestamp: '2026-04-04T10:00:00.000Z',
    });
  });
});
