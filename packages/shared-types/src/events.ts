export type SSEEventType =
  | 'run.created'
  | 'run.updated'
  | 'run.step.updated'
  | 'code-task.created'
  | 'code-task.updated';

export interface SSEEvent {
  type: SSEEventType;
  id?: string;
  projectId?: string;
  ts: number;
}
