import type { AnalysisRow, CodeTaskRow } from '@zarb/storage';

export interface AgentAssemblyInput {
  task: CodeTaskRow;
  analysis?: AnalysisRow;
  verifyOutput?: string;
  verifyPassed?: boolean;
  relevantMemories?: Array<{ summary: string; detail?: string; kind: string; files?: string[]; commands?: string[] }>;
}

export interface CodeRepairContext {
  taskId: string;
  runId: string;
  testcaseId?: string;
  workspacePath: string;
  goal: string;
  scopePaths: string[];
  constraints: string[];
  verificationCommands: string[];
  attempt: number;
  analysisSummary?: string;
  probableCause?: string;
  verifyOutput?: string;
  verifyPassed?: boolean;
  relevantMemories: Array<{ summary: string; detail?: string; kind: string; files?: string[]; commands?: string[] }>;
}

export class AgentContextAssembler {
  assembleCodeRepairContext(input: AgentAssemblyInput): CodeRepairContext {
    const scopePaths = parseJsonArray(input.task.scope_paths_json);
    const constraints = parseJsonArray(input.task.constraints_json);
    const verificationCommands = parseJsonArray(input.task.verification_commands_json);
    const relevantMemories = input.relevantMemories ?? [];

    return {
      taskId: input.task.task_id,
      runId: input.task.run_id,
      ...(input.task.testcase_id ? { testcaseId: input.task.testcase_id } : {}),
      workspacePath: input.task.workspace_path,
      goal: input.task.goal,
      scopePaths,
      constraints,
      verificationCommands,
      attempt: input.task.attempt,
      ...(input.analysis?.summary ? { analysisSummary: input.analysis.summary } : {}),
      ...(input.analysis?.probable_cause ? { probableCause: input.analysis.probable_cause } : {}),
      ...(input.verifyOutput ? { verifyOutput: input.verifyOutput } : {}),
      ...(input.verifyPassed !== undefined ? { verifyPassed: input.verifyPassed } : {}),
      relevantMemories,
    };
  }

  summarizeCodeRepairContext(context: CodeRepairContext): string {
    return [
      `task=${context.taskId}`,
      `attempt=${String(context.attempt)}`,
      `scopePaths=${String(context.scopePaths.length)}`,
      `constraints=${String(context.constraints.length)}`,
      `verifyCommands=${String(context.verificationCommands.length)}`,
      `memories=${String(context.relevantMemories.length)}`,
      ...(context.testcaseId ? [`testcase=${context.testcaseId}`] : []),
      ...(context.analysisSummary ? [`analysis=${truncate(context.analysisSummary, 120)}`] : []),
      ...(context.probableCause ? [`cause=${truncate(context.probableCause, 120)}`] : []),
    ].join(' ');
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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
