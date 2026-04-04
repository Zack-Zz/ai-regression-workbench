import { join } from 'node:path';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { FindingRepository, SiteCredentialRepository } from '@zarb/storage';
import { HarnessSessionManager } from './runtime/session-manager.js';
import { ToolRegistry } from './runtime/tool-registry.js';
import { StepLogger, appLogger } from '@zarb/logger';
import type { DomSnapshot, PlaywrightToolProvider } from './playwright-tool-provider.js';
import { PlaywrightExplorationBrowserAdapter } from './exploration/browser-adapter.js';
import type { ExplorationBrowserAdapter } from './exploration/browser-adapter.js';
import { enforceExplorationTokenBudget } from './exploration/budget.js';
import type {
  ExplorationBrainPlan,
  ExplorationPlanPromptContext,
  ExplorationPromptContext,
  ExplorationResult,
  ExplorationStep,
  PageProbe,
} from './exploration/types.js';
import {
  buildExplorationDecisionPrompt as buildExplorationDecisionPromptFromModule,
  buildExplorationPlanPrompt as buildExplorationPlanPromptFromModule,
} from './exploration/prompt-builder.js';
import { runExplorationDecision, runExplorationPlanning } from './exploration/brain-runner.js';
import {
  cleanupExplorationRuntime,
  commitExplorationStep,
  finalizeExplorationRun,
} from './exploration/lifecycle.js';
import { ExplorationFindingExtractor } from './exploration/finding-extractor.js';
import { ExplorationBrain, resolveAuthGateMode as resolveAuthGateModeFromBrain } from './exploration/brain.js';
import {
  handleAuthGate,
  handleInteractiveAction,
  handleNavigateDecision,
  handleNavigationPass,
  handleRequiredLogin,
  persistPageFindings,
} from './exploration/execution.js';
import {
  applyPreferredActionGuard,
  buildExplorationContextRefs,
  buildExplorationPolicy,
  createExplorationLoopState,
  getExplorationPlanningReason,
} from './exploration/orchestration.js';
import {
  ExplorationAuthFlow,
  estimateSliderDragDistance as estimateSliderDragDistanceFromAuth,
  isCaptchaChallengeError as isCaptchaChallengeErrorFromAuth,
  looksLoggedInBySnapshot as looksLoggedInBySnapshotFromAuth,
} from './exploration/auth-flow.js';

const log = appLogger.child('ExplorationAgent');

export interface AIProvider {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  isConfigured(): boolean;
  readonly model: string | undefined;
}

interface AICompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    };
  }>;
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  retry?: {
    maxAttempts?: number;
    retryOnEmpty?: boolean;
  };
  scene?: 'explorationDecision' | 'explorationLogin';
}

export type {
  ExplorationBrainPhase,
  ExplorationBrainPlan,
  ExplorationPlanPromptContext,
  ExplorationPromptContext,
  ExplorationResult,
  ExplorationStep,
  PageProbe,
} from './exploration/types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateSliderDragDistance(input: {
  gapX: number;
  originalWidth: number;
  sliderWidth: number;
  travelWidth: number;
}): number {
  const originalWidth = Number(input.originalWidth);
  const sliderWidth = Number(input.sliderWidth);
  const travelWidth = Number(input.travelWidth);
  const gapX = Number(input.gapX);
  if (!Number.isFinite(originalWidth) || !Number.isFinite(sliderWidth) || !Number.isFinite(travelWidth) || !Number.isFinite(gapX)) return 0;
  if (originalWidth <= 1 || travelWidth <= 0) return 0;
  const movableImageWidth = Math.max(1, originalWidth - Math.max(0, sliderWidth));
  const ratio = clamp(gapX / movableImageWidth, 0, 1);
  return clamp(ratio * travelWidth, 0, travelWidth);
}

export function isCaptchaChallengeError(errorMessage: string): boolean {
  return isCaptchaChallengeErrorFromAuth(errorMessage);
}

export function looksLoggedInBySnapshot(snapshot: DomSnapshot): boolean {
  return looksLoggedInBySnapshotFromAuth(snapshot);
}

type AuthGateMode = 'none' | 'skip' | 'replan-continue' | 'replan-plan';

export function resolveAuthGateMode(input: {
  authEstablished: boolean;
  hasAuthError: boolean;
  isOnLoginPage: boolean;
}): AuthGateMode {
  return resolveAuthGateModeFromBrain(input);
}

export function buildExplorationDecisionPrompt(ctx: ExplorationPromptContext): string {
  return buildExplorationDecisionPromptFromModule(ctx);
}

export function buildExplorationPlanPrompt(ctx: ExplorationPlanPromptContext): string {
  return buildExplorationPlanPromptFromModule(ctx);
}

/**
 * ExplorationAgent — drives AI-guided site exploration.
 *
 * Design: agent-harness-design.md §6.1
 * - LLM decides next action (navigate/click/fill/done)
 * - Playwright probe collects page state after each action
 * - Findings are persisted to DB
 * - Hard budget: maxSteps / maxPages
 * - Soft stop: no new findings for 3 consecutive steps
 */
export class ExplorationAgent {
  private readonly findings: FindingRepository;
  private readonly sessionManager: HarnessSessionManager;
  private readonly credentials: SiteCredentialRepository;
  private readonly findingExtractor = new ExplorationFindingExtractor();
  private readonly browserAdapter: ExplorationBrowserAdapter | undefined;
  private readonly brain: ExplorationBrain;
  private readonly authFlow: ExplorationAuthFlow | undefined;

  constructor(
    private readonly db: Db,
    private readonly provider: AIProvider,
    private readonly playwrightProvider?: PlaywrightToolProvider,
  ) {
    this.findings = new FindingRepository(db);
    this.sessionManager = new HarnessSessionManager(db);
    this.credentials = new SiteCredentialRepository(db);
    this.browserAdapter = playwrightProvider ? new PlaywrightExplorationBrowserAdapter(playwrightProvider) : undefined;
    this.brain = new ExplorationBrain(provider, this.sessionManager);
    this.authFlow = this.browserAdapter ? new ExplorationAuthFlow(provider, this.sessionManager, this.browserAdapter) : undefined;
  }

  async explore(
    runId: string,
    config: ExplorationConfig,
    probe: (url: string) => Promise<PageProbe>,
    dataRoot = '',
    onStep?: () => void,
  ): Promise<ExplorationResult> {
    const allowedHosts = config.allowedHosts ?? [];
    const policy = buildExplorationPolicy(config, allowedHosts);
    const registry = new ToolRegistry(policy);
    const session = this.sessionManager.startSession({
      runId,
      kind: 'exploration',
      agentName: 'ExplorationAgent',
      policy,
      contextRefs: buildExplorationContextRefs(config, allowedHosts),
      dataRoot,
    });

    const stepLogger = new StepLogger(join(dataRoot, 'runs', runId, 'steps.ndjson'), onStep);
    stepLogger.log({ component: 'ExplorationAgent', action: 'explore.start', status: 'ok', detail: `urls=${config.startUrls.join(',')}, maxSteps=${String(config.maxSteps)}`, toolInput: { startUrls: config.startUrls, maxSteps: config.maxSteps, maxPages: config.maxPages } });
    log.info('exploration started', { runId, startUrls: config.startUrls, maxSteps: config.maxSteps, maxPages: config.maxPages });

    // If PlaywrightToolProvider is available, launch it and use its probe
    let activePwProvider: PlaywrightToolProvider | null = null;
    let effectiveProbe = probe;
    if (this.browserAdapter) {
      try {
        await this.browserAdapter.launch({ headless: config.browserMode !== 'headed' });
        this.browserAdapter.registerTools(registry);
        effectiveProbe = this.browserAdapter.buildProbe();
        activePwProvider = this.browserAdapter as unknown as PlaywrightToolProvider;
      } catch (e) {
        // Playwright unavailable (e.g. no browser installed) — fall back to probe callback
        log.warn('Playwright launch failed, falling back to fetch', { error: String(e) });
        console.warn('[ExplorationAgent] Playwright launch failed, falling back to fetch:', e);
      }
    }

    const state = createExplorationLoopState(config);

    try {
      while (state.stepIndex < state.maxSteps
        && state.visitedUrls.size < state.maxPages
        && (state.currentPage !== undefined || state.pendingUrls.length > 0)) {
        let pageState: PageProbe;
        if (!state.currentPage) {
          const navigation = await handleNavigationPass({
            activePwProvider,
            registry,
            effectiveProbe,
            state,
            stepLogger,
            sessionId: session.session_id,
          });
          if (navigation.outcome === 'skip') continue;
          pageState = navigation.pageState;
        } else {
          pageState = state.currentPage;
        }

        const newFindings = persistPageFindings({
          config,
          findingExtractor: this.findingExtractor,
          findings: this.findings,
          pageState,
          runId,
          state,
          stepLogger,
        });

        state.noNewFindingsStreak = newFindings.length === 0 ? state.noNewFindingsStreak + 1 : 0;
        if (state.noNewFindingsStreak >= 3) break;

        if (handleAuthGate({
          pageState,
          state,
          stepLogger,
        }) === 'continue') {
          continue;
        }

        const planningReason = getExplorationPlanningReason({
          hasActiveBrainPlan: Boolean(state.activeBrainPlan),
          forceBrainReplan: state.forceBrainReplan,
          stepIndex: state.stepIndex,
          brainPlanStepIndex: state.brainPlanStepIndex,
          noNewFindingsStreak: state.noNewFindingsStreak,
        });
        if (planningReason) {
          if (enforceExplorationTokenBudget({
            phase: 'planning',
            pageState,
            state,
            stepLogger,
          }) === 'break') {
            break;
          }
          await runExplorationPlanning({
            brain: this.brain,
            pageState,
            config,
            planningReason,
            state,
            stepLogger,
            sessionId: session.session_id,
            dataRoot,
          });
        }

        if (state.activeBrainPlan?.requiresLogin && !state.authEstablished) {
          const loginResult = await handleRequiredLogin({
            activePwProvider,
            authFlow: this.authFlow,
            findCredentialById: (credentialId) => this.credentials.findById(credentialId),
            registry,
            config,
            pageState,
            state,
            stepLogger,
            sessionId: session.session_id,
            dataRoot,
          });
          pageState = loginResult.pageState;
          if (loginResult.outcome === 'break') break;
          if (loginResult.outcome === 'continue') continue;
        }

        // Ask LLM executor for next action
        if (enforceExplorationTokenBudget({
          phase: 'decision',
          pageState,
          state,
          stepLogger,
        }) === 'break') {
          break;
        }
        const nextStep = await runExplorationDecision({
          brain: this.brain,
          pageState,
          config,
          state,
          stepLogger,
          sessionId: session.session_id,
          dataRoot,
          interactiveAvailable: Boolean(activePwProvider),
          ...(this.provider.model ? { providerModel: this.provider.model } : {}),
          ...(activePwProvider ? { collectDomSnapshot: () => activePwProvider.collectDomSnapshot() } : {}),
        });
        if (nextStep.llmError) {
          state.llmError = nextStep.llmError;
          log.warn('LLM error during exploration, stopping early', { runId, llmError: state.llmError });
          break;
        }
        if (applyPreferredActionGuard({
          nextStep,
          pageState,
          state,
          stepLogger,
        }) === 'continue') {
          continue;
        }
        if (nextStep.action === 'done') break;
        if (nextStep.action === 'navigate' && nextStep.targetUrl) {
          const navigateDecision = handleNavigateDecision({
            nextStep,
            pageState,
            state,
            stepLogger,
          });
          if (navigateDecision.outcome === 'continue') continue;
        } else {
          const actionResult = await handleInteractiveAction({
            activePwProvider,
            registry,
            nextStep,
            pageState,
            state,
            stepLogger,
            sessionId: session.session_id,
          });
          if (actionResult.outcome === 'continue') continue;
          if (actionResult.outcome === 'break') break;
          if (actionResult.outcome === 'unhandled') state.currentPage = undefined;
        }

        commitExplorationStep({
          sessionManager: this.sessionManager,
          sessionId: session.session_id,
          state,
          nextStep,
          pageState,
          findingCount: newFindings.length,
          dataRoot,
          ...(onStep ? { onStep } : {}),
        });
      }
    } finally {
      await cleanupExplorationRuntime({
        activePwProvider,
        dataRoot,
        runId,
      });
    }

    return finalizeExplorationRun({
      runId,
      sessionId: session.session_id,
      state,
      stepLogger,
      sessionManager: this.sessionManager,
      appLog: log,
    });
  }

}
