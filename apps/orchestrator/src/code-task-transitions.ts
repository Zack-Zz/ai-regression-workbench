import type { CodeTaskStatus } from '@zarb/shared-types';
import { CODE_TASK_TERMINAL_STATUSES } from '@zarb/shared-types';

/**
 * Valid (from -> to) transitions for CodeTask status.
 * Derived from design.md §8 state machine diagram.
 */
const ALLOWED: ReadonlyMap<CodeTaskStatus, ReadonlySet<CodeTaskStatus>> = new Map([
  ['DRAFT', new Set<CodeTaskStatus>(['PENDING_APPROVAL', 'CANCELLED'])],
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

export function isCodeTaskTransitionAllowed(from: CodeTaskStatus, to: CodeTaskStatus): boolean {
  return ALLOWED.get(from)?.has(to) ?? false;
}

export function assertCodeTaskTransition(from: CodeTaskStatus, to: CodeTaskStatus): void {
  if (!isCodeTaskTransitionAllowed(from, to)) {
    throw new Error(`Invalid CodeTask transition: ${from} -> ${to}`);
  }
}

export function isCodeTaskTerminal(status: CodeTaskStatus): boolean {
  return CODE_TASK_TERMINAL_STATUSES.has(status);
}
