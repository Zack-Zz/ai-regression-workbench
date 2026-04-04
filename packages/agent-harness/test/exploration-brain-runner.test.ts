import { describe, expect, it, vi } from 'vitest';
import type { ExplorationConfig } from '@zarb/shared-types';
import { createExplorationLoopState } from '../src/exploration/orchestration.js';
import { runExplorationDecision, runExplorationPlanning } from '../src/exploration/brain-runner.js';
import type { ExplorationBrainPlan, ExplorationStep, PageProbe } from '../src/exploration/types.js';

function makeConfig(overrides: Partial<ExplorationConfig> = {}): ExplorationConfig {
  return {
    startUrls: ['https://example.com/dashboard'],
    maxSteps: 6,
    maxPages: 3,
    ...overrides,
  };
}

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

describe('runExplorationPlanning', () => {
  it('logs planning and updates loop state from returned brain plan', async () => {
    const config = makeConfig();
    const state = createExplorationLoopState(config);
    state.stepIndex = 2;
    state.forceBrainReplan = true;
    state.recentSteps.push('navigate https://example.com/dashboard');
    state.compactCarryover = 'Compacted exploration history at step 1.';
    const pageState = makePage();
    const plan: ExplorationBrainPlan = {
      phase: 'explore',
      objective: 'cover reports flow',
      reasoning: 'continue deeper',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: ['https://example.com/reports'],
      avoidUrls: ['https://example.com/logout'],
      preferredActions: ['click', 'navigate', 'done'],
    };
    const logs: Array<Record<string, unknown>> = [];
    const brain = {
      planExplorationPhase: vi.fn(async () => plan),
    };

    const result = await runExplorationPlanning({
      brain,
      pageState,
      config,
      planningReason: 'forced',
      state,
      stepLogger: { log: (entry) => logs.push(entry) },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
    });

    expect(result).toEqual(plan);
    expect(state.activeBrainPlan).toEqual(plan);
    expect(state.brainPlanStepIndex).toBe(2);
    expect(state.forceBrainReplan).toBe(false);
    expect(state.recentToolResults.at(-1)).toBe('brain explore => cover reports flow');
    expect(logs[0]).toEqual(expect.objectContaining({
      action: 'brain.plan',
      status: 'pending',
    }));
    expect(brain.planExplorationPhase).toHaveBeenCalledWith(
      pageState,
      config,
      2,
      [],
      expect.any(Object),
      'sess-1',
      '/tmp',
      ['navigate https://example.com/dashboard'],
      [],
      ['brain explore => cover reports flow'],
      [],
      false,
      'plan',
      'Compacted exploration history at step 1.',
      expect.any(String),
    );
  });
});

describe('runExplorationDecision', () => {
  it('logs pending and ok entries around brain decision', async () => {
    const config = makeConfig();
    const state = createExplorationLoopState(config);
    state.stepIndex = 1;
    state.visitedUrls.add('https://example.com/dashboard');
    state.recentToolResults.push('navigate => Dashboard');
    state.compactCarryover = 'Compacted exploration history at step 0.';
    state.activeBrainPlan = {
      phase: 'explore',
      objective: 'open reports',
      reasoning: 'follow nav',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: ['https://example.com/reports'],
      avoidUrls: [],
      preferredActions: ['click', 'navigate', 'done'],
    };
    const pageState = makePage();
    const nextStep: ExplorationStep = {
      stepIndex: 1,
      action: 'navigate',
      targetUrl: 'https://example.com/reports',
      reasoning: 'reports is the next unexplored area',
    };
    const logs: Array<Record<string, unknown>> = [];
    const brain = {
      decideNextStep: vi.fn(async () => nextStep),
    };

    const result = await runExplorationDecision({
      brain,
      pageState,
      config,
      state,
      stepLogger: { log: (entry) => logs.push(entry) },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
      providerModel: 'gpt-test',
      interactiveAvailable: true,
      collectDomSnapshot: vi.fn(async () => undefined),
    });

    expect(result).toEqual(nextStep);
    expect(brain.decideNextStep).toHaveBeenCalledWith(
      pageState,
      config,
      1,
      ['https://example.com/dashboard'],
      expect.any(Object),
      'sess-1',
      '/tmp',
      expect.any(String),
      [],
      [],
      ['navigate => Dashboard'],
      [],
      state.activeBrainPlan,
      undefined,
      'Compacted exploration history at step 0.',
    );
    expect(logs[0]).toEqual(expect.objectContaining({
      action: 'llm.decide',
      status: 'pending',
    }));
    expect(logs[1]).toEqual(expect.objectContaining({
      action: 'llm.decide',
      status: 'ok',
      toolOutput: {
        action: 'navigate',
        targetUrl: 'https://example.com/reports',
        selector: undefined,
      },
      model: 'gpt-test',
    }));
  });

  it('returns llm error step without emitting success log', async () => {
    const config = makeConfig();
    const state = createExplorationLoopState(config);
    const pageState = makePage();
    const logs: Array<Record<string, unknown>> = [];

    const result = await runExplorationDecision({
      brain: {
        decideNextStep: vi.fn(async () => ({
          stepIndex: 0,
          action: 'done',
          reasoning: 'LLM unavailable',
          llmError: 'LLM_CALL_FAILED',
        })),
      },
      pageState,
      config,
      state,
      stepLogger: { log: (entry) => logs.push(entry) },
      sessionId: 'sess-1',
      dataRoot: '/tmp',
      interactiveAvailable: false,
    });

    expect(result.llmError).toBe('LLM_CALL_FAILED');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(expect.objectContaining({
      action: 'llm.decide',
      status: 'pending',
    }));
  });
});
