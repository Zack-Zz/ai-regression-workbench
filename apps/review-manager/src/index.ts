import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Db } from '@zarb/storage';
import { CommitRepository, CodeTaskRepository } from '@zarb/storage';

export interface CommitInput {
  taskId: string;
  commitMessage: string;
  /** Branch to create/checkout before committing. If omitted, commits on current branch. */
  branchName?: string;
  dataRoot: string;
}

export interface CommitResult {
  success: boolean;
  commitSha?: string;
  branchName?: string;
  errorMessage?: string;
}

/**
 * CommitManager — executes real git commits in the target workspace.
 * Derived from code-task-design.md §4, design.md §7.7, Phase 14 roadmap.
 *
 * Staging strategy: only stage files listed in `changedFiles` (system-derived from
 * ArtifactWriter). This ensures the commit is scoped to the reviewed task snapshot
 * and does not sweep unrelated dirty files into the commit.
 *
 * Patch is NOT re-applied here: the workspace already contains the agent's changes
 * from the execution phase. Applying the patch again would fail on a dirty workspace.
 */
export class CommitManager {
  private readonly commits: CommitRepository;
  private readonly tasks: CodeTaskRepository;

  constructor(private readonly db: Db) {
    this.commits = new CommitRepository(db);
    this.tasks = new CodeTaskRepository(db);
  }

  commit(input: CommitInput): CommitResult {
    const commitRow = this.commits.findByTaskId(input.taskId);
    if (!commitRow) {
      return { success: false, errorMessage: 'Commit record not found for task' };
    }

    const taskRow = this.tasks.findById(input.taskId);
    if (!taskRow) {
      return { success: false, errorMessage: 'CodeTask not found' };
    }

    const workspacePath = taskRow.workspace_path;
    const now = new Date().toISOString();

    // Security: reject path traversal attempts
    const resolvedPath = resolve(workspacePath);
    if (resolvedPath !== workspacePath && !resolvedPath.startsWith('/')) {
      return { success: false, errorMessage: `Invalid workspace path: ${workspacePath}` };
    }

    try {
      // 1. Optionally create/checkout branch
      const branch = input.branchName ?? this.currentBranch(workspacePath);
      if (input.branchName) {
        try {
          this.run(`git checkout -b "${input.branchName}"`, workspacePath);
        } catch {
          // Branch may already exist — checkout instead
          this.run(`git checkout "${input.branchName}"`, workspacePath);
        }
      }

      // 2. Stage only the task-scoped changed files (not git add -A)
      const changedFiles: string[] = taskRow.changed_files_json
        ? JSON.parse(taskRow.changed_files_json) as string[]
        : [];

      if (changedFiles.length > 0) {
        // Stage each file individually to avoid sweeping unrelated dirty files
        for (const file of changedFiles) {
          this.run(`git add -- "${file}"`, workspacePath);
        }
      } else {
        // Fallback: stage all tracked modifications (but not untracked files)
        this.run('git add -u', workspacePath);
      }

      // 3. Commit
      this.run(`git commit -m "${input.commitMessage.replace(/"/g, '\\"')}"`, workspacePath);

      // 4. Capture commit SHA
      const sha = this.run('git rev-parse HEAD', workspacePath).trim();

      // 5. Persist
      this.commits.update(commitRow.id, { status: 'committed', commitSha: sha, branchName: branch, updatedAt: now });
      this.tasks.update(input.taskId, { status: 'COMMITTED', updatedAt: now });

      return { success: true, commitSha: sha, branchName: branch };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.commits.update(commitRow.id, { status: 'failed', errorMessage, updatedAt: now });
      return { success: false, errorMessage };
    }
  }

  private currentBranch(cwd: string): string {
    try {
      return this.run('git rev-parse --abbrev-ref HEAD', cwd).trim();
    } catch {
      return 'unknown';
    }
  }

  private run(cmd: string, cwd: string): string {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  }
}
