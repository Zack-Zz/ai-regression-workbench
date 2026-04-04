import type { ExplorationConfig } from '@zarb/shared-types';
import { HARNESS_TEMPLATE_VERSIONS } from '../prompt-loader.js';
import type { DomSnapshot } from '../playwright-tool-provider.js';
import { summarizePromptContext } from './prompt-builder.js';
import { pushRecent } from './recent-context.js';
import type { ExplorationLoopState } from './orchestration.js';
import { buildExplorationDecisionContext } from './orchestration.js';
import type { ExplorationBrainPlan, ExplorationStep, PageProbe } from './types.js';

interface StepLoggerLike {
  log(entry: Record<string, unknown>): void;
}

interface ExplorationBrainLike {
  planExplorationPhase(
    page: PageProbe,
    config: ExplorationConfig,
    stepIndex: number,
    visited: string[],
    stepLogger: StepLoggerLike,
    sessionId: string,
    dataRoot: string,
    recentSteps: string[],
    recentFindings: string[],
    recentToolResults: string[],
    recentNetworkHighlights: string[],
    authEstablished: boolean,
    mode: 'plan' | 'replan',
    compactCarryover?: string,
    actionId?: string,
  ): Promise<ExplorationBrainPlan>;
  decideNextStep(
    page: PageProbe,
    config: ExplorationConfig,
    stepIndex: number,
    visited: string[],
    stepLogger: StepLoggerLike,
    sessionId: string,
    dataRoot: string,
    actionId?: string,
    recentSteps?: string[],
    recentFindings?: string[],
    recentToolResults?: string[],
    recentNetworkHighlights?: string[],
    brainPlan?: ExplorationBrainPlan,
    domSnapshot?: DomSnapshot,
    compactCarryover?: string,
  ): Promise<ExplorationStep>;
}

export async function runExplorationPlanning(input: {
  brain: Pick<ExplorationBrainLike, 'planExplorationPhase'>;
  pageState: PageProbe;
  config: ExplorationConfig;
  planningReason: 'forced' | 'first-step' | 'stalled' | 'interval';
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
  sessionId: string;
  dataRoot: string;
}): Promise<ExplorationBrainPlan> {
  const { brain, pageState, config, planningReason, state, stepLogger, sessionId, dataRoot } = input;
  const planningStart = Date.now();
  const planActionId = `brain-plan-${String(state.stepIndex)}-${String(planningStart)}`;
  const mode = state.activeBrainPlan ? 'replan' : 'plan';

  stepLogger.log({
    component: 'ExplorationAgent',
    action: state.activeBrainPlan ? 'brain.replan' : 'brain.plan',
    status: 'pending',
    detail: `planning from ${pageState.url}`,
    toolInput: {
      currentUrl: pageState.url,
      authEstablished: state.authEstablished,
      visited: state.visitedUrls.size,
      noNewFindingsStreak: state.noNewFindingsStreak,
      reason: planningReason,
    },
    actionId: planActionId,
    promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationPlan,
  });

  const plan = await brain.planExplorationPhase(
    pageState,
    config,
    state.stepIndex,
    [...state.visitedUrls],
    stepLogger,
    sessionId,
    dataRoot,
    state.recentSteps,
    state.recentFindings,
    state.recentToolResults,
    state.recentNetworkHighlights,
    state.authEstablished,
    mode,
    state.compactCarryover,
    planActionId,
  );

  pushRecent(state.recentToolResults, `brain ${plan.phase} => ${plan.objective}`);
  state.activeBrainPlan = plan;
  state.brainPlanStepIndex = state.stepIndex;
  state.forceBrainReplan = false;

  return plan;
}

export async function runExplorationDecision(input: {
  brain: Pick<ExplorationBrainLike, 'decideNextStep'>;
  pageState: PageProbe;
  config: ExplorationConfig;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
  sessionId: string;
  dataRoot: string;
  providerModel?: string;
  interactiveAvailable: boolean;
  collectDomSnapshot?: () => Promise<DomSnapshot | undefined>;
}): Promise<ExplorationStep> {
  const {
    brain,
    pageState,
    config,
    state,
    stepLogger,
    sessionId,
    dataRoot,
    providerModel,
    interactiveAvailable,
    collectDomSnapshot,
  } = input;

  const llmStart = Date.now();
  const llmActionId = `llm-${String(llmStart)}`;
  const domSnapshot = collectDomSnapshot ? await collectDomSnapshot().catch(() => undefined) : undefined;
  const decisionContext = buildExplorationDecisionContext({
    pageState,
    config,
    state,
    interactiveAvailable,
    ...(domSnapshot ? { domSnapshot } : {}),
  });
  const promptContextSummary = summarizePromptContext(decisionContext);

  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'llm.decide',
    status: 'pending',
    detail: `deciding next step from ${pageState.url}`,
    toolInput: { currentUrl: pageState.url, formCount: pageState.formCount, linkCount: pageState.linkCount },
    actionId: llmActionId,
    promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
    promptContextSummary,
    ...(state.activeBrainPlan ? { reason: `plan=${state.activeBrainPlan.phase}: ${state.activeBrainPlan.objective}` } : {}),
  });

  const nextStep = await brain.decideNextStep(
    pageState,
    config,
    state.stepIndex,
    [...state.visitedUrls],
    stepLogger,
    sessionId,
    dataRoot,
    llmActionId,
    state.recentSteps,
    state.recentFindings,
    state.recentToolResults,
    state.recentNetworkHighlights,
    state.activeBrainPlan,
    domSnapshot,
    state.compactCarryover,
  );

  if (nextStep.llmError) {
    return nextStep;
  }

  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'llm.decide',
    status: 'ok',
    durationMs: Date.now() - llmStart,
    detail: `action=${nextStep.action}${nextStep.targetUrl ? ` url=${nextStep.targetUrl}` : ''}`,
    toolInput: { currentUrl: pageState.url, formCount: pageState.formCount, linkCount: pageState.linkCount },
    toolOutput: { action: nextStep.action, targetUrl: nextStep.targetUrl, selector: nextStep.selector },
    reason: nextStep.reasoning,
    actionId: llmActionId,
    promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationDecision,
    promptContextSummary,
    ...(providerModel ? { model: providerModel } : {}),
  });

  return nextStep;
}
