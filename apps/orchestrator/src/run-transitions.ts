import type { RunStatus } from '@zarb/shared-types';
import {
  assertRunTransition as assertSharedRunTransition,
  isRunTerminal as isSharedRunTerminal,
  isRunTransitionAllowed as isSharedRunTransitionAllowed,
  RUN_CANCELLABLE_STATUSES,
  RUN_PAUSABLE_STATUSES,
} from '@zarb/shared-types';

export function isRunTransitionAllowed(from: RunStatus, to: RunStatus): boolean {
  return isSharedRunTransitionAllowed(from, to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  assertSharedRunTransition(from, to);
}

export function isRunTerminal(status: RunStatus): boolean {
  return isSharedRunTerminal(status);
}

export const PAUSABLE_RUN_STATUSES = RUN_PAUSABLE_STATUSES;

export const CANCELLABLE_RUN_STATUSES = RUN_CANCELLABLE_STATUSES;
