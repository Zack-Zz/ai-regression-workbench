import type { AnalysisRow, CodeTaskRow, Db } from '@zarb/storage';
import {
  CODE_REPAIR_AGENT_PROFILE,
  AgentContextAssembler,
  HarnessSessionManager,
  ToolExecutionPlanner,
  ToolRegistry,
  buildApproxBudgetSnapshot,
  estimateApproxTokens,
  isApproxBudgetExceeded,
} from '../runtime/index.js';
import type { AgentAssemblyInput, ApproxBudgetSnapshot, GenerateArtifactsResult, ToolDescriptor, ToolCallResult } from '../runtime/index.js';
import type { CodeRepairTransport } from '../codex-cli-agent.js';
import { CodeRepairPromptBuilder } from './prompt-builder.js';
import { CodeTaskMemory } from './code-task-memory.js';
import type { CodeTaskMemoryEntry } from './code-task-memory.js';
import { ReadOnlyPlanAgent } from './plan-agent.js';
import type { CodeRepairPlan } from './plan-agent.js';
import { VerificationAgent } from './verification-agent.js';
import type { CodeRepairVerificationVerdict } from './verification-agent.js';
import { CodeRepairTaskLedger } from './task-ledger.js';
import type { CodeRepairTaskItem } from './task-ledger.js';

export interface CodeRepairExecutionInput {
  task: CodeTaskRow;
  sessionId: string;
  dataRoot: string;
  analysis?: AnalysisRow;
  carryoverMemories?: CodeTaskMemoryEntry[];
  suppressCurrentTaskMemories?: boolean;
  stepOffset?: number;
}

export interface CodeRepairExecutionResult {
  rawOutput: string;
  exitCode: number;
  contextSummary: string;
  plan: CodeRepairPlan;
  planSummary: string;
  verifyPrompt?: string;
  retryPrompt?: string;
  relevantMemories: CodeTaskMemoryEntry[];
  taskLedger: CodeRepairTaskItem[];
}

export interface CodeRepairVerificationInput {
  task: CodeTaskRow;
  sessionId: string;
  dataRoot: string;
  plan: CodeRepairPlan;
  rawOutput: string;
  verifyPassed: boolean;
  verifyOutput: string;
  changedFiles: string[];
  relevantMemories: CodeTaskMemoryEntry[];
  taskLedger: CodeRepairTaskItem[];
  analysis?: AnalysisRow;
  stepOffset?: number;
}

export interface CodeRepairVerificationResult {
  verdict: CodeRepairVerificationVerdict;
  summary: string;
  adversarialChecks: string[];
  retryPrompt?: string;
  taskLedger: CodeRepairTaskItem[];
}

export interface CodeRepairLoopInput {
  task: CodeTaskRow;
  sessionId: string;
  dataRoot: string;
  analysis?: AnalysisRow;
  maxAttempts?: number;
  tokenBudget?: number;
  enableAutoCompact?: boolean;
  maxCompactions?: number;
  stopHooks?: CodeRepairStopHook[];
  onAttemptStart?: (attemptNumber: number) => void | Promise<void>;
  onVerificationStart?: (attemptNumber: number, execution: CodeRepairExecutionResult) => void | Promise<void>;
  verify: (input: { attemptNumber: number; execution: CodeRepairExecutionResult }) => GenerateArtifactsResult | Promise<GenerateArtifactsResult>;
}

export interface CodeRepairLoopAttempt {
  attemptNumber: number;
  execution: CodeRepairExecutionResult;
  artifacts?: GenerateArtifactsResult;
  verification?: CodeRepairVerificationResult;
}

export interface CodeRepairLoopBudget extends ApproxBudgetSnapshot {
  maxAttempts: number;
  attemptsUsed: number;
}

export interface CodeRepairLoopResult {
  finalStatus: 'SUCCEEDED' | 'FAILED';
  stopReason: 'succeeded' | 'apply_failed' | 'verification_failed' | 'budget_exhausted' | 'token_budget_exhausted' | 'no_progress';
  attempts: CodeRepairLoopAttempt[];
  finalExecution: CodeRepairExecutionResult;
  finalArtifacts?: GenerateArtifactsResult;
  finalVerification?: CodeRepairVerificationResult;
  budget: CodeRepairLoopBudget;
  summary: string;
}

export interface CodeRepairStopHookInput {
  task: CodeTaskRow;
  sessionId: string;
  dataRoot: string;
  result: CodeRepairLoopResult;
  budget: CodeRepairLoopBudget;
}

export type CodeRepairStopHook = (input: CodeRepairStopHookInput) => void | Promise<void>;

export class CodeRepairAgent {
  private readonly profile = CODE_REPAIR_AGENT_PROFILE;
  private readonly assembler = new AgentContextAssembler();
  private readonly promptBuilder = new CodeRepairPromptBuilder();
  private readonly planAgent = new ReadOnlyPlanAgent();
  private readonly verificationAgent = new VerificationAgent(this.promptBuilder);
  private readonly memory: CodeTaskMemory;
  private readonly planner: ToolExecutionPlanner<{ relevantMemories: CodeTaskMemoryEntry[] }>;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    db: Db,
    private readonly transport: CodeRepairTransport,
    private readonly sessionManager: HarnessSessionManager,
  ) {
    this.memory = new CodeTaskMemory(db);
    this.toolRegistry = new ToolRegistry({
      requireApprovalFor: [],
      toolCallTimeoutMs: 5_000,
    });
    const memorySelector: ToolDescriptor<
      {
        runId: string;
        taskId: string;
        testcaseId?: string;
        goal: string;
        scopePaths?: string[];
        verificationCommands?: string[];
        limit?: number;
      },
      CodeTaskMemoryEntry[],
      { relevantMemories: CodeTaskMemoryEntry[] }
    > = {
      handler: async (input) => this.memory.selectRelevantMemories(input as {
        runId: string;
        taskId: string;
        testcaseId?: string;
        goal: string;
        scopePaths?: string[];
        verificationCommands?: string[];
        limit?: number;
      }),
      isReadOnly: true,
      isConcurrencySafe: true,
      summarizeResult: (value) => `selected ${String((value as CodeTaskMemoryEntry[]).length)} memories`,
      modifyContext: (context, result: ToolCallResult<CodeTaskMemoryEntry[]>) => ({
        ...context,
        relevantMemories: result.value ?? context.relevantMemories,
      }),
    };
    this.toolRegistry.register('code-repair.memory.select', memorySelector);
    this.planner = new ToolExecutionPlanner(this.toolRegistry);
  }

  async execute(input: CodeRepairExecutionInput): Promise<CodeRepairExecutionResult> {
    const stepOffset = input.stepOffset ?? 0;
    const taskLedger = new CodeRepairTaskLedger();
    taskLedger.start('memory-selection');
    const memoryResult = await this.planner.execute([
      {
        toolName: 'code-repair.memory.select',
        input: {
          runId: input.task.run_id,
          taskId: input.task.task_id,
          ...(input.task.testcase_id ? { testcaseId: input.task.testcase_id } : {}),
          goal: input.task.goal,
          scopePaths: parseJsonArray(input.task.scope_paths_json),
          verificationCommands: parseJsonArray(input.task.verification_commands_json),
          limit: 5,
        },
      },
    ], { sessionId: input.sessionId, stepIndex: 0 }, { relevantMemories: [] });

    for (const result of memoryResult.results) {
      this.sessionManager.appendToolCall(input.sessionId, result.record, input.dataRoot);
    }
    const relevantMemories = mergeRelevantMemories(
      memoryResult.context.relevantMemories,
      input.carryoverMemories ?? [],
      input.task.task_id,
      input.suppressCurrentTaskMemories ?? false,
    );
    taskLedger.complete(
      'memory-selection',
      relevantMemories.length > 0
        ? `Prepared ${String(relevantMemories.length)} relevant memories${input.carryoverMemories?.length ? ` including ${String(input.carryoverMemories.length)} compacted carry-over memories` : ''}.`
        : 'No prior memories were selected for this task.',
    );

    const contextInput: AgentAssemblyInput = {
      task: input.task,
      relevantMemories: relevantMemories.map((item) => ({
        kind: item.kind,
        summary: item.summary,
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.files.length > 0 ? { files: item.files } : {}),
        ...(item.commands.length > 0 ? { commands: item.commands } : {}),
      })),
    };
    if (input.analysis) contextInput.analysis = input.analysis;
    const context = this.assembler.assembleCodeRepairContext(contextInput);
    const contextSummary = this.assembler.summarizeCodeRepairContext(context);
    taskLedger.start('plan');
    const plan = this.planAgent.plan(context);
    const planSummary = plan.summary;
    taskLedger.complete('plan', planSummary);

    const planPrompt = this.promptBuilder.buildPlanPrompt(context);
    this.sessionManager.appendPromptSample(input.sessionId, {
      sessionId: input.sessionId,
      stepIndex: stepOffset + 0,
      timestamp: new Date().toISOString(),
      phase: planPrompt.phase,
      templateVersion: planPrompt.templateVersion,
      prompt: planPrompt.prompt,
      response: formatPlan(plan),
      promptContextSummary: planPrompt.promptContextSummary,
      sampledBy: 'forced',
    }, input.dataRoot);
    this.sessionManager.appendStep(input.sessionId, {
      stepIndex: stepOffset + 0,
      description: `${this.profile.name} plan`,
      outcome: planSummary,
      timestamp: new Date().toISOString(),
    }, input.dataRoot);

    taskLedger.start('apply');
    const applyPrompt = this.promptBuilder.buildApplyPrompt(context, plan);
    const agentResult = await this.transport.run({
      workspacePath: input.task.workspace_path,
      prompt: applyPrompt.prompt,
    });
    this.sessionManager.appendPromptSample(input.sessionId, {
      sessionId: input.sessionId,
      stepIndex: stepOffset + 1,
      timestamp: new Date().toISOString(),
      phase: applyPrompt.phase,
      templateVersion: applyPrompt.templateVersion,
      prompt: applyPrompt.prompt,
      response: agentResult.rawOutput,
      promptContextSummary: applyPrompt.promptContextSummary,
      sampledBy: 'forced',
    }, input.dataRoot);
    this.sessionManager.appendStep(input.sessionId, {
      stepIndex: stepOffset + 1,
      description: `${this.transport.name} apply`,
      outcome: agentResult.exitCode === 0 ? 'ok' : `exit ${String(agentResult.exitCode)}`,
      timestamp: new Date().toISOString(),
    }, input.dataRoot);

    if (agentResult.exitCode !== 0) {
      taskLedger.fail('apply', `Transport exited with code ${String(agentResult.exitCode)}.`);
      taskLedger.block('verify', 'Apply failed before system verification could run.');
      const retryPrompt = this.promptBuilder.buildRetryPrompt(
        context,
        `transport exited with code ${String(agentResult.exitCode)}`,
        '',
      );
      taskLedger.complete('retry-decision', 'Retry is recommended because apply failed before verification.');
      this.sessionManager.appendPromptSample(input.sessionId, {
        sessionId: input.sessionId,
        stepIndex: stepOffset + 2,
        timestamp: new Date().toISOString(),
        phase: retryPrompt.phase,
        templateVersion: retryPrompt.templateVersion,
        prompt: retryPrompt.prompt,
        response: 'retry recommended',
        promptContextSummary: retryPrompt.promptContextSummary,
        sampledBy: 'forced',
      }, input.dataRoot);
      return {
        rawOutput: agentResult.rawOutput,
        exitCode: agentResult.exitCode,
        contextSummary,
        plan,
        planSummary,
        retryPrompt: retryPrompt.prompt,
        relevantMemories,
        taskLedger: taskLedger.snapshot(),
      };
    }
    taskLedger.complete('apply', 'Transport completed successfully.');

    const verifyPrompt = this.promptBuilder.buildVerifyPrompt(context, summarizeOutput(agentResult.rawOutput));
    this.sessionManager.appendPromptSample(input.sessionId, {
      sessionId: input.sessionId,
      stepIndex: stepOffset + 2,
      timestamp: new Date().toISOString(),
      phase: verifyPrompt.phase,
      templateVersion: verifyPrompt.templateVersion,
      prompt: verifyPrompt.prompt,
      response: context.verificationCommands.join('\n') || 'no verification commands configured',
      promptContextSummary: verifyPrompt.promptContextSummary,
      sampledBy: 'forced',
    }, input.dataRoot);

    return {
      rawOutput: agentResult.rawOutput,
      exitCode: agentResult.exitCode,
      contextSummary,
      plan,
      planSummary,
      verifyPrompt: verifyPrompt.prompt,
      relevantMemories,
      taskLedger: taskLedger.snapshot(),
    };
  }

  async executeUntilSettled(input: CodeRepairLoopInput): Promise<CodeRepairLoopResult> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? this.profile.maxTurns);
    const tokenBudget = input.tokenBudget ?? this.profile.approxTokenBudget;
    const enableAutoCompact = input.enableAutoCompact ?? true;
    const maxCompactions = Math.max(0, input.maxCompactions ?? 1);
    const attempts: CodeRepairLoopAttempt[] = [];
    let carryoverMemories: CodeTaskMemoryEntry[] = [];
    let suppressCurrentTaskMemories = false;
    let usedTokens = 0;
    let compactionsUsed = 0;

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      await input.onAttemptStart?.(attemptNumber);
      const execution = await this.execute({
        task: input.task,
        sessionId: input.sessionId,
        dataRoot: input.dataRoot,
        ...(input.analysis ? { analysis: input.analysis } : {}),
        ...(carryoverMemories.length > 0 ? { carryoverMemories } : {}),
        ...(suppressCurrentTaskMemories ? { suppressCurrentTaskMemories } : {}),
        stepOffset: (attemptNumber - 1) * 10,
      });
      carryoverMemories = [];
      suppressCurrentTaskMemories = false;

      if (execution.exitCode !== 0) {
        this.recordApplyFailure(
          input.task,
          `transport execution failed on attempt ${String(attemptNumber)}`,
          execution.rawOutput,
        );
        const willRetry = attemptNumber < maxAttempts && Boolean(execution.retryPrompt);
        usedTokens += estimateExecutionTokens(execution);
        const tokenBudgetReached = willRetry && isApproxBudgetExceeded(usedTokens, tokenBudget);
        const retryDecisionSummary = execution.retryPrompt
          ? tokenBudgetReached
            ? 'Automatic retry was recommended after apply failure, but the token budget was exhausted.'
            : willRetry
              ? 'Automatic retry approved because apply failed before verification.'
              : 'Automatic retry was recommended after apply failure, but the attempt budget was exhausted.'
          : undefined;
        const finalExecution = execution.retryPrompt
          ? withExecutionRetryDecision(
            execution,
            retryDecisionSummary ?? 'Automatic retry decision recorded.',
          )
          : execution;
        const failedAttempt: CodeRepairLoopAttempt = { attemptNumber, execution: finalExecution };
        attempts.push(failedAttempt);
        if (tokenBudgetReached && execution.retryPrompt) {
          if (enableAutoCompact && compactionsUsed < maxCompactions) {
            const compacted = this.tryAutoCompact({
              input,
              attemptNumber,
              attempts,
              usedTokens,
              tokenBudget,
              reason: 'apply failure',
            });
            if (compacted.applied) {
              carryoverMemories = [compacted.memory];
              suppressCurrentTaskMemories = true;
              attempts[attempts.length - 1] = {
                attemptNumber,
                execution: withExecutionRetryDecision(
                  execution,
                  'Automatic retry will continue after compacting prior attempts to stay within the token budget.',
                ),
              };
              usedTokens = compacted.usedTokens;
              compactionsUsed += 1;
              continue;
            }
          }
          this.recordRetryDecision(
            input.task,
            `stop automatic retry after transport execution failure on attempt ${String(attemptNumber)} because the token budget was exhausted`,
            execution.retryPrompt,
          );
          return await this.finalizeLoopResult(input, {
            finalStatus: 'FAILED',
            stopReason: 'token_budget_exhausted',
            attempts,
            finalExecution,
            summary: `Token budget exhausted after ${String(attemptNumber)} apply failures. Stopping before another retry attempt.`,
          }, maxAttempts, usedTokens, tokenBudget, compactionsUsed, maxCompactions);
        }
        if (willRetry && execution.retryPrompt) {
          this.recordRetryDecision(
            input.task,
            `retry after transport execution failure on attempt ${String(attemptNumber)}`,
            execution.retryPrompt,
          );
          this.sessionManager.appendStep(input.sessionId, {
            stepIndex: ((attemptNumber - 1) * 10) + 3,
            description: `${this.profile.name} retry decision`,
            outcome: `Retrying after apply failure (${String(attemptNumber)}/${String(maxAttempts)}).`,
            timestamp: new Date().toISOString(),
          }, input.dataRoot);
          continue;
        }
        if (execution.retryPrompt) {
          this.recordRetryDecision(
            input.task,
            `stop automatic retry after transport execution failure on attempt ${String(attemptNumber)} because the attempt budget was exhausted`,
            execution.retryPrompt,
          );
        }
        return await this.finalizeLoopResult(input, {
          finalStatus: 'FAILED',
          stopReason: attemptNumber >= maxAttempts ? 'budget_exhausted' : 'apply_failed',
          attempts,
          finalExecution,
          summary: attemptNumber >= maxAttempts
            ? `Attempt budget exhausted after ${String(attemptNumber)} apply failures.`
            : finalExecution.planSummary,
        }, maxAttempts, usedTokens, tokenBudget, compactionsUsed, maxCompactions);
      }

      await input.onVerificationStart?.(attemptNumber, execution);
      const artifacts = await input.verify({ attemptNumber, execution });
      const verification = this.reviewVerification({
        task: input.task,
        sessionId: input.sessionId,
        dataRoot: input.dataRoot,
        plan: execution.plan,
        rawOutput: execution.rawOutput,
        verifyPassed: artifacts.verifyPassed,
        verifyOutput: artifacts.verifyOutput,
        changedFiles: artifacts.changedFiles,
        relevantMemories: execution.relevantMemories,
        taskLedger: execution.taskLedger,
        ...(input.analysis ? { analysis: input.analysis } : {}),
        stepOffset: (attemptNumber - 1) * 10,
      });
      const previousAttempt = attempts[attempts.length - 1];
      const provisionalAttempt: CodeRepairLoopAttempt = { attemptNumber, execution, artifacts, verification };
      usedTokens += estimateExecutionTokens(execution) + estimateVerificationTokens(verification, artifacts.verifyOutput);

      if (artifacts.verifyPassed) {
        attempts.push(provisionalAttempt);
          return await this.finalizeLoopResult(input, {
            finalStatus: 'SUCCEEDED',
            stopReason: 'succeeded',
            attempts,
            finalExecution: execution,
            finalArtifacts: artifacts,
            finalVerification: verification,
            summary: `${execution.planSummary} ${verification.summary}`.trim(),
        }, maxAttempts, usedTokens, tokenBudget, compactionsUsed, maxCompactions);
      }

      this.recordVerifyFailure(
        input.task,
        verification.summary,
        artifacts.verifyOutput,
      );

      if (attemptNumber < maxAttempts && verification.verdict === 'retry') {
        const noProgress = hasNoVerificationProgress(previousAttempt, provisionalAttempt);
        if (noProgress) {
          const finalVerification = withVerificationRetryDecision(
            verification,
            'Automatic retry was withheld because consecutive failed attempts produced no new verification signal.',
          );
          const settledAttempt: CodeRepairLoopAttempt = {
            attemptNumber,
            execution,
            artifacts,
            verification: finalVerification,
          };
          attempts.push(settledAttempt);
          if (verification.retryPrompt) {
            this.recordRetryDecision(
              input.task,
              `stop automatic retry after verification failure on attempt ${String(attemptNumber)} because no progress was detected`,
              verification.retryPrompt,
            );
          }
          const summary = `No progress detected after ${String(attemptNumber)} failed attempts. Stopping early instead of consuming the remaining retry budget.`;
          this.sessionManager.appendStep(input.sessionId, {
            stepIndex: ((attemptNumber - 1) * 10) + 5,
            description: `${this.profile.name} stop condition`,
            outcome: summary,
            timestamp: new Date().toISOString(),
          }, input.dataRoot);
          return await this.finalizeLoopResult(input, {
            finalStatus: 'FAILED',
            stopReason: 'no_progress',
            attempts,
            finalExecution: execution,
            finalArtifacts: artifacts,
            finalVerification,
            summary,
          }, maxAttempts, usedTokens, tokenBudget, compactionsUsed, maxCompactions);
        }
        if (isApproxBudgetExceeded(usedTokens, tokenBudget)) {
          if (enableAutoCompact && compactionsUsed < maxCompactions) {
            const compactedVerification = withVerificationRetryDecision(
              verification,
              'Automatic retry will continue after compacting prior attempts to stay within the token budget.',
            );
            const settledAttempt: CodeRepairLoopAttempt = {
              attemptNumber,
              execution,
              artifacts,
              verification: compactedVerification,
            };
            attempts.push(settledAttempt);
            const compacted = this.tryAutoCompact({
              input,
              attemptNumber,
              attempts,
              usedTokens,
              tokenBudget,
              reason: 'verification failure',
            });
            if (compacted.applied) {
              carryoverMemories = [compacted.memory];
              suppressCurrentTaskMemories = true;
              usedTokens = compacted.usedTokens;
              compactionsUsed += 1;
              continue;
            }
          }
          const finalVerification = withVerificationRetryDecision(
            verification,
            'Automatic retry was recommended after verification failure, but the token budget was exhausted.',
          );
          const settledAttempt: CodeRepairLoopAttempt = {
            attemptNumber,
            execution,
            artifacts,
            verification: finalVerification,
          };
          attempts.push(settledAttempt);
          if (verification.retryPrompt) {
            this.recordRetryDecision(
              input.task,
              `stop automatic retry after verification failure on attempt ${String(attemptNumber)} because the token budget was exhausted`,
              verification.retryPrompt,
            );
          }
          return await this.finalizeLoopResult(input, {
            finalStatus: 'FAILED',
            stopReason: 'token_budget_exhausted',
            attempts,
            finalExecution: execution,
            finalArtifacts: artifacts,
            finalVerification,
            summary: `Token budget exhausted after ${String(attemptNumber)} verification failures. Stopping before another retry attempt.`,
          }, maxAttempts, usedTokens, tokenBudget, compactionsUsed, maxCompactions);
        }
        const continuedVerification = withVerificationRetryDecision(
          verification,
          'Automatic retry approved for another attempt within the configured budget.',
        );
        const settledAttempt: CodeRepairLoopAttempt = {
          attemptNumber,
          execution,
          artifacts,
          verification: continuedVerification,
        };
        attempts.push(settledAttempt);
        if (verification.retryPrompt) {
          this.recordRetryDecision(
            input.task,
            `retry after verification failure on attempt ${String(attemptNumber)}`,
            verification.retryPrompt,
          );
        }
        this.sessionManager.appendStep(input.sessionId, {
          stepIndex: ((attemptNumber - 1) * 10) + 5,
          description: `${this.profile.name} retry decision`,
          outcome: `Retrying after verification failure (${String(attemptNumber)}/${String(maxAttempts)}).`,
          timestamp: new Date().toISOString(),
        }, input.dataRoot);
        continue;
      }

      const finalVerification = attemptNumber >= maxAttempts && verification.verdict === 'retry'
        ? withVerificationRetryDecision(
          verification,
          'Automatic retry was recommended after verification failure, but the attempt budget was exhausted.',
        )
        : verification;
      const settledAttempt: CodeRepairLoopAttempt = {
        attemptNumber,
        execution,
        artifacts,
        verification: finalVerification,
      };
      attempts.push(settledAttempt);
      if (attemptNumber >= maxAttempts && verification.verdict === 'retry' && verification.retryPrompt) {
        this.recordRetryDecision(
          input.task,
          `stop automatic retry after verification failure on attempt ${String(attemptNumber)} because the attempt budget was exhausted`,
          verification.retryPrompt,
        );
      }

      return await this.finalizeLoopResult(input, {
        finalStatus: 'FAILED',
        stopReason: attemptNumber >= maxAttempts && verification.verdict === 'retry'
          ? 'budget_exhausted'
          : 'verification_failed',
        attempts,
        finalExecution: execution,
        finalArtifacts: artifacts,
        finalVerification,
        summary: attemptNumber >= maxAttempts && verification.verdict === 'retry'
          ? `Attempt budget exhausted after ${String(attemptNumber)} verification failures. ${finalVerification.summary}`
          : `${execution.planSummary} ${finalVerification.summary}`.trim(),
      }, maxAttempts, usedTokens, tokenBudget, compactionsUsed, maxCompactions);
    }

    throw new Error('CodeRepairAgent loop exited unexpectedly');
  }

  private async finalizeLoopResult(
    input: CodeRepairLoopInput,
    result: Omit<CodeRepairLoopResult, 'budget'>,
    maxAttempts: number,
    usedTokens: number,
    tokenBudget?: number,
    compactionsUsed = 0,
    maxCompactions = 1,
  ): Promise<CodeRepairLoopResult> {
    const finalized: CodeRepairLoopResult = {
      ...result,
      budget: buildLoopBudget(maxAttempts, result.attempts.length, usedTokens, tokenBudget, compactionsUsed, maxCompactions),
    };
    await this.runStopHooks(input, finalized);
    return finalized;
  }

  private async runStopHooks(input: CodeRepairLoopInput, result: CodeRepairLoopResult): Promise<void> {
    const hooks: CodeRepairStopHook[] = [
      ({ sessionId, dataRoot, result: finalResult, budget }) => {
        this.sessionManager.appendStep(sessionId, {
          stepIndex: stopHookStepIndex(budget.attemptsUsed),
          description: `${this.profile.name} final stop`,
          outcome: formatStopOutcome(finalResult, budget),
          timestamp: new Date().toISOString(),
        }, dataRoot);
      },
      ...(input.stopHooks ?? []),
    ];

    for (const [index, hook] of hooks.entries()) {
      try {
        await hook({
          task: input.task,
          sessionId: input.sessionId,
          dataRoot: input.dataRoot,
          result,
          budget: result.budget,
        });
      } catch (error) {
        this.sessionManager.appendStep(input.sessionId, {
          stepIndex: stopHookStepIndex(result.budget.attemptsUsed) + index + 1,
          description: `${this.profile.name} stop hook failure`,
          outcome: String(error),
          timestamp: new Date().toISOString(),
        }, input.dataRoot);
      }
    }
  }

  private tryAutoCompact(input: {
    input: CodeRepairLoopInput;
    attemptNumber: number;
    attempts: CodeRepairLoopAttempt[];
    usedTokens: number;
    tokenBudget: number | undefined;
    reason: 'apply failure' | 'verification failure';
  }): { applied: boolean; usedTokens: number; memory: CodeTaskMemoryEntry } | { applied: false; usedTokens: number } {
    const compactSummary = buildCompactionSummary(input.input.task, input.attempts);
    const compactMemory = buildCompactedMemoryEntry(input.input.task, input.attemptNumber, compactSummary);
    const compactedTokens = estimateApproxTokens(compactSummary);
    if (input.tokenBudget !== undefined && compactedTokens >= input.tokenBudget) {
      return { applied: false, usedTokens: input.usedTokens };
    }

    this.recordRetryDecision(
      input.input.task,
      `auto compact after ${input.reason} on attempt ${String(input.attemptNumber)} to stay within the token budget`,
      compactSummary,
    );
    this.sessionManager.appendStep(input.input.sessionId, {
      stepIndex: ((input.attemptNumber - 1) * 10) + 6,
      description: `${this.profile.name} auto compact`,
      outcome: `Compacted prior attempts after ${input.reason}; next retry will continue with a summarized context snapshot.`,
      timestamp: new Date().toISOString(),
    }, input.input.dataRoot);
    return { applied: true, usedTokens: compactedTokens, memory: compactMemory };
  }

  reviewVerification(input: CodeRepairVerificationInput): CodeRepairVerificationResult {
    const stepOffset = input.stepOffset ?? 0;
    const contextInput: AgentAssemblyInput = {
      task: input.task,
      verifyOutput: input.verifyOutput,
      verifyPassed: input.verifyPassed,
      relevantMemories: input.relevantMemories.map((item) => ({
        kind: item.kind,
        summary: item.summary,
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.files.length > 0 ? { files: item.files } : {}),
        ...(item.commands.length > 0 ? { commands: item.commands } : {}),
      })),
    };
    if (input.analysis) contextInput.analysis = input.analysis;
    const context = this.assembler.assembleCodeRepairContext(contextInput);
    const review = this.verificationAgent.assess({
      context,
      plan: input.plan,
      rawOutput: input.rawOutput,
      verifyPassed: input.verifyPassed,
      verifyOutput: input.verifyOutput,
      changedFiles: input.changedFiles,
    });

    const taskLedger = CodeRepairTaskLedger.fromSnapshot(input.taskLedger);
    if (input.verifyPassed) {
      taskLedger.complete('verify', review.summary);
      taskLedger.skip('retry-decision', review.verdict === 'review'
        ? 'Verification passed; manual review is still recommended.'
        : 'Verification passed; retry is not needed.');
    } else {
      taskLedger.fail('verify', review.summary);
      taskLedger.complete('retry-decision', 'Retry is recommended after verification failure.');
    }

    this.sessionManager.appendStep(input.sessionId, {
      stepIndex: stepOffset + 3,
      description: 'VerificationAgent review',
      outcome: review.summary,
      timestamp: new Date().toISOString(),
    }, input.dataRoot);

    if (review.retryPrompt) {
      const retryPrompt = this.promptBuilder.buildRetryPrompt(
        context,
        summarizeOutput(input.verifyOutput),
        input.verifyOutput,
      );
      this.sessionManager.appendPromptSample(input.sessionId, {
        sessionId: input.sessionId,
        stepIndex: stepOffset + 4,
        timestamp: new Date().toISOString(),
        phase: retryPrompt.phase,
        templateVersion: retryPrompt.templateVersion,
        prompt: retryPrompt.prompt,
        response: review.summary,
        promptContextSummary: retryPrompt.promptContextSummary,
        sampledBy: 'forced',
      }, input.dataRoot);
    }

    return {
      verdict: review.verdict,
      summary: review.summary,
      adversarialChecks: review.adversarialChecks,
      ...(review.retryPrompt ? { retryPrompt: review.retryPrompt } : {}),
      taskLedger: taskLedger.snapshot(),
    };
  }

  recordApplyFailure(task: CodeTaskRow, summary: string, detail: string): void {
    this.memory.recordFailure({
      runId: task.run_id,
      taskId: task.task_id,
      ...(task.parent_task_id ? { parentTaskId: task.parent_task_id } : {}),
      ...(task.testcase_id ? { testcaseId: task.testcase_id } : {}),
      attempt: task.attempt,
      kind: 'apply-failure',
      summary,
      detail,
      files: parseJsonArray(task.scope_paths_json),
      commands: parseJsonArray(task.verification_commands_json),
    });
  }

  recordVerifyFailure(task: CodeTaskRow, summary: string, detail: string): void {
    this.memory.recordFailure({
      runId: task.run_id,
      taskId: task.task_id,
      ...(task.parent_task_id ? { parentTaskId: task.parent_task_id } : {}),
      ...(task.testcase_id ? { testcaseId: task.testcase_id } : {}),
      attempt: task.attempt,
      kind: 'verify-failure',
      summary,
      detail,
      files: parseJsonArray(task.scope_paths_json),
      commands: parseJsonArray(task.verification_commands_json),
    });
  }

  recordReviewFeedback(task: CodeTaskRow, decision: string, comment?: string): void {
    this.memory.recordReview({
      runId: task.run_id,
      taskId: task.task_id,
      ...(task.parent_task_id ? { parentTaskId: task.parent_task_id } : {}),
      ...(task.testcase_id ? { testcaseId: task.testcase_id } : {}),
      attempt: task.attempt,
      summary: `review ${decision}`,
      ...(comment ? { detail: comment } : {}),
      files: parseJsonArray(task.scope_paths_json),
      commands: parseJsonArray(task.verification_commands_json),
    });
  }

  recordRetryDecision(task: CodeTaskRow, summary: string, detail?: string): void {
    this.memory.recordRetryDecision({
      runId: task.run_id,
      taskId: task.task_id,
      ...(task.parent_task_id ? { parentTaskId: task.parent_task_id } : {}),
      ...(task.testcase_id ? { testcaseId: task.testcase_id } : {}),
      attempt: task.attempt,
      summary,
      ...(detail ? { detail } : {}),
      files: parseJsonArray(task.scope_paths_json),
      commands: parseJsonArray(task.verification_commands_json),
    });
  }
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

function summarizeOutput(rawOutput: string): string {
  const normalized = rawOutput.replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized || 'empty output';
}

function formatPlan(plan: CodeRepairPlan): string {
  return [
    `summary: ${plan.summary}`,
    `criticalFiles: ${plan.criticalFiles.join(', ') || 'none'}`,
    `checklist: ${plan.checklist.join(' | ')}`,
    `retryStrategy: ${plan.retryStrategy.join(' | ') || 'none'}`,
  ].join('\n');
}

function hasNoVerificationProgress(
  previousAttempt: CodeRepairLoopAttempt | undefined,
  currentAttempt: CodeRepairLoopAttempt,
): boolean {
  if (!previousAttempt?.artifacts || !previousAttempt.verification) return false;
  if (!currentAttempt.artifacts || !currentAttempt.verification) return false;
  if (previousAttempt.artifacts.verifyPassed || currentAttempt.artifacts.verifyPassed) return false;
  if (previousAttempt.verification.verdict !== 'retry' || currentAttempt.verification.verdict !== 'retry') return false;

  const previousFiles = normalizeFileList(previousAttempt.artifacts.changedFiles);
  const currentFiles = normalizeFileList(currentAttempt.artifacts.changedFiles);
  const sameFiles = previousFiles.length === currentFiles.length
    && previousFiles.every((file, index) => file === currentFiles[index]);
  if (!sameFiles) return false;

  const previousSignal = extractVerificationSignal(previousAttempt.artifacts.verifyOutput);
  const currentSignal = extractVerificationSignal(currentAttempt.artifacts.verifyOutput);
  if (previousSignal && currentSignal) {
    return previousSignal === currentSignal;
  }

  const previousVerify = normalizeText(previousAttempt.artifacts.verifyOutput);
  const currentVerify = normalizeText(currentAttempt.artifacts.verifyOutput);
  return previousVerify === currentVerify;
}

function normalizeFileList(files: string[]): string[] {
  return [...files].sort();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractVerificationSignal(verifyOutput: string): string {
  const normalizedLines = verifyOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('$ '));

  const signalLines = normalizedLines.filter((line) =>
    /(fail|error|exception|assert|expected|received|timeout)/i.test(line),
  );
  const selected = (signalLines.length > 0 ? signalLines : normalizedLines).slice(0, 3);
  return normalizeText(selected.join(' | '));
}

function mergeRelevantMemories(
  selected: CodeTaskMemoryEntry[],
  carryover: CodeTaskMemoryEntry[],
  currentTaskId: string,
  suppressCurrentTaskMemories: boolean,
): CodeTaskMemoryEntry[] {
  const merged: CodeTaskMemoryEntry[] = [];
  const seen = new Set<string>();

  for (const item of [...carryover, ...selected]) {
    if (suppressCurrentTaskMemories && item.taskId === currentTaskId && !carryover.includes(item)) {
      continue;
    }
    const key = `${item.kind}:${item.taskId}:${item.summary}:${item.detail ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged.slice(0, 5);
}

function buildCompactionSummary(task: CodeTaskRow, attempts: CodeRepairLoopAttempt[]): string {
  const recentAttempts = attempts.slice(-3);
  const lines = recentAttempts.map((attempt) => {
    const changedFiles = attempt.artifacts?.changedFiles.length
      ? attempt.artifacts.changedFiles.join(', ')
      : 'none';
    const verifySummary = attempt.artifacts
      ? summarizeOutput(attempt.artifacts.verifyOutput)
      : summarizeOutput(attempt.execution.rawOutput);
    const verdict = attempt.verification?.verdict
      ?? (attempt.execution.exitCode === 0 ? 'apply-only' : 'apply-failed');
    return `attempt ${String(attempt.attemptNumber)} verdict=${verdict} files=${changedFiles} note=${verifySummary}`;
  });

  return [
    `Compacted repair context for goal: ${task.goal}`,
    `Recent attempts: ${lines.join(' | ')}`,
    'Use this compact history instead of re-reading earlier verbose outputs.',
  ].join('\n');
}

function buildCompactedMemoryEntry(
  task: CodeTaskRow,
  attemptNumber: number,
  detail: string,
): CodeTaskMemoryEntry {
  return {
    id: `ephemeral-compact-${task.task_id}-${String(attemptNumber)}`,
    runId: task.run_id,
    taskId: task.task_id,
    ...(task.parent_task_id ? { parentTaskId: task.parent_task_id } : {}),
    ...(task.testcase_id ? { testcaseId: task.testcase_id } : {}),
    attempt: task.attempt,
    kind: 'retry-decision',
    summary: `auto compact carry-over after attempt ${String(attemptNumber)}`,
    detail,
    files: parseJsonArray(task.scope_paths_json),
    commands: parseJsonArray(task.verification_commands_json),
    createdAt: new Date().toISOString(),
  };
}

function estimateExecutionTokens(execution: CodeRepairExecutionResult): number {
  return estimateApproxTokens(
    execution.contextSummary,
    execution.planSummary,
    execution.rawOutput,
    execution.verifyPrompt ?? '',
    execution.retryPrompt ?? '',
  );
}

function estimateVerificationTokens(verification: CodeRepairVerificationResult, verifyOutput: string): number {
  return estimateApproxTokens(
    verification.summary,
    verification.adversarialChecks.join('\n'),
    verification.retryPrompt ?? '',
    verifyOutput,
  );
}

function buildLoopBudget(
  maxAttempts: number,
  attemptsUsed: number,
  usedTokens: number,
  tokenBudget?: number,
  compactionsUsed = 0,
  maxCompactions = 1,
): CodeRepairLoopBudget {
  return {
    maxAttempts,
    attemptsUsed,
    ...buildApproxBudgetSnapshot({
      usedTokens,
      tokenBudget,
      compactionsUsed,
      maxCompactions,
    }),
  };
}

function stopHookStepIndex(attemptsUsed: number): number {
  return Math.max(0, attemptsUsed - 1) * 10 + 8;
}

function formatStopOutcome(result: CodeRepairLoopResult, budget: CodeRepairLoopBudget): string {
  const parts = [
    `status=${result.finalStatus}`,
    `reason=${result.stopReason}`,
    `attempts=${String(budget.attemptsUsed)}/${String(budget.maxAttempts)}`,
    `tokens=${String(budget.usedTokens)}${budget.tokenBudget !== undefined ? `/${String(budget.tokenBudget)}` : ''}`,
    `compactions=${String(budget.compactionsUsed)}/${String(budget.maxCompactions)}`,
  ];
  return parts.join(' ');
}

function withExecutionRetryDecision(
  execution: CodeRepairExecutionResult,
  summary: string,
): CodeRepairExecutionResult {
  const taskLedger = CodeRepairTaskLedger.fromSnapshot(execution.taskLedger);
  taskLedger.complete('retry-decision', summary);
  return {
    ...execution,
    taskLedger: taskLedger.snapshot(),
  };
}

function withVerificationRetryDecision(
  verification: CodeRepairVerificationResult,
  summary: string,
): CodeRepairVerificationResult {
  const taskLedger = CodeRepairTaskLedger.fromSnapshot(verification.taskLedger);
  taskLedger.complete('retry-decision', summary);
  return {
    ...verification,
    taskLedger: taskLedger.snapshot(),
  };
}
