/**
 * ToolRegistry — registers tools and invokes them with policy enforcement,
 * timeout, and call logging.
 * Derived from agent-harness-design.md §4.
 */

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
) => Promise<TOutput>;

export interface ToolCallRecord {
  sessionId: string;
  stepIndex: number;
  toolName: string;
  inputSummary: string;
  resultSummary: string;
  durationMs: number;
  status: 'ok' | 'error' | 'timeout' | 'denied';
  approvalId?: string;
}

export interface ToolCallResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
  record: ToolCallRecord;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();
  private readonly requireApprovalFor: ReadonlySet<string>;
  private readonly toolCallTimeoutMs: number;
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly allowedWriteScopes: readonly string[];
  private readonly callLog: ToolCallRecord[] = [];

  constructor(opts: {
    requireApprovalFor: string[];
    toolCallTimeoutMs: number;
    allowedHosts?: string[];
    allowedWriteScopes?: string[];
  }) {
    this.requireApprovalFor = new Set(opts.requireApprovalFor);
    this.toolCallTimeoutMs = opts.toolCallTimeoutMs;
    this.allowedHosts = new Set(opts.allowedHosts ?? []);
    this.allowedWriteScopes = opts.allowedWriteScopes ?? [];
  }

  register(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  async call<T = unknown>(
    toolName: string,
    input: unknown,
    context: { sessionId: string; stepIndex: number; approvalId?: string },
  ): Promise<ToolCallResult<T>> {
    const start = Date.now();

    // Approval gate
    if (this.requireApprovalFor.has(toolName) && !context.approvalId) {
      const record: ToolCallRecord = {
        sessionId: context.sessionId,
        stepIndex: context.stepIndex,
        toolName,
        inputSummary: summarize(input),
        resultSummary: 'denied: approval required',
        durationMs: 0,
        status: 'denied',
      };
      this.callLog.push(record);
      return { ok: false, error: `Tool '${toolName}' requires approval`, record };
    }

    // Host enforcement: playwright.* tools with a 'url' input must match allowedHosts
    if (toolName.startsWith('playwright.') && this.allowedHosts.size > 0) {
      const url = (input as Record<string, unknown>)['url'];
      if (typeof url === 'string') {
        const hostname = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
        if (hostname && !this.allowedHosts.has(hostname)) {
          const record: ToolCallRecord = {
            sessionId: context.sessionId, stepIndex: context.stepIndex, toolName,
            inputSummary: summarize(input), resultSummary: `denied: host '${hostname}' not in allowedHosts`,
            durationMs: 0, status: 'denied',
          };
          this.callLog.push(record);
          return { ok: false, error: `Host '${hostname}' not in allowedHosts`, record };
        }
      }
    }

    // Write scope enforcement: fs.write tools must target an allowed scope.
    // Empty allowedWriteScopes means "deny all writes" (exploration default = read-only).
    if (toolName.startsWith('fs.write')) {
      if (this.allowedWriteScopes.length === 0) {
        const record: ToolCallRecord = {
          sessionId: context.sessionId, stepIndex: context.stepIndex, toolName,
          inputSummary: summarize(input), resultSummary: 'denied: no write scopes allowed',
          durationMs: 0, status: 'denied',
        };
        this.callLog.push(record);
        return { ok: false, error: 'No write scopes allowed (allowedWriteScopes is empty)', record };
      }
      const path = (input as Record<string, unknown>)['path'];
      if (typeof path === 'string') {
        const allowed = this.allowedWriteScopes.some(scope => path.startsWith(scope));
        if (!allowed) {
          const record: ToolCallRecord = {
            sessionId: context.sessionId, stepIndex: context.stepIndex, toolName,
            inputSummary: summarize(input), resultSummary: `denied: path '${path}' not in allowedWriteScopes`,
            durationMs: 0, status: 'denied',
          };
          this.callLog.push(record);
          return { ok: false, error: `Path '${path}' not in allowedWriteScopes`, record };
        }
      }
    }

    const handler = this.tools.get(toolName);
    if (!handler) {
      const record: ToolCallRecord = {
        sessionId: context.sessionId,
        stepIndex: context.stepIndex,
        toolName,
        inputSummary: summarize(input),
        resultSummary: 'error: tool not found',
        durationMs: 0,
        status: 'error',
      };
      this.callLog.push(record);
      return { ok: false, error: `Tool '${toolName}' not registered`, record };
    }

    try {
      const value = await Promise.race([
        handler(input) as Promise<T>,
        new Promise<never>((_, reject) =>
          setTimeout(() => { reject(new Error('timeout')); }, this.toolCallTimeoutMs),
        ),
      ]);
      const durationMs = Date.now() - start;
      const record: ToolCallRecord = {
        sessionId: context.sessionId,
        stepIndex: context.stepIndex,
        toolName,
        inputSummary: summarize(input),
        resultSummary: summarize(value),
        durationMs,
        status: 'ok',
        ...(context.approvalId ? { approvalId: context.approvalId } : {}),
      };
      this.callLog.push(record);
      return { ok: true, value, record };
    } catch (err) {
      const durationMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.message === 'timeout';
      const record: ToolCallRecord = {
        sessionId: context.sessionId,
        stepIndex: context.stepIndex,
        toolName,
        inputSummary: summarize(input),
        resultSummary: isTimeout ? 'timeout' : String(err),
        durationMs,
        status: isTimeout ? 'timeout' : 'error',
      };
      this.callLog.push(record);
      return { ok: false, error: record.resultSummary, record };
    }
  }

  getCallLog(): readonly ToolCallRecord[] {
    return this.callLog;
  }

  hasApprovalRequired(toolName: string): boolean {
    return this.requireApprovalFor.has(toolName);
  }
}

function summarize(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(value);
  }
}
