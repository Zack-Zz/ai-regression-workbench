import type { TraceSummary, LogSummary } from '@zarb/shared-types';

export interface TrimmedContext {
  errorMessage?: string;
  recentErrorLogs: string[];
  topSlowSpans: Array<{ service?: string; operation?: string; durationMs?: number }>;
  failedSpans: Array<{ service?: string; operation?: string; message?: string }>;
  logHighlights: string[];
  screenshotPath?: string;
  verifyOutputSnippet?: string;
}

const MAX_ERROR_LOGS = 5;
const MAX_SLOW_SPANS = 3;
const MAX_FAILED_SPANS = 5;
const MAX_LOG_HIGHLIGHTS = 5;
const MAX_VERIFY_CHARS = 500;

/**
 * ContextTrimmer — trims raw diagnostics to a budget-safe context for prompt building.
 * Derived from ai-engine-design.md §5.2.
 */
export function trimContext(opts: {
  errorMessage?: string;
  traceSummary?: TraceSummary;
  logSummary?: LogSummary;
  screenshotPath?: string;
  verifyOutput?: string;
}): TrimmedContext {
  const recentErrorLogs = opts.logSummary?.errorSamples
    .slice(0, MAX_ERROR_LOGS)
    .map(s => `[${s.level ?? 'ERROR'}] ${s.message}`) ?? [];

  const topSlowSpans = opts.traceSummary?.topSlowSpans.slice(0, MAX_SLOW_SPANS) ?? [];
  const failedSpans = opts.traceSummary?.errorSpans.slice(0, MAX_FAILED_SPANS) ?? [];
  const logHighlights = opts.logSummary?.highlights.slice(0, MAX_LOG_HIGHLIGHTS) ?? [];

  const verifyOutputSnippet = opts.verifyOutput
    ? opts.verifyOutput.slice(0, MAX_VERIFY_CHARS)
    : undefined;

  return {
    ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
    recentErrorLogs,
    topSlowSpans,
    failedSpans,
    logHighlights,
    ...(opts.screenshotPath ? { screenshotPath: opts.screenshotPath } : {}),
    ...(verifyOutputSnippet ? { verifyOutputSnippet } : {}),
  };
}
