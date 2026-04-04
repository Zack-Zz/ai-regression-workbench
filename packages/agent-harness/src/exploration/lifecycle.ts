import { join } from 'node:path';
import { buildExplorationBudgetSnapshot } from './budget.js';
import type { ExplorationLoopState } from './orchestration.js';
import { createExplorationSessionStep } from './orchestration.js';
import type { ExplorationResult, ExplorationStep, PageProbe } from './types.js';

interface SessionManagerLike {
  appendStep(sessionId: string, step: {
    stepIndex: number;
    description: string;
    outcome: string;
    timestamp: string;
  }, dataRoot: string): void;
  completeSession(sessionId: string): void;
}

interface StepLoggerLike {
  log(entry: Record<string, unknown>): void;
}

interface AppLoggerLike {
  info(message: string, meta?: Record<string, unknown>): void;
}

interface FlushablePwProviderLike {
  flushNetworkLog(path: string): void;
  close(): Promise<void>;
}

export function commitExplorationStep(input: {
  sessionManager: Pick<SessionManagerLike, 'appendStep'>;
  sessionId: string;
  state: ExplorationLoopState;
  nextStep: ExplorationStep;
  pageState: PageProbe;
  findingCount: number;
  dataRoot: string;
  onStep?: () => void;
  timestamp?: string;
}): void {
  const { sessionManager, sessionId, state, nextStep, pageState, findingCount, dataRoot, onStep, timestamp } = input;
  sessionManager.appendStep(
    sessionId,
    createExplorationSessionStep({
      stepIndex: state.stepIndex,
      nextStep,
      pageState,
      findingCount,
      timestamp: timestamp ?? new Date().toISOString(),
    }),
    dataRoot,
  );
  onStep?.();
  state.stepIndex += 1;
}

export async function cleanupExplorationRuntime(input: {
  activePwProvider: FlushablePwProviderLike | null;
  dataRoot: string;
  runId: string;
}): Promise<void> {
  const { activePwProvider, dataRoot, runId } = input;
  if (!activePwProvider) {
    return;
  }
  if (dataRoot) {
    activePwProvider.flushNetworkLog(join(dataRoot, 'runs', runId, 'network.jsonl'));
  }
  await activePwProvider.close().catch(() => undefined);
}

export function finalizeExplorationRun(input: {
  runId: string;
  sessionId: string;
  state: ExplorationLoopState;
  stepLogger: StepLoggerLike;
  sessionManager: Pick<SessionManagerLike, 'completeSession'>;
  appLog: AppLoggerLike;
}): ExplorationResult {
  const { runId, sessionId, state, stepLogger, sessionManager, appLog } = input;
  stepLogger.log({
    component: 'ExplorationAgent',
    action: 'explore.done',
    detail: `steps=${String(state.stepIndex)}, pages=${String(state.visitedUrls.size)}, findings=${String(state.totalFindings)}`,
    status: 'ok',
  });
  appLog.info('exploration done', {
    runId,
    stepsExecuted: state.stepIndex,
    pagesVisited: state.visitedUrls.size,
    findingCount: state.totalFindings,
    llmError: state.llmError,
  });
  sessionManager.completeSession(sessionId);
  return {
    findingCount: state.totalFindings,
    stepsExecuted: state.stepIndex,
    pagesVisited: state.visitedUrls.size,
    budget: buildExplorationBudgetSnapshot(state),
    ...(state.llmError ? { llmError: state.llmError } : {}),
  };
}
