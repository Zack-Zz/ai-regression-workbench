import type { Db } from '../db.js';
import type { CodeTaskStatus, AutomationLevel, CodeTaskMode, CodeTaskTarget } from '@zarb/shared-types';

export interface CodeTaskRow {
  task_id: string;
  parent_task_id: string | null;
  run_id: string;
  testcase_id: string | null;
  analysis_id: string | null;
  analysis_version: number | null;
  status: CodeTaskStatus;
  agent_name: string | null;
  harness_session_id: string | null;
  automation_level: AutomationLevel;
  mode: CodeTaskMode;
  target: CodeTaskTarget;
  workspace_path: string;
  scope_paths_json: string | null;
  goal: string;
  constraints_json: string | null;
  verification_commands_json: string | null;
  attempt: number;
  summary: string | null;
  changed_files_json: string | null;
  diff_path: string | null;
  patch_path: string | null;
  raw_output_path: string | null;
  verify_passed: number | null;
  verify_override_used: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCodeTaskInput {
  taskId: string;
  parentTaskId?: string;
  runId: string;
  testcaseId?: string;
  analysisId?: string;
  agentName?: string;
  automationLevel?: AutomationLevel;
  mode?: CodeTaskMode;
  target?: CodeTaskTarget;
  workspacePath: string;
  scopePathsJson?: string;
  goal: string;
  constraintsJson?: string;
  verificationCommandsJson?: string;
  attempt?: number;
  createdAt: string;
}

export interface UpdateCodeTaskInput {
  status?: CodeTaskStatus;
  harnessSessionId?: string;
  summary?: string;
  changedFilesJson?: string;
  diffPath?: string;
  patchPath?: string;
  verifyPassed?: boolean;
  verifyOverrideUsed?: boolean;
  rawOutputPath?: string;
  updatedAt: string;
}

export interface ListCodeTasksFilter {
  runId?: string;
  status?: CodeTaskStatus;
  cursor?: string;
  limit?: number;
}

export interface CodeTaskPage {
  items: CodeTaskRow[];
  nextCursor: string | undefined;
}

export class CodeTaskRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateCodeTaskInput): void {
    this.db
      .prepare(`
        INSERT INTO code_tasks
          (task_id, parent_task_id, run_id, testcase_id, analysis_id, status,
           agent_name, automation_level, mode, target, workspace_path,
           scope_paths_json, goal, constraints_json, verification_commands_json,
           attempt, created_at, updated_at)
        VALUES
          (@taskId, @parentTaskId, @runId, @testcaseId, @analysisId, 'PENDING_APPROVAL',
           @agentName, @automationLevel, @mode, @target, @workspacePath,
           @scopePathsJson, @goal, @constraintsJson, @verificationCommandsJson,
           @attempt, @createdAt, @createdAt)
      `)
      .run({
        taskId: input.taskId,
        parentTaskId: input.parentTaskId ?? null,
        runId: input.runId,
        testcaseId: input.testcaseId ?? null,
        analysisId: input.analysisId ?? null,
        agentName: input.agentName ?? null,
        automationLevel: input.automationLevel ?? 'headless',
        mode: input.mode ?? 'apply',
        target: input.target ?? 'app',
        workspacePath: input.workspacePath,
        scopePathsJson: input.scopePathsJson ?? null,
        goal: input.goal,
        constraintsJson: input.constraintsJson ?? null,
        verificationCommandsJson: input.verificationCommandsJson ?? null,
        attempt: input.attempt ?? 1,
        createdAt: input.createdAt,
      });
  }

  update(taskId: string, input: UpdateCodeTaskInput): void {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { taskId, updatedAt: input.updatedAt };

    if (input.status !== undefined) { sets.push('status = @status'); params['status'] = input.status; }
    if (input.harnessSessionId !== undefined) { sets.push('harness_session_id = @harnessSessionId'); params['harnessSessionId'] = input.harnessSessionId; }
    if (input.summary !== undefined) { sets.push('summary = @summary'); params['summary'] = input.summary; }
    if (input.changedFilesJson !== undefined) { sets.push('changed_files_json = @changedFilesJson'); params['changedFilesJson'] = input.changedFilesJson; }
    if (input.diffPath !== undefined) { sets.push('diff_path = @diffPath'); params['diffPath'] = input.diffPath; }
    if (input.patchPath !== undefined) { sets.push('patch_path = @patchPath'); params['patchPath'] = input.patchPath; }
    if (input.verifyPassed !== undefined) { sets.push('verify_passed = @verifyPassed'); params['verifyPassed'] = input.verifyPassed ? 1 : 0; }
    if (input.verifyOverrideUsed !== undefined) { sets.push('verify_override_used = @verifyOverrideUsed'); params['verifyOverrideUsed'] = input.verifyOverrideUsed ? 1 : 0; }
    if (input.rawOutputPath !== undefined) { sets.push('raw_output_path = @rawOutputPath'); params['rawOutputPath'] = input.rawOutputPath; }

    this.db.prepare(`UPDATE code_tasks SET ${sets.join(', ')} WHERE task_id = @taskId`).run(params);
  }

  findById(taskId: string): CodeTaskRow | undefined {
    return this.db.prepare('SELECT * FROM code_tasks WHERE task_id = ?').get(taskId) as CodeTaskRow | undefined;
  }

  list(filter: ListCodeTasksFilter = {}): CodeTaskPage {
    const limit = filter.limit ?? 20;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.runId) { conditions.push('run_id = ?'); params.push(filter.runId); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.cursor) { conditions.push('created_at < ?'); params.push(filter.cursor); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM code_tasks ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit + 1) as CodeTaskRow[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = items[items.length - 1];
    return { items, nextCursor: hasMore && lastItem ? lastItem.created_at : undefined };
  }
}
