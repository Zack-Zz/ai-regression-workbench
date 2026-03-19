import type { CodeTaskStatus, RunStatus } from './enums.js';
import { CODE_TASK_TERMINAL_STATUSES, RUN_TERMINAL_STATUSES } from './enums.js';

const RUN_ALLOWED_TRANSITIONS: ReadonlyMap<RunStatus, ReadonlySet<RunStatus>> = new Map([
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

const CODE_TASK_ALLOWED_TRANSITIONS: ReadonlyMap<CodeTaskStatus, ReadonlySet<CodeTaskStatus>> = new Map([
  ['DRAFT', new Set<CodeTaskStatus>(['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'])],
  ['PENDING_APPROVAL', new Set<CodeTaskStatus>(['APPROVED', 'REJECTED', 'CANCELLED'])],
  ['APPROVED', new Set<CodeTaskStatus>(['RUNNING', 'CANCELLED'])],
  ['RUNNING', new Set<CodeTaskStatus>(['VERIFYING', 'FAILED', 'CANCELLED'])],
  ['VERIFYING', new Set<CodeTaskStatus>(['SUCCEEDED', 'FAILED'])],
  ['SUCCEEDED', new Set<CodeTaskStatus>(['COMMIT_PENDING', 'REJECTED'])],
  ['COMMIT_PENDING', new Set<CodeTaskStatus>(['COMMITTED', 'CANCELLED'])],
  ['COMMITTED', new Set<CodeTaskStatus>()],
  ['FAILED', new Set<CodeTaskStatus>()],
  ['REJECTED', new Set<CodeTaskStatus>()],
  ['CANCELLED', new Set<CodeTaskStatus>()],
]);

export const RUN_PAUSABLE_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'CREATED',
  'RUNNING_TESTS',
  'PLANNING_EXPLORATION',
  'RUNNING_EXPLORATION',
  'COLLECTING_ARTIFACTS',
  'FETCHING_TRACES',
  'FETCHING_LOGS',
  'ANALYZING_FAILURES',
  'AWAITING_CODE_ACTION',
  'RUNNING_CODE_TASK',
  'AWAITING_REVIEW',
  'READY_TO_COMMIT',
]);

export const RUN_CANCELLABLE_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'CREATED',
  'RUNNING_TESTS',
  'PLANNING_EXPLORATION',
  'RUNNING_EXPLORATION',
  'COLLECTING_ARTIFACTS',
  'FETCHING_TRACES',
  'FETCHING_LOGS',
  'ANALYZING_FAILURES',
  'AWAITING_CODE_ACTION',
  'RUNNING_CODE_TASK',
  'AWAITING_REVIEW',
  'READY_TO_COMMIT',
  'PAUSED',
]);

export function isRunTransitionAllowed(from: RunStatus, to: RunStatus): boolean {
  return RUN_ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!isRunTransitionAllowed(from, to)) {
    throw new Error(`Invalid Run transition: ${from} -> ${to}`);
  }
}

export function isRunTerminal(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.has(status);
}

export function isCodeTaskTransitionAllowed(from: CodeTaskStatus, to: CodeTaskStatus): boolean {
  return CODE_TASK_ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertCodeTaskTransition(from: CodeTaskStatus, to: CodeTaskStatus): void {
  if (!isCodeTaskTransitionAllowed(from, to)) {
    throw new Error(`Invalid CodeTask transition: ${from} -> ${to}`);
  }
}

export function isCodeTaskTerminal(status: CodeTaskStatus): boolean {
  return CODE_TASK_TERMINAL_STATUSES.has(status);
}
