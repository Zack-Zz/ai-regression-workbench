import { describe, expect, it, vi } from 'vitest';
import { createExplorationLoopState } from '../src/exploration/orchestration.js';
import {
  cleanupExplorationRuntime,
  commitExplorationStep,
  finalizeExplorationRun,
} from '../src/exploration/lifecycle.js';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { ExplorationStep, PageProbe } from '../src/exploration/types.js';

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

describe('commitExplorationStep', () => {
  it('appends session step, invokes callback, and advances step index', () => {
    const state = createExplorationLoopState(makeConfig());
    state.stepIndex = 2;
    const sessionManager = { appendStep: vi.fn() };
    const onStep = vi.fn();
    const nextStep: ExplorationStep = {
      stepIndex: 2,
      action: 'navigate',
      targetUrl: 'https://example.com/reports',
      reasoning: 'go deeper',
    };
    const pageState = {
      ...makePage('https://example.com/reports'),
      consoleErrors: ['TypeError'],
      networkErrors: [{ url: 'https://example.com/api/reports', status: 500 }],
    };

    commitExplorationStep({
      sessionManager,
      sessionId: 'sess-1',
      state,
      nextStep,
      pageState,
      findingCount: 2,
      dataRoot: '/tmp',
      onStep,
      timestamp: '2026-04-04T12:00:00.000Z',
    });

    expect(sessionManager.appendStep).toHaveBeenCalledWith(
      'sess-1',
      {
        stepIndex: 2,
        description: 'navigate: https://example.com/reports',
        outcome: 'findings: 2, errors: 2',
        timestamp: '2026-04-04T12:00:00.000Z',
      },
      '/tmp',
    );
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(state.stepIndex).toBe(3);
  });
});

describe('cleanupExplorationRuntime', () => {
  it('flushes network log and closes provider', async () => {
    const provider = {
      flushNetworkLog: vi.fn(),
      close: vi.fn(async () => undefined),
    };

    await cleanupExplorationRuntime({
      activePwProvider: provider,
      dataRoot: '/tmp/work',
      runId: 'run-1',
    });

    expect(provider.flushNetworkLog).toHaveBeenCalledWith('/tmp/work/runs/run-1/network.jsonl');
    expect(provider.close).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeExplorationRun', () => {
  it('logs summary, completes session, and returns result', () => {
    const state = createExplorationLoopState(makeConfig());
    state.stepIndex = 4;
    state.totalFindings = 3;
    state.visitedUrls.add('https://example.com/dashboard');
    state.visitedUrls.add('https://example.com/reports');
    state.llmError = 'LLM_CALL_FAILED';
    const stepLogger = { log: vi.fn() };
    const appLog = { info: vi.fn() };
    const sessionManager = { completeSession: vi.fn() };

    const result = finalizeExplorationRun({
      runId: 'run-1',
      sessionId: 'sess-1',
      state,
      stepLogger,
      sessionManager,
      appLog,
    });

    expect(stepLogger.log).toHaveBeenCalledWith({
      component: 'ExplorationAgent',
      action: 'explore.done',
      detail: 'steps=4, pages=2, findings=3',
      status: 'ok',
    });
    expect(appLog.info).toHaveBeenCalledWith('exploration done', {
      runId: 'run-1',
      stepsExecuted: 4,
      pagesVisited: 2,
      findingCount: 3,
      llmError: 'LLM_CALL_FAILED',
    });
    expect(sessionManager.completeSession).toHaveBeenCalledWith('sess-1');
    expect(result).toEqual({
      findingCount: 3,
      stepsExecuted: 4,
      pagesVisited: 2,
      budget: {
        usedTokens: 0,
        tokenBudget: 10000,
        remainingTokens: 10000,
        compactionsUsed: 0,
        maxCompactions: 1,
      },
      llmError: 'LLM_CALL_FAILED',
    });
  });
});
