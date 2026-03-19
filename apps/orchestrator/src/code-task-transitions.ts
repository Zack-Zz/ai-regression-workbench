import type { CodeTaskStatus } from '@zarb/shared-types';
import {
  assertCodeTaskTransition as assertSharedCodeTaskTransition,
  isCodeTaskTerminal as isSharedCodeTaskTerminal,
  isCodeTaskTransitionAllowed as isSharedCodeTaskTransitionAllowed,
} from '@zarb/shared-types';

export function isCodeTaskTransitionAllowed(from: CodeTaskStatus, to: CodeTaskStatus): boolean {
  return isSharedCodeTaskTransitionAllowed(from, to);
}

export function assertCodeTaskTransition(from: CodeTaskStatus, to: CodeTaskStatus): void {
  assertSharedCodeTaskTransition(from, to);
}

export function isCodeTaskTerminal(status: CodeTaskStatus): boolean {
  return isSharedCodeTaskTerminal(status);
}
