import type { ToolCallResult } from './tool-registry.js';
import { ToolRegistry } from './tool-registry.js';

export interface PlannedToolCall {
  toolName: string;
  input: unknown;
}

export interface ToolPlanningContext {
  sessionId: string;
  stepIndex: number;
  approvalId?: string;
}

export interface ToolExecutionPlannerResult<TContext = Record<string, unknown>> {
  results: ToolCallResult[];
  context: TContext;
}

export class ToolExecutionPlanner<TContext = Record<string, unknown>> {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    calls: PlannedToolCall[],
    context: ToolPlanningContext,
    initialContext: TContext,
  ): Promise<ToolExecutionPlannerResult<TContext>> {
    const batches = this.partitionBatches(calls);
    const results: ToolCallResult[] = [];
    let nextContext = initialContext;

    for (const batch of batches) {
      const batchResults = await Promise.all(batch.map((call) =>
        this.registry.call(call.toolName, call.input, context),
      ));
      results.push(...batchResults);
      for (const result of batchResults) {
        const modifier = this.registry.getContextModifier<TContext>(result.record.toolName);
        if (modifier) nextContext = modifier(nextContext, result);
      }
    }

    return { results, context: nextContext };
  }

  private partitionBatches(calls: PlannedToolCall[]): PlannedToolCall[][] {
    const batches: PlannedToolCall[][] = [];
    let currentReadBatch: PlannedToolCall[] = [];

    const flushReadBatch = (): void => {
      if (currentReadBatch.length > 0) {
        batches.push(currentReadBatch);
        currentReadBatch = [];
      }
    };

    for (const call of calls) {
      const descriptor = this.registry.getDescriptor(call.toolName);
      const isParallelRead = Boolean(descriptor?.isReadOnly && descriptor?.isConcurrencySafe);
      if (isParallelRead) {
        currentReadBatch.push(call);
        continue;
      }
      flushReadBatch();
      batches.push([call]);
    }

    flushReadBatch();
    return batches;
  }
}
