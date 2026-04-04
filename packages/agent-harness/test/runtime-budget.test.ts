import { describe, expect, it } from 'vitest';
import {
  buildApproxBudgetSnapshot,
  estimateApproxTokens,
  isApproxBudgetExceeded,
} from '../src/runtime/budget.js';

describe('runtime budget helpers', () => {
  it('estimates approximate tokens from normalized text fragments', () => {
    expect(estimateApproxTokens(
      '  alpha   beta  ',
      '',
      undefined,
      'gamma\ndelta',
    )).toBe(6);
  });

  it('builds a shared budget snapshot with remaining tokens', () => {
    expect(buildApproxBudgetSnapshot({
      usedTokens: 320,
      tokenBudget: 500,
      compactionsUsed: 1,
      maxCompactions: 2,
    })).toEqual({
      usedTokens: 320,
      tokenBudget: 500,
      remainingTokens: 180,
      compactionsUsed: 1,
      maxCompactions: 2,
    });
  });

  it('treats undefined budgets as unbounded', () => {
    expect(isApproxBudgetExceeded(800, undefined)).toBe(false);
    expect(isApproxBudgetExceeded(800, 800)).toBe(true);
  });
});
