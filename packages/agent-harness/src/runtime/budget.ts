export interface ApproxBudgetSnapshot {
  usedTokens: number;
  tokenBudget?: number;
  remainingTokens?: number;
  compactionsUsed: number;
  maxCompactions: number;
}

export function estimateApproxTokens(...values: Array<string | null | undefined>): number {
  const totalChars = values.reduce((sum, value) => sum + normalizeBudgetText(value).length, 0);
  return Math.ceil(totalChars / 4);
}

export function isApproxBudgetExceeded(usedTokens: number, tokenBudget?: number): boolean {
  return tokenBudget !== undefined && usedTokens >= tokenBudget;
}

export function buildApproxBudgetSnapshot(input: {
  usedTokens: number;
  tokenBudget: number | undefined;
  compactionsUsed: number;
  maxCompactions: number;
}): ApproxBudgetSnapshot {
  const { usedTokens, tokenBudget, compactionsUsed, maxCompactions } = input;
  return {
    usedTokens,
    compactionsUsed,
    maxCompactions,
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    ...(tokenBudget !== undefined ? { remainingTokens: Math.max(0, tokenBudget - usedTokens) } : {}),
  };
}

function normalizeBudgetText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
