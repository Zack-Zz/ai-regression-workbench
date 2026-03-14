import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { codeTaskDiffPath, codeTaskPatchPath, codeTaskVerifyPath, codeTaskRawOutputPath } from '@zarb/storage';
import type { Db } from '@zarb/storage';
import { CodeTaskRepository } from '@zarb/storage';

export interface GenerateArtifactsInput {
  taskId: string;
  sessionId: string;
  workspacePath: string;
  verificationCommands: string[];
}

export interface GenerateArtifactsResult {
  diffPath: string;
  patchPath: string;
  verifyPath: string;
  rawOutputPath: string;
  verifyPassed: boolean;
}

/**
 * ArtifactWriter — writes system-derived CodeTask artifacts.
 * diff/patch/verify outputs are produced by the Harness from workspace state,
 * not self-reported by the agent.
 * Derived from agent-harness-design.md §6.2 and §9.
 */
export class ArtifactWriter {
  private readonly codeTaskRepo: CodeTaskRepository | null;

  constructor(private readonly dataRoot: string, db?: Db) {
    this.codeTaskRepo = db ? new CodeTaskRepository(db) : null;
  }

  /**
   * generateArtifacts — system-derived truth generation:
   * 1. Runs `git diff` and `git format-patch` in workspacePath
   * 2. Runs verificationCommands and captures output
   * 3. Writes all artifacts to disk
   * 4. Updates code_tasks with artifact paths, verifyPassed, and harnessSessionId
   */
  generateArtifacts(input: GenerateArtifactsInput): GenerateArtifactsResult {
    const { taskId, sessionId, workspacePath, verificationCommands } = input;

    // 1. Generate diff and patch from current workspace state (both from `git diff HEAD`)
    const diff = this.runCommand('git diff HEAD', workspacePath);
    const patch = this.runCommand('git diff HEAD', workspacePath);

    // 2. Run verification commands and collect output
    let verifyOutput = '';
    let verifyPassed = true;
    for (const cmd of verificationCommands) {
      try {
        const out = this.runCommand(cmd, workspacePath);
        verifyOutput += `$ ${cmd}\n${out}\n`;
      } catch (err) {
        verifyPassed = false;
        verifyOutput += `$ ${cmd}\n${String(err)}\n`;
      }
    }

    // 3. Write artifacts to disk
    const diffPath = this.write(codeTaskDiffPath(taskId), diff);
    const patchPath = this.write(codeTaskPatchPath(taskId), patch);
    const verifyPath = this.write(codeTaskVerifyPath(taskId), verifyOutput);
    const rawOutputPath = this.write(codeTaskRawOutputPath(taskId), verifyOutput);

    // 4. Update code_tasks with artifact paths and harness session link
    if (this.codeTaskRepo) {
      this.codeTaskRepo.update(taskId, {
        harnessSessionId: sessionId,
        diffPath,
        patchPath,
        verifyPassed,
        rawOutputPath,
        updatedAt: new Date().toISOString(),
      });
    }

    return { diffPath, patchPath, verifyPath, rawOutputPath, verifyPassed };
  }

  /** Write raw content directly (for cases where content is already available). */
  writeDiff(taskId: string, diffContent: string): string {
    return this.write(codeTaskDiffPath(taskId), diffContent);
  }

  writePatch(taskId: string, patchContent: string): string {
    return this.write(codeTaskPatchPath(taskId), patchContent);
  }

  writeVerifyOutput(taskId: string, output: string): string {
    return this.write(codeTaskVerifyPath(taskId), output);
  }

  writeRawOutput(taskId: string, output: string): string {
    return this.write(codeTaskRawOutputPath(taskId), output);
  }

  private write(relPath: string, content: string): string {
    const absPath = join(this.dataRoot, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    return relPath;
  }

  private runCommand(cmd: string, cwd: string): string {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  }
}
