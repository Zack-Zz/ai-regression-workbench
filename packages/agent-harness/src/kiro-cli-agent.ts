import { spawn } from 'node:child_process';
import type { CodexRunInput, CodexRunResult } from './codex-cli-agent.js';

/**
 * KiroCliAgent — headless executor that delegates to `kiro chat --mode agent`.
 * Interface-compatible with CodexCliAgent so it can be swapped in CodeTaskService.
 *
 * kiro chat [prompt] --mode agent runs the agent in the given working directory
 * and exits when the task is complete.
 */
export class KiroCliAgent {
  run(input: CodexRunInput): Promise<CodexRunResult> {
    const { workspacePath, prompt, timeoutMs = 300_000 } = input;
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const child = spawn('kiro', ['chat', prompt, '--mode', 'agent'], {
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
