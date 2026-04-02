import { randomUUID } from 'node:crypto';
import { CodeTaskMemoryRepository } from '@zarb/storage';
import type { CodeTaskMemoryRow, Db } from '@zarb/storage';

export interface CodeTaskMemoryEntry {
  id: string;
  runId: string;
  taskId: string;
  parentTaskId?: string;
  testcaseId?: string;
  attempt: number;
  kind: 'apply-failure' | 'verify-failure' | 'review-feedback' | 'retry-decision';
  summary: string;
  detail?: string;
  files: string[];
  commands: string[];
  createdAt: string;
}

export class CodeTaskMemory {
  private readonly repo: CodeTaskMemoryRepository;

  constructor(db: Db) {
    this.repo = new CodeTaskMemoryRepository(db);
  }

  recordFailure(input: Omit<CodeTaskMemoryEntry, 'id' | 'createdAt'> & { detail?: string }): void {
    this.repo.save({
      id: randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.testcaseId ? { testcaseId: input.testcaseId } : {}),
      attempt: input.attempt,
      kind: input.kind,
      summary: input.summary,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.files.length > 0 ? { filesJson: JSON.stringify(input.files) } : {}),
      ...(input.commands.length > 0 ? { commandsJson: JSON.stringify(input.commands) } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  recordReview(input: Omit<CodeTaskMemoryEntry, 'id' | 'createdAt' | 'kind'> & { detail?: string }): void {
    this.recordFailure({ ...input, kind: 'review-feedback' });
  }

  selectRelevantMemories(input: {
    runId: string;
    taskId: string;
    testcaseId?: string;
    goal: string;
    limit?: number;
  }): CodeTaskMemoryEntry[] {
    const rows = this.repo.listRelevant(input.runId, input.testcaseId, 24);
    const goalTerms = normalizeTerms(input.goal);
    return rows
      .map((row) => ({ row, score: scoreMemory(row, goalTerms, input.taskId) }))
      .sort((a, b) => b.score - a.score || compareDesc(a.row.created_at, b.row.created_at))
      .slice(0, input.limit ?? 5)
      .map(({ row }) => toEntry(row));
  }
}

function toEntry(row: CodeTaskMemoryRow): CodeTaskMemoryEntry {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.testcase_id ? { testcaseId: row.testcase_id } : {}),
    attempt: row.attempt,
    kind: row.kind,
    summary: row.summary,
    ...(row.detail ? { detail: row.detail } : {}),
    files: parseJsonArray(row.files_json),
    commands: parseJsonArray(row.commands_json),
    createdAt: row.created_at,
  };
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeTerms(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_./-]+/i).filter(Boolean);
}

function scoreMemory(row: CodeTaskMemoryRow, goalTerms: string[], taskId: string): number {
  let score = row.task_id === taskId ? 12 : 0;
  if (row.parent_task_id === taskId) score += 8;
  if (row.kind === 'verify-failure') score += 4;
  if (row.kind === 'review-feedback') score += 3;
  const haystack = `${row.summary} ${row.detail ?? ''} ${row.files_json ?? ''} ${row.commands_json ?? ''}`.toLowerCase();
  for (const term of goalTerms) {
    if (term.length < 3) continue;
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function compareDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
