import { buildApproxBudgetSnapshot, estimateApproxTokens, isApproxBudgetExceeded } from '../runtime/budget.js';
import type { ExplorationLoopState } from './orchestration.js';
import type { ExplorationBudgetSnapshot, PageProbe } from './types.js';

interface StepLoggerLike {
  log(entry: Record<string, unknown>): void;
}

type ExplorationBudgetPhase = 'planning' | 'decision';

export function enforceExplorationTokenBudget(input: {
  phase: ExplorationBudgetPhase;
  pageState: PageProbe;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
}): 'pass' | 'break' {
  const { phase, pageState, state, stepLogger } = input;
  const tokenBudget = state.tokenBudget;
  if (tokenBudget === undefined) {
    state.usedTokens = estimateExplorationTokens(pageState, state);
    return 'pass';
  }

  let usedTokens = estimateExplorationTokens(pageState, state);
  state.usedTokens = usedTokens;
  if (!isApproxBudgetExceeded(usedTokens, tokenBudget)) {
    return 'pass';
  }

  if (state.enableAutoCompact && state.compactionsUsed < state.maxCompactions) {
    const compactCarryover = buildExplorationCompactCarryover(pageState, state);
    state.compactCarryover = compactCarryover;
    state.recentSteps = trimRecent(state.recentSteps);
    state.recentFindings = trimRecent(state.recentFindings);
    state.recentToolResults = trimRecent(state.recentToolResults);
    state.recentNetworkHighlights = trimRecent(state.recentNetworkHighlights);
    state.compactionsUsed += 1;
    usedTokens = estimateExplorationTokens(pageState, state);
    state.usedTokens = usedTokens;
    stepLogger.log({
      component: 'ExplorationAgent',
      action: 'context.compact',
      status: isApproxBudgetExceeded(usedTokens, tokenBudget) ? 'error' : 'warn',
      detail: `auto compact before ${phase}`,
      toolInput: {
        phase,
        tokenBudget,
        compactionsUsed: state.compactionsUsed,
      },
      toolOutput: {
        usedTokens,
        compactedHistory: compactCarryover,
      },
    });
    if (!isApproxBudgetExceeded(usedTokens, tokenBudget)) {
      return 'pass';
    }
  }

  state.llmError = 'TOKEN_BUDGET_EXHAUSTED';
  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'context.budget',
    status: 'error',
    detail: `token budget exhausted before ${phase}`,
    toolInput: {
      phase,
      tokenBudget,
      compactionsUsed: state.compactionsUsed,
    },
    toolOutput: {
      usedTokens,
      compacted: Boolean(state.compactCarryover),
    },
  });
  return 'break';
}

export function buildExplorationBudgetSnapshot(state: ExplorationLoopState): ExplorationBudgetSnapshot {
  return buildApproxBudgetSnapshot({
    usedTokens: state.usedTokens,
    tokenBudget: state.tokenBudget,
    compactionsUsed: state.compactionsUsed,
    maxCompactions: state.maxCompactions,
  });
}

function buildExplorationCompactCarryover(pageState: PageProbe, state: ExplorationLoopState): string {
  const visitedTail = [...state.visitedUrls].slice(-4);
  const sections = [
    `Compacted exploration history at step ${String(state.stepIndex)} while on ${pageState.url}.`,
    state.compactCarryover ? `Previous compact history: ${truncate(state.compactCarryover, 120)}` : '',
    `Visited tail: ${visitedTail.join(' | ') || 'none'}`,
    `Recent steps: ${state.recentSteps.slice(-3).map((item) => truncate(item, 80)).join(' | ') || 'none'}`,
    `Recent findings: ${state.recentFindings.slice(-3).map((item) => truncate(item, 80)).join(' | ') || 'none'}`,
    `Recent tool results: ${state.recentToolResults.slice(-3).map((item) => truncate(item, 80)).join(' | ') || 'none'}`,
    `Recent network highlights: ${state.recentNetworkHighlights.slice(-2).map((item) => truncate(item, 90)).join(' | ') || 'none'}`,
    state.activeBrainPlan
      ? `Active brain plan: phase=${state.activeBrainPlan.phase}; objective=${truncate(state.activeBrainPlan.objective, 120)}; preferred=${state.activeBrainPlan.preferredActions.join('|') || 'none'}`
      : 'Active brain plan: none',
  ].filter(Boolean);
  return sections.join('\n').slice(0, 700);
}

function estimateExplorationTokens(pageState: PageProbe, state: ExplorationLoopState): number {
  return estimateApproxTokens(
    pageState.url,
    pageState.title,
    ...pageState.consoleErrors.slice(0, 3),
    ...pageState.networkErrors.slice(0, 3).map((item) => `${String(item.status)} ${item.url}`),
    ...state.recentSteps,
    ...state.recentFindings,
    ...state.recentToolResults,
    ...state.recentNetworkHighlights,
    ...[...state.visitedUrls].slice(-12),
    state.activeBrainPlan?.objective ?? '',
    state.activeBrainPlan?.reasoning ?? '',
    state.activeBrainPlan?.candidateUrls.slice(0, 6).join(' | ') ?? '',
    state.compactCarryover ?? '',
  );
}

function trimRecent(values: string[]): string[] {
  return values.slice(-1);
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 3))}...` : value;
}
