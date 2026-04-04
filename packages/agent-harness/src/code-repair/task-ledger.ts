export type CodeRepairTaskId =
  | 'memory-selection'
  | 'plan'
  | 'apply'
  | 'verify'
  | 'retry-decision';

export type CodeRepairTaskOwner = 'runtime' | 'transport' | 'verification-agent';

export type CodeRepairTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface CodeRepairTaskItem {
  id: CodeRepairTaskId;
  title: string;
  owner: CodeRepairTaskOwner;
  status: CodeRepairTaskStatus;
  summary?: string;
  blocks: CodeRepairTaskId[];
  blockedBy: CodeRepairTaskId[];
}

const DEFAULT_TASKS: readonly CodeRepairTaskItem[] = [
  {
    id: 'memory-selection',
    title: 'Select relevant memories',
    owner: 'runtime',
    status: 'pending',
    blocks: ['plan'],
    blockedBy: [],
  },
  {
    id: 'plan',
    title: 'Prepare read-only repair plan',
    owner: 'runtime',
    status: 'pending',
    blocks: ['apply'],
    blockedBy: ['memory-selection'],
  },
  {
    id: 'apply',
    title: 'Apply code changes through transport',
    owner: 'transport',
    status: 'pending',
    blocks: ['verify'],
    blockedBy: ['plan'],
  },
  {
    id: 'verify',
    title: 'Run system verification and adversarial review',
    owner: 'verification-agent',
    status: 'pending',
    blocks: ['retry-decision'],
    blockedBy: ['apply'],
  },
  {
    id: 'retry-decision',
    title: 'Decide whether to retry or hand off to review',
    owner: 'verification-agent',
    status: 'blocked',
    summary: 'Only needed after apply or verification failure.',
    blocks: [],
    blockedBy: ['verify'],
  },
] as const;

export class CodeRepairTaskLedger {
  private readonly tasks = new Map<CodeRepairTaskId, CodeRepairTaskItem>();

  constructor(seed: readonly CodeRepairTaskItem[] = DEFAULT_TASKS) {
    for (const item of seed) {
      this.tasks.set(item.id, cloneItem(item));
    }
  }

  static fromSnapshot(snapshot: readonly CodeRepairTaskItem[]): CodeRepairTaskLedger {
    return new CodeRepairTaskLedger(snapshot);
  }

  start(id: CodeRepairTaskId, summary?: string): void {
    this.update(id, 'running', summary);
  }

  complete(id: CodeRepairTaskId, summary?: string): void {
    this.update(id, 'completed', summary);
  }

  fail(id: CodeRepairTaskId, summary?: string): void {
    this.update(id, 'failed', summary);
  }

  block(id: CodeRepairTaskId, summary?: string): void {
    this.update(id, 'blocked', summary);
  }

  skip(id: CodeRepairTaskId, summary?: string): void {
    this.update(id, 'skipped', summary);
  }

  snapshot(): CodeRepairTaskItem[] {
    return DEFAULT_TASKS.map((item) => cloneItem(this.mustGet(item.id)));
  }

  private update(id: CodeRepairTaskId, status: CodeRepairTaskStatus, summary?: string): void {
    const task = this.mustGet(id);
    this.tasks.set(id, {
      ...task,
      status,
      ...(summary !== undefined ? { summary } : {}),
    });
  }

  private mustGet(id: CodeRepairTaskId): CodeRepairTaskItem {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown code repair task: ${id}`);
    return task;
  }
}

function cloneItem(item: CodeRepairTaskItem): CodeRepairTaskItem {
  return {
    ...item,
    blocks: [...item.blocks],
    blockedBy: [...item.blockedBy],
  };
}
