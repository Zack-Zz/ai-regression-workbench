import type { RunStatus } from '@zarb/shared-types';
import { RUN_TERMINAL_STATUSES } from '@zarb/shared-types';

/**
 * Valid (from -> to) transitions for Run status.
 * Derived from design.md §8 state machine diagram.
 */
const ALLOWED: ReadonlyMap<RunStatus, ReadonlySet<RunStatus>> = new Map([
  ['CREATED', new Set<RunStatus>(['RUNNING_TESTS', 'PLANNING_EXPLORATION', 'PAUSED', 'CANCELLED'])],
  ['RUNNING_TESTS', new Set<RunStatus>(['PLANNING_EXPLORATION', 'COLLECTING_ARTIFACTS', 'PAUSED', 'CANCELLED', 'FAILED'])],
  ['PLANNING_EXPLORATION', new Set<RunStatus>(['RUNNING_EXPLORATION', 'PAUSED', 'CANCELLED', 'FAILED'])],
  ['RUNNING_EXPLORATION', new Set<RunStatus>(['COLLECTING_ARTIFACTS', 'PAUSED', 'CANCELLED', 'FAILED'])],
  ['COLLECTING_ARTIFACTS', new Set<RunStatus>(['FETCHING_TRACES', 'PAUSED', 'CANCELLED', 'FAILED'])],
  ['FETCHING_TRACES', new Set<RunStatus>(['FETCHING_LOGS', 'PAUSED', 'CANCELLED'])],
  ['FETCHING_LOGS', new Set<RunStatus>(['ANALYZING_FAILURES', 'PAUSED', 'CANCELLED'])],
  ['ANALYZING_FAILURES', new Set<RunStatus>(['AWAITING_CODE_ACTION', 'COMPLETED', 'PAUSED', 'CANCELLED', 'FAILED'])],
  ['AWAITING_CODE_ACTION', new Set<RunStatus>(['RUNNING_CODE_TASK', 'PAUSED', 'CANCELLED'])],
  ['RUNNING_CODE_TASK', new Set<RunStatus>(['AWAITING_REVIEW', 'PAUSED', 'CANCELLED', 'FAILED'])],
  ['AWAITING_REVIEW', new Set<RunStatus>(['READY_TO_COMMIT', 'AWAITING_CODE_ACTION', 'PAUSED', 'CANCELLED'])],
  ['READY_TO_COMMIT', new Set<RunStatus>(['COMPLETED', 'PAUSED', 'CANCELLED'])],
  ['PAUSED', new Set<RunStatus>(['RUNNING_TESTS', 'PLANNING_EXPLORATION', 'RUNNING_EXPLORATION', 'FETCHING_TRACES', 'RUNNING_CODE_TASK', 'CANCELLED'])],
  ['COMPLETED', new Set<RunStatus>()],
  ['FAILED', new Set<RunStatus>()],
  ['CANCELLED', new Set<RunStatus>()],
]);

export function isRunTransitionAllowed(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED.get(from)?.has(to) ?? false;
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!isRunTransitionAllowed(from, to)) {
    throw new Error(`Invalid Run transition: ${from} -> ${to}`);
  }
}

export function isRunTerminal(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.has(status);
}

/** Stages that support pause (all non-terminal, non-paused, non-waiting states). */
export const PAUSABLE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'CREATED', 'RUNNING_TESTS', 'PLANNING_EXPLORATION', 'RUNNING_EXPLORATION',
  'COLLECTING_ARTIFACTS', 'FETCHING_TRACES', 'FETCHING_LOGS', 'ANALYZING_FAILURES',
  'AWAITING_CODE_ACTION', 'RUNNING_CODE_TASK', 'AWAITING_REVIEW', 'READY_TO_COMMIT',
]);

export const CANCELLABLE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'CREATED', 'RUNNING_TESTS', 'PLANNING_EXPLORATION', 'RUNNING_EXPLORATION',
  'COLLECTING_ARTIFACTS', 'FETCHING_TRACES', 'FETCHING_LOGS', 'ANALYZING_FAILURES',
  'AWAITING_CODE_ACTION', 'RUNNING_CODE_TASK', 'AWAITING_REVIEW', 'READY_TO_COMMIT', 'PAUSED',
]);
