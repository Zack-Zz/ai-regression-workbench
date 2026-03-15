/**
 * ObservabilityAdapter — optional interface for external AI/harness tracing.
 * Implementations must be safe to fail: errors must not propagate to callers.
 * Derived from observability-design.md §4, §5, §6.
 */
export interface ObservabilityEvent {
  sessionId: string;
  runId: string;
  taskId?: string;
  agentName: string;
  eventType: 'session_start' | 'session_end' | 'step' | 'tool_call' | 'approval' | 'checkpoint';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ObservabilityAdapter {
  /** Called when a harness session starts. */
  onSessionStart(event: ObservabilityEvent): void | Promise<void>;
  /** Called when a harness session ends (completed or cancelled). */
  onSessionEnd(event: ObservabilityEvent & { summary?: ObservabilitySummary }): void | Promise<void>;
  /** Called for each step, tool call, approval, or checkpoint event. */
  onEvent(event: ObservabilityEvent): void | Promise<void>;
}

export interface ObservabilitySummary {
  enabled: boolean;
  provider: string;
  externalTraceId?: string;
  totalTokens?: number;
  estimatedCost?: number;
  latencyMs?: number;
  toolCallCount?: number;
  summaryLink?: string;
}
