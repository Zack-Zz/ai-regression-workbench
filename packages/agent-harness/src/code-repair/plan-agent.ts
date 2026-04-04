import { PLAN_AGENT_PROFILE } from '../runtime/agent-profile.js';
import type { CodeRepairContext } from '../runtime/agent-context-assembler.js';

export interface CodeRepairPlan {
  readOnly: true;
  summary: string;
  criticalFiles: string[];
  checklist: string[];
  retryStrategy: string[];
}

export class ReadOnlyPlanAgent {
  readonly profile = PLAN_AGENT_PROFILE;

  plan(context: CodeRepairContext): CodeRepairPlan {
    const criticalFiles = selectCriticalFiles(context);
    const retryStrategy = deriveRetryStrategy(context, criticalFiles);
    const checklist = [
      'Inspect the critical files before editing anything.',
      'Make the smallest change that fixes the goal without violating constraints.',
      retryStrategy.length > 0
        ? 'Make this attempt materially different from the recorded failed approaches before broadening scope.'
        : 'Prefer the most direct fix path before broadening scope.',
      context.verificationCommands.length > 0
        ? 'Run verification in the declared order and compare against prior failures.'
        : 'Prepare verification steps before requesting follow-up execution.',
    ];

    const summaryParts = [
      `Read-only plan for task ${context.taskId}.`,
      criticalFiles.length > 0
        ? `Likely files: ${criticalFiles.join(', ')}.`
        : 'Likely files: none declared; inspect the workspace carefully.',
      context.analysisSummary ? `Observed issue: ${truncate(context.analysisSummary, 160)}.` : undefined,
      context.probableCause ? `Probable cause: ${truncate(context.probableCause, 160)}.` : undefined,
      context.constraints.length > 0 ? `Keep these constraints: ${context.constraints.join('; ')}.` : undefined,
      context.relevantMemories.length > 0
        ? `Avoid repeating ${String(context.relevantMemories.length)} prior failed approaches.`
        : undefined,
      retryStrategy.length > 0 ? `Retry strategy: ${retryStrategy.join(' ')}` : undefined,
    ].filter((value): value is string => Boolean(value));

    return {
      readOnly: true,
      summary: summaryParts.join(' '),
      criticalFiles,
      checklist,
      retryStrategy,
    };
  }
}

function deriveRetryStrategy(context: CodeRepairContext, criticalFiles: string[]): string[] {
  const compactCarryOver = context.relevantMemories.find((item) =>
    item.kind === 'retry-decision'
    && typeof item.summary === 'string'
    && item.summary.includes('auto compact carry-over'),
  );

  const strategy: string[] = [];
  if (compactCarryOver) {
    const compactedAttempts = parseCompactedAttempts(compactCarryOver.detail);
    const repeatedFiles = findRepeatedFiles(compactedAttempts);
    const touchedFiles = repeatedFiles.length > 0 ? repeatedFiles : collectTouchedFiles(compactedAttempts);
    const widenTargets = criticalFiles.filter((file) => !touchedFiles.includes(file));
    const repeatedSignals = findRepeatedSignals(compactedAttempts);

    pushUnique(
      strategy,
      'Base this attempt on the compacted carry-over history instead of replaying the earlier verbose failure logs.',
    );
    if (repeatedFiles.length > 0) {
      pushUnique(
        strategy,
        `Previous failures repeatedly touched: ${repeatedFiles.join(', ')}. Do not repeat the same narrow edit limited to those files.`,
      );
    } else if (touchedFiles.length > 0) {
      pushUnique(
        strategy,
        `Previous failed attempt focused on: ${touchedFiles.join(', ')}. Do not repeat the same narrow edit limited to those files.`,
      );
    } else {
      pushUnique(
        strategy,
        'Make this retry materially different from the summarized failed approaches before expanding scope.',
      );
    }
    if (repeatedSignals.length > 0) {
      pushUnique(
        strategy,
        `Repeated failing verification signal: "${truncate(repeatedSignals[0] ?? '', 120)}". Make the next edit prove that this exact signal disappears.`,
      );
    }
    if (compactedAttempts.some((attempt) => attempt.files.length === 0)) {
      pushUnique(
        strategy,
        'At least one failed attempt produced no persisted file changes. Ensure the next attempt lands a concrete diff in the intended scope before another verify run.',
      );
    }
    if (widenTargets.length > 0) {
      pushUnique(
        strategy,
        `Widen inspection to adjacent targets that were not consistently changed in failed attempts: ${widenTargets.join(', ')}.`,
      );
    }
    if (compactedAttempts.some((attempt) => /helper-only/i.test(attempt.note))) {
      pushUnique(
        strategy,
        'Avoid another helper-only style edit that leaves the observable failing behavior unchanged.',
      );
    }
  } else if (context.relevantMemories.length > 0) {
    pushUnique(
      strategy,
      'Use the recorded failure memories to choose a different edit direction than the previous attempts.',
    );
  }

  if (context.verificationCommands.length > 0) {
    pushUnique(
      strategy,
      `Optimize specifically for the declared verification path: ${context.verificationCommands.join(', ')}.`,
    );
  }

  return finalizeStrategy(strategy);
}

interface CompactedAttemptRecord {
  files: string[];
  note: string;
}

function parseCompactedAttempts(detail?: string): CompactedAttemptRecord[] {
  if (!detail) return [];
  const recentLine = detail.split('\n').find((line) => line.startsWith('Recent attempts: '));
  if (!recentLine) return [];
  const rawAttempts = recentLine.slice('Recent attempts: '.length).split(' | ');

  return rawAttempts.map((value) => {
    const filesMatch = value.match(/files=([^]+?) note=/);
    const noteMatch = value.match(/ note=([^]+)$/);
    const files = filesMatch
      ? (filesMatch[1] ?? '').split(',').map((item) => item.trim()).filter(Boolean)
      : [];
    return {
      files: files.length === 1 && files[0]?.toLowerCase() === 'none' ? [] : files,
      note: noteMatch ? (noteMatch[1] ?? '').trim() : '',
    };
  });
}

function findRepeatedFiles(attempts: CompactedAttemptRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    for (const file of new Set(attempt.files)) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([file]) => file);
}

function collectTouchedFiles(attempts: CompactedAttemptRecord[]): string[] {
  const touched: string[] = [];
  for (const attempt of attempts) {
    for (const file of attempt.files) {
      if (!touched.includes(file)) touched.push(file);
    }
  }
  return touched;
}

function findRepeatedSignals(attempts: CompactedAttemptRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    const signal = normalizeSignal(attempt.note);
    if (!signal) continue;
    counts.set(signal, (counts.get(signal) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([signal]) => signal);
}

function normalizeSignal(note: string): string {
  const normalized = note.replace(/\s+/g, ' ').trim();
  return normalized && normalized.toLowerCase() !== 'empty output'
    ? normalized
    : '';
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function finalizeStrategy(strategy: string[]): string[] {
  const verificationPath = strategy.find((item) => item.startsWith('Optimize specifically for the declared verification path: '));
  const body = verificationPath
    ? strategy.filter((item) => item !== verificationPath)
    : strategy;

  if (!verificationPath) return body.slice(0, 5);
  return [...body.slice(0, 4), verificationPath];
}

function selectCriticalFiles(context: CodeRepairContext): string[] {
  const candidates = [
    ...context.scopePaths,
    ...context.relevantMemories.flatMap((item) => item.files ?? []),
  ];
  const deduped: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || deduped.includes(candidate)) continue;
    deduped.push(candidate);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
