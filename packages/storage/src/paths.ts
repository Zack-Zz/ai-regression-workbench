import { join } from 'node:path';

/**
 * All artifact paths are relative to `<dataRoot>`.
 * These helpers enforce the relative-path-only rule from storage-mapping-design.md §2.
 */

/**
 * Validate that a path segment is safe: non-empty, no `..`, no absolute path.
 * Throws if the segment is invalid.
 */
function assertSafeSegment(segment: string, label: string): void {
  if (!segment || segment.trim() === '') {
    throw new Error(`Path segment '${label}' must not be empty`);
  }
  if (segment.startsWith('/') || segment.startsWith('\\')) {
    throw new Error(`Path segment '${label}' must not be absolute: ${segment}`);
  }
  if (segment.split(/[/\\]/).some((part) => part === '..')) {
    throw new Error(`Path segment '${label}' must not contain '..': ${segment}`);
  }
}

export function runSnapshotPath(runId: string): string {
  assertSafeSegment(runId, 'runId');
  return join('runs', `${runId}.json`);
}

export function executionReportPath(runId: string): string {
  assertSafeSegment(runId, 'runId');
  return join('runs', `${runId}-execution-report.json`);
}

export function artifactsDir(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('artifacts', runId, testcaseId);
}

export function correlationContextPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'correlation-context.json');
}

export function traceSummaryPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'trace-summary.json');
}

export function logSummaryPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'log-summary.json');
}

export function executionProfilePath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'execution-profile.json');
}

export function apiCallsPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'api-calls.jsonl');
}

export function uiActionsPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'ui-actions.jsonl');
}

export function flowStepsPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('diagnostics', runId, testcaseId, 'flow-steps.json');
}

export function analysisPath(runId: string, testcaseId: string): string {
  assertSafeSegment(runId, 'runId');
  assertSafeSegment(testcaseId, 'testcaseId');
  return join('analysis', runId, `${testcaseId}.json`);
}

export function findingsPath(runId: string): string {
  assertSafeSegment(runId, 'runId');
  return join('analysis', runId, 'findings.json');
}

export function codeTaskInputPath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('code-tasks', taskId, 'input.json');
}

export function codeTaskRawOutputPath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('code-tasks', taskId, 'raw-output.txt');
}

export function codeTaskDiffPath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('code-tasks', taskId, 'changes.diff');
}

export function codeTaskPatchPath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('code-tasks', taskId, 'changes.patch');
}

export function codeTaskVerifyPath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('code-tasks', taskId, 'verify.txt');
}

export function commitFilePath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('commits', `${taskId}.json`);
}

export function agentTraceDir(sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return join('agent-traces', sessionId);
}

export function agentContextSummaryPath(sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return join('agent-traces', sessionId, 'context-summary.json');
}

export function agentStepsPath(sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return join('agent-traces', sessionId, 'steps.jsonl');
}

export function agentToolCallsPath(sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return join('agent-traces', sessionId, 'tool-calls.jsonl');
}

export function agentPromptSamplesPath(sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return join('agent-traces', sessionId, 'prompt-samples.jsonl');
}

export function generatedTestPath(taskId: string): string {
  assertSafeSegment(taskId, 'taskId');
  return join('generated-tests', taskId, 'candidate.spec.ts');
}
