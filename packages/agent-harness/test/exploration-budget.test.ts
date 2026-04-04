import { describe, expect, it, vi } from 'vitest';
import type { ExplorationConfig } from '@zarb/shared-types';
import { enforceExplorationTokenBudget } from '../src/exploration/budget.js';
import { createExplorationLoopState } from '../src/exploration/orchestration.js';
import type { PageProbe } from '../src/exploration/types.js';

function makeConfig(overrides: Partial<ExplorationConfig> = {}): ExplorationConfig {
  return {
    startUrls: ['https://example.com/dashboard'],
    maxSteps: 6,
    maxPages: 3,
    approxTokenBudget: 450,
    enableAutoCompact: true,
    maxCompactions: 1,
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

describe('enforceExplorationTokenBudget', () => {
  it('auto compacts long-running context before stopping', () => {
    const state = createExplorationLoopState(makeConfig());
    state.recentSteps = Array.from({ length: 6 }, (_, index) => `navigate step ${String(index)} ${'x'.repeat(80)}`);
    state.recentFindings = Array.from({ length: 4 }, (_, index) => `finding ${String(index)} ${'y'.repeat(80)}`);
    state.recentToolResults = Array.from({ length: 5 }, (_, index) => `tool result ${String(index)} ${'z'.repeat(80)}`);
    state.recentNetworkHighlights = Array.from({ length: 4 }, (_, index) => `GET https://example.com/api/${String(index)} ${'n'.repeat(80)}`);
    state.visitedUrls.add('https://example.com/dashboard');
    state.visitedUrls.add('https://example.com/reports');
    const stepLogger = { log: vi.fn() };

    const result = enforceExplorationTokenBudget({
      phase: 'decision',
      pageState: makePage(),
      state,
      stepLogger,
    });

    expect(result).toBe('pass');
    expect(state.compactionsUsed).toBe(1);
    expect(state.compactCarryover).toContain('Compacted exploration history');
    expect(state.recentSteps).toHaveLength(1);
    expect(state.recentFindings).toHaveLength(1);
    expect(state.recentToolResults).toHaveLength(1);
    expect(state.usedTokens).toBeLessThan(state.tokenBudget ?? Number.POSITIVE_INFINITY);
    expect(stepLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'context.compact',
    }));
  });

  it('stops when the token budget is still exhausted after compaction is unavailable', () => {
    const state = createExplorationLoopState(makeConfig({
      approxTokenBudget: 20,
      enableAutoCompact: false,
      maxCompactions: 0,
    }));
    state.recentToolResults = [`verbose trace ${'q'.repeat(200)}`];
    const stepLogger = { log: vi.fn() };

    const result = enforceExplorationTokenBudget({
      phase: 'planning',
      pageState: makePage(),
      state,
      stepLogger,
    });

    expect(result).toBe('break');
    expect(state.llmError).toBe('TOKEN_BUDGET_EXHAUSTED');
    expect(stepLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'context.budget',
      status: 'error',
    }));
  });
});
