import { HARNESS_TEMPLATE_VERSIONS } from '../prompt-loader.js';
import type { HarnessPolicy } from '../runtime/harness-policy.js';
import { EXPLORATION_AGENT_PROFILE } from '../runtime/agent-profile.js';
import type { StepRecord } from '../runtime/session-manager.js';
import type { ExplorationConfig } from '@zarb/shared-types';
import { pushRecent } from './recent-context.js';
import type { DomSnapshot } from '../playwright-tool-provider.js';
import type { ExplorationBrainPlan, ExplorationPromptContext, ExplorationStep, PageProbe } from './types.js';

export interface ExplorationLoopState {
  maxSteps: number;
  maxPages: number;
  visitedUrls: Set<string>;
  pendingUrls: string[];
  recentSteps: string[];
  recentFindings: string[];
  recentToolResults: string[];
  recentNetworkHighlights: string[];
  seenFindingKeys: Set<string>;
  currentPage: PageProbe | undefined;
  stepIndex: number;
  noNewFindingsStreak: number;
  totalFindings: number;
  llmError: string | undefined;
  authEstablished: boolean;
  activeBrainPlan: ExplorationBrainPlan | undefined;
  brainPlanStepIndex: number;
  forceBrainReplan: boolean;
  tokenBudget?: number;
  enableAutoCompact: boolean;
  usedTokens: number;
  compactionsUsed: number;
  maxCompactions: number;
  compactCarryover: string | undefined;
}

export function buildExplorationPolicy(config: ExplorationConfig, allowedHosts: string[]): HarnessPolicy {
  return {
    sessionBudgetMs: (config.maxSteps ?? 20) * 30_000,
    toolCallTimeoutMs: 30_000,
    allowedHosts,
    allowedWriteScopes: [],
    requireApprovalFor: [],
    reviewOnVerifyFailureAllowed: false,
  };
}

export function buildExplorationContextRefs(config: ExplorationConfig, allowedHosts: string[]): Record<string, unknown> {
  return {
    startUrls: config.startUrls,
    allowedHosts,
    maxSteps: config.maxSteps ?? 20,
    maxPages: config.maxPages ?? 10,
    approxTokenBudget: config.approxTokenBudget ?? EXPLORATION_AGENT_PROFILE.approxTokenBudget ?? null,
    enableAutoCompact: config.enableAutoCompact ?? true,
    maxCompactions: config.maxCompactions ?? 1,
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
  };
}

export function createExplorationLoopState(config: ExplorationConfig): ExplorationLoopState {
  const tokenBudget = config.approxTokenBudget ?? EXPLORATION_AGENT_PROFILE.approxTokenBudget;
  return {
    maxSteps: config.maxSteps ?? 20,
    maxPages: config.maxPages ?? 10,
    visitedUrls: new Set<string>(),
    pendingUrls: [...config.startUrls],
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
    enableAutoCompact: config.enableAutoCompact ?? true,
    usedTokens: 0,
    compactionsUsed: 0,
    maxCompactions: Math.max(0, config.maxCompactions ?? 1),
    compactCarryover: undefined,
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
  };
}

export function getExplorationPlanningReason(input: {
  hasActiveBrainPlan: boolean;
  forceBrainReplan: boolean;
  stepIndex: number;
  brainPlanStepIndex: number;
  noNewFindingsStreak: number;
}): 'forced' | 'first-step' | 'stalled' | 'interval' | null {
  const { hasActiveBrainPlan, forceBrainReplan, stepIndex, brainPlanStepIndex, noNewFindingsStreak } = input;
  if (!hasActiveBrainPlan && stepIndex === 0) return 'first-step';
  if (!hasActiveBrainPlan) return 'interval';
  if (forceBrainReplan) return 'forced';
  if (noNewFindingsStreak >= 2) return 'stalled';
  if (stepIndex - brainPlanStepIndex >= 3) return 'interval';
  return null;
}

export function buildExplorationDecisionContext(input: {
  pageState: PageProbe;
  config: ExplorationConfig;
  state: ExplorationLoopState;
  interactiveAvailable: boolean;
  domSnapshot?: DomSnapshot;
}): ExplorationPromptContext {
  const { pageState, config, state, interactiveAvailable, domSnapshot } = input;
  return {
    page: pageState,
    config,
    stepIndex: state.stepIndex,
    visited: [...state.visitedUrls],
    recentSteps: state.recentSteps,
    recentFindings: state.recentFindings,
    recentToolResults: state.recentToolResults,
    recentNetworkHighlights: state.recentNetworkHighlights,
    ...(state.compactCarryover ? { compactCarryover: state.compactCarryover } : {}),
    ...(state.activeBrainPlan ? { brainPlan: state.activeBrainPlan } : {}),
    supportedActions: interactiveAvailable ? '"click"|"fill"|"navigate"|"done"' : '"navigate"|"done"',
    remainingSteps: Math.max(state.maxSteps - state.stepIndex, 0),
    remainingPages: Math.max(state.maxPages - state.visitedUrls.size, 0),
    ...(domSnapshot ? { domSnapshot } : {}),
  };
}

export function applyPreferredActionGuard(input: {
  nextStep: ExplorationStep;
  pageState: PageProbe;
  state: ExplorationLoopState;
  stepLogger: { log(entry: Record<string, unknown>): void };
}): 'pass' | 'continue' {
  const { nextStep, pageState, state, stepLogger } = input;
  if (!state.activeBrainPlan || nextStep.action === 'done' || state.activeBrainPlan.preferredActions.includes(nextStep.action)) {
    return 'pass';
  }

  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'policy.guard',
    status: 'warn',
    detail: `action ${nextStep.action} outside preferredActions; replanning`,
    toolInput: { action: nextStep.action, preferredActions: state.activeBrainPlan.preferredActions },
    reason: nextStep.reasoning,
  });
  state.forceBrainReplan = true;
  state.currentPage = pageState;
  state.noNewFindingsStreak = 0;
  pushRecent(state.recentToolResults, `policy rejected action ${nextStep.action}`);
  return 'continue';
}

export function createExplorationSessionStep(input: {
  stepIndex: number;
  nextStep: ExplorationStep;
  pageState: PageProbe;
  findingCount: number;
  timestamp: string;
}): StepRecord {
  const { stepIndex, nextStep, pageState, findingCount, timestamp } = input;
  return {
    stepIndex,
    description: `${nextStep.action}: ${pageState.url}`,
    outcome: `findings: ${String(findingCount)}, errors: ${String(pageState.consoleErrors.length + pageState.networkErrors.length)}`,
    timestamp,
  };
}
