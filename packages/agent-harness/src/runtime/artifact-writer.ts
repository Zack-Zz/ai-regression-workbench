import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import { codeTaskDiffPath, codeTaskPatchPath, codeTaskVerifyPath, codeTaskRawOutputPath } from '@zarb/storage';
import type { Db } from '@zarb/storage';
import { CodeTaskRepository } from '@zarb/storage';

export interface GenerateArtifactsInput {
  taskId: string;
  sessionId: string;
  workspacePath: string;
  verificationCommands: string[];
  /** Raw agent output to persist as raw-output.txt (separate from verify output). */
  rawOutput?: string;
}

export interface GenerateArtifactsResult {
  diffPath: string;
  patchPath: string;
  verifyPath: string;
  rawOutputPath: string;
  verifyPassed: boolean;
  changedFiles: string[];
}

function resolveConfiguredRelativePath(rootDir: string, defaultPrefix: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${defaultPrefix}/`;
  const candidate = resolve(rootDir, normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized);
  const rel = relative(resolve(rootDir), candidate);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return candidate;
  }
  throw new Error(`Path escapes configured root: ${relativePath}`);
}

function toConfiguredRelativePath(rootDir: string, defaultPrefix: string, ...segments: string[]): string {
  return join(rootDir.split(/[/\\]/).pop() ?? defaultPrefix, ...segments);
}

/**
 * ArtifactWriter — writes system-derived CodeTask artifacts.
 * diff/patch/verify outputs are produced by the Harness from workspace state,
 * not self-reported by the agent.
 * Derived from agent-harness-design.md §6.2 and §9.
 */
export class ArtifactWriter {
  private readonly codeTaskRepo: CodeTaskRepository | null;
  private readonly codeTaskRoot: string;

  constructor(private readonly dataRoot: string, db?: Db, codeTaskRoot?: string) {
    this.codeTaskRepo = db ? new CodeTaskRepository(db) : null;
    this.codeTaskRoot = codeTaskRoot ?? join(dataRoot, 'code-tasks');
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

    // 1. Generate diff and patch from current workspace state.
    //    For tracked changes: git diff HEAD.
    //    For untracked new files: git ls-files --others --exclude-standard (non-destructive, no index mutation).
    const trackedDiff = this.tryCommand('git diff HEAD', workspacePath);
    const untrackedFiles = this.tryCommand('git ls-files --others --exclude-standard', workspacePath)
      .split('\n').map(l => l.trim()).filter(Boolean);

    // Build unified diff for untracked files by reading their content directly
    const untrackedDiffParts: string[] = [];
    for (const file of untrackedFiles) {
      try {
        const content = readFileSync(join(workspacePath, file), 'utf8');
        const lines = content.split('\n').map(l => `+${l}`).join('\n');
        untrackedDiffParts.push(`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n${lines}`);
      } catch { /* skip unreadable files */ }
    }

    const diff = trackedDiff + (untrackedDiffParts.length ? '\n' + untrackedDiffParts.join('\n') : '');
    const patch = diff;
    const trackedChanged = this.tryCommand('git diff HEAD --name-only', workspacePath)
      .split('\n').map(l => l.trim()).filter(Boolean);
    const changedFiles = [...new Set([...trackedChanged, ...untrackedFiles])];

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

    // 3. Write artifacts to disk — raw agent output and verify output are separate files
    const diffPath = this.write(codeTaskDiffPath(taskId), diff);
    const patchPath = this.write(codeTaskPatchPath(taskId), patch);
    const verifyPath = this.write(codeTaskVerifyPath(taskId), verifyOutput);
    const rawOutputPath = this.write(codeTaskRawOutputPath(taskId), input.rawOutput ?? '');

    // 4. Update code_tasks with artifact paths and harness session link
    if (this.codeTaskRepo) {
      this.codeTaskRepo.update(taskId, {
        harnessSessionId: sessionId,
        diffPath,
        patchPath,
        verifyPassed,
        rawOutputPath,
        verifyOutputPath: verifyPath,
        changedFilesJson: JSON.stringify(changedFiles),
        updatedAt: new Date().toISOString(),
      });
    }

    return { diffPath, patchPath, verifyPath, rawOutputPath, verifyPassed, changedFiles };
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
    const absPath = resolveConfiguredRelativePath(this.codeTaskRoot, 'code-tasks', relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return toConfiguredRelativePath(this.codeTaskRoot, 'code-tasks', ...parts.slice(1));
  }

  private runCommand(cmd: string, cwd: string): string {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  }

  private tryCommand(cmd: string, cwd: string): string {
    try {
      return this.runCommand(cmd, cwd);
    } catch {
      return '';
    }
  }
}
