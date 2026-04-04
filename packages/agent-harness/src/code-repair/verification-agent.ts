import { VERIFICATION_AGENT_PROFILE } from '../runtime/agent-profile.js';
import type { CodeRepairContext } from '../runtime/agent-context-assembler.js';
import { CodeRepairPromptBuilder } from './prompt-builder.js';
import type { CodeRepairPlan } from './plan-agent.js';

export type CodeRepairVerificationVerdict = 'pass' | 'retry' | 'review';

export interface VerificationAssessmentInput {
  context: CodeRepairContext;
  plan: CodeRepairPlan;
  rawOutput: string;
  verifyPassed: boolean;
  verifyOutput: string;
  changedFiles: string[];
}

export interface VerificationAssessment {
  verdict: CodeRepairVerificationVerdict;
  summary: string;
  adversarialChecks: string[];
  retryPrompt?: string;
}

export class VerificationAgent {
  readonly profile = VERIFICATION_AGENT_PROFILE;

  constructor(private readonly promptBuilder = new CodeRepairPromptBuilder()) {}

  assess(input: VerificationAssessmentInput): VerificationAssessment {
    const outOfScopeFiles = findOutOfScopeFiles(input.changedFiles, input.context.scopePaths);
    const adversarialChecks = buildAdversarialChecks(input.context, input.plan, input.changedFiles, outOfScopeFiles);

    if (!input.verifyPassed) {
      const retryPrompt = this.promptBuilder.buildRetryPrompt(
        {
          ...input.context,
          verifyOutput: input.verifyOutput,
          verifyPassed: input.verifyPassed,
        },
        summarizeFailure(input.verifyOutput),
        input.verifyOutput,
      );
      return {
        verdict: 'retry',
        summary: `System verification failed. Re-run the repair with a narrower patch and explicitly address the failing checks before another verify attempt.`,
        adversarialChecks,
        retryPrompt: retryPrompt.prompt,
      };
    }

    if (outOfScopeFiles.length > 0) {
      return {
        verdict: 'review',
        summary: `System verification passed, but out-of-scope file changes require manual review: ${outOfScopeFiles.join(', ')}.`,
        adversarialChecks,
      };
    }

    return {
      verdict: 'pass',
      summary: input.changedFiles.length > 0
        ? `System verification passed for the declared scope. Changed files: ${input.changedFiles.join(', ')}.`
        : 'System verification passed and no changed files were detected.',
      adversarialChecks,
    };
  }
}

function buildAdversarialChecks(
  context: CodeRepairContext,
  plan: CodeRepairPlan,
  changedFiles: string[],
  outOfScopeFiles: string[],
): string[] {
  const checks = [
    context.verificationCommands.length > 0
      ? `Re-run declared verification commands and inspect failures: ${context.verificationCommands.join(', ')}.`
      : 'No verification commands were configured; confirm the expected checks before trusting this result.',
    plan.criticalFiles.length > 0
      ? `Compare actual file edits against the planned critical files: ${plan.criticalFiles.join(', ')}.`
      : 'Compare actual file edits against the intended scope before accepting the patch.',
    changedFiles.length > 0
      ? `Review the changed files for unintended side effects: ${changedFiles.join(', ')}.`
      : 'Review the workspace because no changed files were detected despite the repair attempt.',
  ];
  if (outOfScopeFiles.length > 0) {
    checks.push(`Investigate files outside the declared scope: ${outOfScopeFiles.join(', ')}.`);
  }
  return checks;
}

function findOutOfScopeFiles(changedFiles: string[], scopePaths: string[]): string[] {
  if (scopePaths.length === 0) return [];
  return changedFiles.filter((file) =>
    !scopePaths.some((scopePath) => matchesScope(file, scopePath)),
  );
}

function matchesScope(file: string, scopePath: string): boolean {
  if (file === scopePath) return true;
  const normalizedScope = scopePath.replace(/\/+$/, '');
  return file.startsWith(`${normalizedScope}/`);
}

function summarizeFailure(verifyOutput: string): string {
  const trimmed = verifyOutput.replace(/\s+/g, ' ').trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed || 'verification failed';
}
