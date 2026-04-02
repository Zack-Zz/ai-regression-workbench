export type CodeTaskMemoryKind =
  | 'apply-failure'
  | 'verify-failure'
  | 'review-feedback'
  | 'retry-decision';

export interface CodeTaskMemoryEntry {
  id: string;
  runId: string;
  taskId: string;
  parentTaskId?: string;
  testcaseId?: string;
  attempt: number;
  kind: CodeTaskMemoryKind;
  summary: string;
  detail?: string;
  files: string[];
  commands: string[];
  createdAt: string;
}
