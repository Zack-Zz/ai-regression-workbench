/**
 * TimeoutPolicy — computes timeout_at for Run/CodeTask stages.
 * Derived from orchestrator-design.md §7.
 *
 * All durations in milliseconds. Returns ISO-8601 string or undefined
 * when the stage has no timeout budget.
 */

export interface TimeoutBudgets {
  testRunnerMs: number;
  traceFetchMs: number;
  logFetchMs: number;
  aiAnalysisMs: number;
  harnessSessionMs: number;
  codeAgentApplyMs: number;
  codeAgentVerifyMs: number;
}

export const DEFAULT_TIMEOUT_BUDGETS: TimeoutBudgets = {
  testRunnerMs: 30 * 60 * 1000,       // 30 min
  traceFetchMs: 30 * 1000,            // 30 s
  logFetchMs: 30 * 1000,              // 30 s
  aiAnalysisMs: 60 * 1000,            // 60 s
  harnessSessionMs: 10 * 60 * 1000,   // 10 min
  codeAgentApplyMs: 10 * 60 * 1000,   // 10 min
  codeAgentVerifyMs: 5 * 60 * 1000,   // 5 min per command
};

export type TimeoutStage =
  | 'RUNNING_TESTS'
  | 'FETCHING_TRACES'
  | 'FETCHING_LOGS'
  | 'ANALYZING_FAILURES'
  | 'RUNNING_EXPLORATION'
  | 'RUNNING'       // CodeTask running (apply)
  | 'VERIFYING';    // CodeTask verifying

export function computeTimeoutAt(
  stage: TimeoutStage,
  now: Date,
  budgets: TimeoutBudgets = DEFAULT_TIMEOUT_BUDGETS,
): string {
  const ms = stageBudget(stage, budgets);
  return new Date(now.getTime() + ms).toISOString();
}

function stageBudget(stage: TimeoutStage, b: TimeoutBudgets): number {
  switch (stage) {
    case 'RUNNING_TESTS': return b.testRunnerMs;
    case 'FETCHING_TRACES': return b.traceFetchMs;
    case 'FETCHING_LOGS': return b.logFetchMs;
    case 'ANALYZING_FAILURES': return b.aiAnalysisMs;
    case 'RUNNING_EXPLORATION': return b.harnessSessionMs;
    case 'RUNNING': return b.codeAgentApplyMs;
    case 'VERIFYING': return b.codeAgentVerifyMs;
  }
}

export function isTimedOut(timeoutAt: string | null | undefined, now: Date): boolean {
  if (!timeoutAt) return false;
  return now.getTime() >= new Date(timeoutAt).getTime();
}
