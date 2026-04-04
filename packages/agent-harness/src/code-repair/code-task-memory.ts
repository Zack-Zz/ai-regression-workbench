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

  recordRetryDecision(input: Omit<CodeTaskMemoryEntry, 'id' | 'createdAt' | 'kind'> & { detail?: string }): void {
    this.recordFailure({ ...input, kind: 'retry-decision' });
  }

  selectRelevantMemories(input: {
    runId: string;
    taskId: string;
    testcaseId?: string;
    goal: string;
    scopePaths?: string[];
    verificationCommands?: string[];
    limit?: number;
  }): CodeTaskMemoryEntry[] {
    const rows = this.repo.listRelevant(input.runId, input.testcaseId, 24);
    const signals = buildSelectionSignals(input);
    return rows
      .map((row) => ({ row, score: scoreMemory(row, signals) }))
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

function scoreMemory(
  row: CodeTaskMemoryRow,
  signals: {
    taskId: string;
    testcaseId?: string;
    goalTerms: string[];
    scopePaths: Set<string>;
    scopeTerms: string[];
    verificationCommands: Set<string>;
    verificationTerms: string[];
  },
): number {
  let score = row.task_id === signals.taskId ? 12 : 0;
  if (row.parent_task_id === signals.taskId) score += 8;
  if (signals.testcaseId && row.testcase_id === signals.testcaseId) score += 6;
  if (row.kind === 'verify-failure') score += 4;
  if (row.kind === 'review-feedback') score += 3;
  if (row.kind === 'retry-decision') score += 2;

  const rowFiles = new Set(parseJsonArray(row.files_json));
  const rowCommands = new Set(parseJsonArray(row.commands_json));
  score += overlapScore(rowFiles, signals.scopePaths, 4);
  score += overlapScore(rowCommands, signals.verificationCommands, 3);

  const haystack = `${row.summary} ${row.detail ?? ''} ${row.files_json ?? ''} ${row.commands_json ?? ''}`.toLowerCase();
  for (const term of signals.goalTerms) {
    if (term.length < 3) continue;
    if (haystack.includes(term)) score += 1;
  }
  for (const term of signals.scopeTerms) {
    if (term.length < 3) continue;
    if (haystack.includes(term)) score += 1;
  }
  for (const term of signals.verificationTerms) {
    if (term.length < 3) continue;
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function compareDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

function buildSelectionSignals(input: {
  taskId: string;
  testcaseId?: string;
  goal: string;
  scopePaths?: string[];
  verificationCommands?: string[];
}): {
  taskId: string;
  testcaseId?: string;
  goalTerms: string[];
  scopePaths: Set<string>;
  scopeTerms: string[];
  verificationCommands: Set<string>;
  verificationTerms: string[];
} {
  const scopePaths = input.scopePaths ?? [];
  const verificationCommands = input.verificationCommands ?? [];
  return {
    taskId: input.taskId,
    ...(input.testcaseId ? { testcaseId: input.testcaseId } : {}),
    goalTerms: normalizeTerms(input.goal),
    scopePaths: new Set(scopePaths),
    scopeTerms: normalizeTerms(scopePaths.join(' ')),
    verificationCommands: new Set(verificationCommands),
    verificationTerms: normalizeTerms(verificationCommands.join(' ')),
  };
}

function overlapScore(left: Set<string>, right: Set<string>, weight: number): number {
  let score = 0;
  for (const value of left) {
    if (right.has(value)) score += weight;
  }
  return score;
}
