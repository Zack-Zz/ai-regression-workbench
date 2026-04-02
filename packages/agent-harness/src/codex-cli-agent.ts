import { spawn } from 'node:child_process';

export interface CodeRepairTransportInput {
  workspacePath: string;
  prompt: string;
  /** Timeout in milliseconds. Default: 5 minutes. */
  timeoutMs?: number;
}

export interface CodeRepairTransportResult {
  rawOutput: string;
  exitCode: number;
}

export interface CodeRepairTransport {
  readonly name: string;
  run(input: CodeRepairTransportInput): Promise<CodeRepairTransportResult>;
}

export type CodexRunInput = CodeRepairTransportInput;
export type CodexRunResult = CodeRepairTransportResult;

/**
 * CodexCliAgent — headless executor that delegates to `codex exec`.
 * Derived from code-task-design.md §8.1.
 * System-derived diff/patch/verify truth is produced by ArtifactWriter after this returns.
 */
export class CodexCliAgent {
  readonly name = 'CodexCliAgent';

  run(input: CodexRunInput): Promise<CodexRunResult> {
    const { workspacePath, prompt, timeoutMs = 300_000 } = input;
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const child = spawn('codex', ['exec', '--quiet', prompt], {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ rawOutput: Buffer.concat(chunks).toString('utf8') + '\n[timeout]', exitCode: 124 });
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ rawOutput: Buffer.concat(chunks).toString('utf8'), exitCode: code ?? 1 });
      });
    });
  }
}
