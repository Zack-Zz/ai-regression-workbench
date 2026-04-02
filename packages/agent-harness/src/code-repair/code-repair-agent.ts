import type { AnalysisRow, CodeTaskRow, Db } from '@zarb/storage';
import { CODE_REPAIR_AGENT_PROFILE, AgentContextAssembler, HarnessSessionManager, ToolExecutionPlanner, ToolRegistry } from '../runtime/index.js';
import type { AgentAssemblyInput, ToolDescriptor, ToolCallResult } from '../runtime/index.js';
import type { CodeRepairTransport } from '../codex-cli-agent.js';
import { CodeRepairPromptBuilder } from './prompt-builder.js';
import { CodeTaskMemory } from './code-task-memory.js';
import type { CodeTaskMemoryEntry } from './code-task-memory.js';

export interface CodeRepairExecutionInput {
  task: CodeTaskRow;
  sessionId: string;
  dataRoot: string;
  analysis?: AnalysisRow;
}

export interface CodeRepairExecutionResult {
  rawOutput: string;
  exitCode: number;
  contextSummary: string;
  planSummary: string;
  verifyPrompt: string;
  retryPrompt?: string;
  relevantMemories: CodeTaskMemoryEntry[];
}

export class CodeRepairAgent {
  private readonly profile = CODE_REPAIR_AGENT_PROFILE;
  private readonly assembler = new AgentContextAssembler();
  private readonly promptBuilder = new CodeRepairPromptBuilder();
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
      { runId: string; taskId: string; testcaseId?: string; goal: string; limit?: number },
      CodeTaskMemoryEntry[],
      { relevantMemories: CodeTaskMemoryEntry[] }
    > = {
      handler: async (input) => this.memory.selectRelevantMemories(input as {
        runId: string;
        taskId: string;
        testcaseId?: string;
        goal: string;
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
    const memoryResult = await this.planner.execute([
      {
        toolName: 'code-repair.memory.select',
        input: {
          runId: input.task.run_id,
          taskId: input.task.task_id,
          ...(input.task.testcase_id ? { testcaseId: input.task.testcase_id } : {}),
          goal: input.task.goal,
          limit: 5,
        },
      },
    ], { sessionId: input.sessionId, stepIndex: 0 }, { relevantMemories: [] });

    for (const result of memoryResult.results) {
      this.sessionManager.appendToolCall(input.sessionId, result.record, input.dataRoot);
    }

    const contextInput: AgentAssemblyInput = {
      task: input.task,
      relevantMemories: memoryResult.context.relevantMemories.map((item) => ({
        kind: item.kind,
        summary: item.summary,
        ...(item.detail ? { detail: item.detail } : {}),
      })),
    };
    if (input.analysis) contextInput.analysis = input.analysis;
    const context = this.assembler.assembleCodeRepairContext(contextInput);
    const contextSummary = this.assembler.summarizeCodeRepairContext(context);
    const planSummary = this.buildPlanSummary(context);

    const planPrompt = this.promptBuilder.buildPlanPrompt(context);
    this.sessionManager.appendPromptSample(input.sessionId, {
      sessionId: input.sessionId,
      stepIndex: 0,
      timestamp: new Date().toISOString(),
      phase: planPrompt.phase,
      templateVersion: planPrompt.templateVersion,
      prompt: planPrompt.prompt,
      response: planSummary,
      promptContextSummary: planPrompt.promptContextSummary,
      sampledBy: 'forced',
    }, input.dataRoot);
    this.sessionManager.appendStep(input.sessionId, {
      stepIndex: 0,
      description: `${this.profile.name} plan`,
      outcome: planSummary,
      timestamp: new Date().toISOString(),
    }, input.dataRoot);

    const applyPrompt = this.promptBuilder.buildApplyPrompt(context, planSummary);
    const agentResult = await this.transport.run({
      workspacePath: input.task.workspace_path,
      prompt: applyPrompt.prompt,
    });
    this.sessionManager.appendPromptSample(input.sessionId, {
      sessionId: input.sessionId,
      stepIndex: 1,
      timestamp: new Date().toISOString(),
      phase: applyPrompt.phase,
      templateVersion: applyPrompt.templateVersion,
      prompt: applyPrompt.prompt,
      response: agentResult.rawOutput,
      promptContextSummary: applyPrompt.promptContextSummary,
      sampledBy: 'forced',
    }, input.dataRoot);
    this.sessionManager.appendStep(input.sessionId, {
      stepIndex: 1,
      description: `${this.transport.name} apply`,
      outcome: agentResult.exitCode === 0 ? 'ok' : `exit ${String(agentResult.exitCode)}`,
      timestamp: new Date().toISOString(),
    }, input.dataRoot);

    const verifyPrompt = this.promptBuilder.buildVerifyPrompt(context, summarizeOutput(agentResult.rawOutput));
    this.sessionManager.appendPromptSample(input.sessionId, {
      sessionId: input.sessionId,
      stepIndex: 2,
      timestamp: new Date().toISOString(),
      phase: verifyPrompt.phase,
      templateVersion: verifyPrompt.templateVersion,
      prompt: verifyPrompt.prompt,
      response: context.verificationCommands.join('\n') || 'no verification commands configured',
      promptContextSummary: verifyPrompt.promptContextSummary,
      sampledBy: 'forced',
    }, input.dataRoot);

    const retryPrompt = agentResult.exitCode === 0
      ? undefined
      : this.promptBuilder.buildRetryPrompt(context, `transport exited with code ${String(agentResult.exitCode)}`, '');
    if (retryPrompt) {
      this.sessionManager.appendPromptSample(input.sessionId, {
        sessionId: input.sessionId,
        stepIndex: 3,
        timestamp: new Date().toISOString(),
        phase: retryPrompt.phase,
        templateVersion: retryPrompt.templateVersion,
        prompt: retryPrompt.prompt,
        response: 'retry recommended',
        promptContextSummary: retryPrompt.promptContextSummary,
        sampledBy: 'forced',
      }, input.dataRoot);
    }

    return {
      rawOutput: agentResult.rawOutput,
      exitCode: agentResult.exitCode,
      contextSummary,
      planSummary,
      verifyPrompt: verifyPrompt.prompt,
      ...(retryPrompt ? { retryPrompt: retryPrompt.prompt } : {}),
      relevantMemories: memoryResult.context.relevantMemories,
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

  private buildPlanSummary(context: ReturnType<AgentContextAssembler['assembleCodeRepairContext']>): string {
    const steps = [
      'Identify the smallest relevant file set from scope and analysis.',
      'Apply the minimal code changes needed to satisfy the goal.',
      context.verificationCommands.length > 0
        ? `Run verification in this order: ${context.verificationCommands.join(', ')}`
        : 'Prepare the workspace for follow-up verification.',
    ];
    if (context.relevantMemories.length > 0) {
      steps.push(`Avoid repeating ${String(context.relevantMemories.length)} previously failed approaches.`);
    }
    return steps.join(' ');
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
