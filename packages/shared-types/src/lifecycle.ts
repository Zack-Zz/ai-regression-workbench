import type { CodeTaskStatus, RunStatus } from './enums.js';

export const RUN_CODE_TASK_COORDINATION_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'ANALYZING_FAILURES',
  'AWAITING_CODE_ACTION',
  'RUNNING_CODE_TASK',
  'AWAITING_REVIEW',
  'READY_TO_COMMIT',
  'COMPLETED',
]);

export function isRunInCodeTaskCoordinationStage(status: RunStatus): boolean {
  return RUN_CODE_TASK_COORDINATION_STATUSES.has(status);
}

export function deriveRunStatusFromCodeTasks(taskStatuses: Iterable<CodeTaskStatus>): RunStatus | null {
  const statuses = Array.from(taskStatuses);
  if (statuses.length === 0) return null;
  const has = (status: CodeTaskStatus) => statuses.includes(status);

  if (has('RUNNING') || has('VERIFYING')) {
    return 'RUNNING_CODE_TASK';
  }
  if (has('COMMIT_PENDING')) {
    return 'READY_TO_COMMIT';
  }
  if (has('SUCCEEDED')) {
    return 'AWAITING_REVIEW';
  }
  if (has('DRAFT') || has('PENDING_APPROVAL') || has('APPROVED')) {
    return 'AWAITING_CODE_ACTION';
  }
  return 'COMPLETED';
}
