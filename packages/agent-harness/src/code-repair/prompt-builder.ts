import { HARNESS_TEMPLATE_VERSIONS, renderHarnessTemplate } from '../prompt-loader.js';
import type { CodeRepairContext } from '../runtime/agent-context-assembler.js';

export interface CodeRepairPromptBundle {
  phase: 'code-repair-plan' | 'code-repair-apply' | 'code-repair-verify' | 'code-repair-retry';
  templateVersion: string;
  prompt: string;
  promptContextSummary: string;
}

export class CodeRepairPromptBuilder {
  buildPlanPrompt(context: CodeRepairContext): CodeRepairPromptBundle {
    return {
      phase: 'code-repair-plan',
      templateVersion: HARNESS_TEMPLATE_VERSIONS.codeRepairPlan,
      prompt: renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.codeRepairPlan, buildPromptVars(context, {})),
      promptContextSummary: summarizeContext(context),
    };
  }

  buildApplyPrompt(context: CodeRepairContext, planSummary: string): CodeRepairPromptBundle {
    return {
      phase: 'code-repair-apply',
      templateVersion: HARNESS_TEMPLATE_VERSIONS.codeRepairApply,
      prompt: renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.codeRepairApply, buildPromptVars(context, { planSummary })),
      promptContextSummary: `${summarizeContext(context)} plan=${truncate(planSummary, 160)}`,
    };
  }

  buildVerifyPrompt(context: CodeRepairContext, applyOutputSummary: string): CodeRepairPromptBundle {
    return {
      phase: 'code-repair-verify',
      templateVersion: HARNESS_TEMPLATE_VERSIONS.codeRepairVerify,
      prompt: renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.codeRepairVerify, buildPromptVars(context, { applyOutputSummary })),
      promptContextSummary: `${summarizeContext(context)} apply=${truncate(applyOutputSummary, 120)}`,
    };
  }

  buildRetryPrompt(context: CodeRepairContext, failureSummary: string, verifyOutput: string): CodeRepairPromptBundle {
    return {
      phase: 'code-repair-retry',
      templateVersion: HARNESS_TEMPLATE_VERSIONS.codeRepairRetry,
      prompt: renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.codeRepairRetry, buildPromptVars(context, {
        failureSummary,
        verifyOutput,
      })),
      promptContextSummary: `${summarizeContext(context)} retry=${truncate(failureSummary, 120)}`,
    };
  }
}

function buildPromptVars(
  context: CodeRepairContext,
  overrides: Partial<Record<'planSummary' | 'applyOutputSummary' | 'failureSummary' | 'verifyOutput', string>>,
): Record<string, string> {
  return {
    taskId: context.taskId,
    runId: context.runId,
    attempt: String(context.attempt),
    workspacePath: context.workspacePath,
    goal: context.goal,
    scopePaths: joinOrFallback(context.scopePaths),
    constraints: joinOrFallback(context.constraints),
    verificationCommands: joinOrFallback(context.verificationCommands),
    failureAnalysis: context.analysisSummary ?? context.probableCause ?? 'none',
    relevantMemories: context.relevantMemories.length > 0
      ? context.relevantMemories.map((item) => `- [${item.kind}] ${item.summary}${item.detail ? ` :: ${item.detail}` : ''}`).join('\n')
      : 'none',
    planSummary: overrides.planSummary ?? 'Plan should identify likely files, expected edits, and verification order.',
    applyOutputSummary: overrides.applyOutputSummary ?? 'pending',
    failureSummary: overrides.failureSummary ?? 'none',
    verifyOutput: overrides.verifyOutput || context.verifyOutput || 'none',
  };
}

function summarizeContext(context: CodeRepairContext): string {
  return [
    `attempt=${String(context.attempt)}`,
    `scope=${String(context.scopePaths.length)}`,
    `constraints=${String(context.constraints.length)}`,
    `verifyCommands=${String(context.verificationCommands.length)}`,
    `memories=${String(context.relevantMemories.length)}`,
    ...(context.analysisSummary ? [`analysis=${truncate(context.analysisSummary, 80)}`] : []),
  ].join(' ');
}

function joinOrFallback(values: string[]): string {
  return values.length > 0 ? values.join('\n') : 'none';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
