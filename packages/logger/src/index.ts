/**
 * StepLogger — appends structured step records as NDJSON to a log file.
 *
 * Each record: { ts, component, action, detail, status, durationMs }
 * File is created on first write; directory is created if needed.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type StepStatus = 'ok' | 'warn' | 'error' | 'skip' | 'pending';

export interface StepRecord {
  ts: string;
  component: string;
  action: string;
  detail?: string;
  status: StepStatus;
  durationMs?: number;
  // Extended audit fields
  toolInput?: unknown;       // tool call input params
  toolOutput?: unknown;      // tool call output (trimmed)
  pageState?: {              // page snapshot at this step
    url: string; title: string; formCount: number; linkCount: number;
    consoleErrors: number; networkErrors: number;
  };
  reason?: string;           // why agent took this action / transitioned to next step
  model?: string;            // AI model used for this step (if applicable)
  tool?: string;             // specific tool used (e.g. 'playwright', 'fetch')
  actionId?: string;         // groups pending + terminal records for the same logical action
}

export class StepLogger {
  private readonly path: string;
  private ready = false;
  private readonly onLog?: () => void;

  constructor(logPath: string, onLog?: () => void) {
    this.path = logPath;
    if (onLog) this.onLog = onLog;
  }

  log(record: Omit<StepRecord, 'ts'>): void {
    if (!this.ready) {
      mkdirSync(dirname(this.path), { recursive: true });
      this.ready = true;
    }
    const line: StepRecord = { ts: new Date().toISOString(), ...record };
    appendFileSync(this.path, JSON.stringify(line) + '\n', 'utf8');
    this.onLog?.();
  }

  /** Convenience: wrap an async operation, log result with duration. */
  async wrap<T>(
    component: string,
    action: string,
    detail: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.log({ component, action, detail, status: 'ok', durationMs: Date.now() - start });
      return result;
    } catch (err) {
      this.log({ component, action, detail: `${detail} — ${String(err)}`, status: 'error', durationMs: Date.now() - start });
      throw err;
    }
  }
}
