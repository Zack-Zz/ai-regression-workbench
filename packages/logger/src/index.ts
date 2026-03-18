/**
 * StepLogger — appends structured step records as NDJSON to a log file.
 *
 * Each record: { ts, component, action, detail, status, durationMs }
 * File is created on first write; directory is created if needed.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// AppLogger — process-level + business-flow structured logger
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info:  '\x1b[32m', // green
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

function resolveLevel(): LogLevel {
  const v = process.env['ZARB_LOG_LEVEL']?.toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  return 'info';
}

function fmtLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

class AppLoggerImpl {
  private minLevel: LogLevel = resolveLevel();
  private filePath: string | null = null;
  private fileReady = false;

  /** Call once at startup to enable file output. */
  setFilePath(p: string): void {
    this.filePath = p;
  }

  /** Override min level at runtime (e.g. from config). */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Create a child logger that prefixes every message with [module]. */
  child(module: string): ChildLogger {
    return new ChildLogger(this, module);
  }

  _write(level: LogLevel, module: string, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;

    const now = new Date();
    const ts = now.toISOString();
    // Console: colored human-readable, local time
    const color = LEVEL_COLOR[level];
    const tag = `[${level.toUpperCase().padEnd(5)}]`;
    const mod = module ? ` [${module}]` : '';
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    const line = `${color}${tag}${RESET} ${fmtLocalTime(now)}${mod} ${msg}${metaStr}`;
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }

    // File: NDJSON
    if (this.filePath) {
      if (!this.fileReady) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        this.fileReady = true;
      }
      const record = JSON.stringify({ ts, level, module, msg, ...meta });
      appendFileSync(this.filePath, record + '\n', 'utf8');
    }
  }

  debug(msg: string, meta?: Record<string, unknown>): void { this._write('debug', '', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>): void  { this._write('info',  '', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void  { this._write('warn',  '', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this._write('error', '', msg, meta); }
}

class ChildLogger {
  constructor(private readonly root: AppLoggerImpl, private readonly module: string) {}
  debug(msg: string, meta?: Record<string, unknown>): void { this.root._write('debug', this.module, msg, meta); }
  info(msg: string, meta?: Record<string, unknown>): void  { this.root._write('info',  this.module, msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void  { this.root._write('warn',  this.module, msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this.root._write('error', this.module, msg, meta); }
}

export type { ChildLogger };

/** Singleton app logger. Import and use directly. */
export const appLogger = new AppLoggerImpl();

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
