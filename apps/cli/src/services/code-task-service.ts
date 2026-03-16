import { randomUUID } from 'node:crypto';
import type { Db, CodeTaskRow } from '@zarb/storage';
import { CodeTaskRepository, ReviewRepository, CommitRepository } from '@zarb/storage';
import { HarnessSessionManager, ArtifactWriter, CodexCliAgent, DEFAULT_CODE_REPAIR_POLICY } from '@zarb/agent-harness';
import { CommitManager } from '@zarb/review-manager';
import type {
  CodeTaskSummary, CodeTaskDetail, CodeTaskSummaryPage, ActionResult,
  ListCodeTasksQuery, SubmitReviewInput, CreateCommitInput,
} from '@zarb/shared-types';

function toSummary(row: CodeTaskRow): CodeTaskSummary {
  return {
    taskId: row.task_id,
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    taskVersion: row.attempt,
    runId: row.run_id,
    ...(row.testcase_id ? { testcaseId: row.testcase_id } : {}),
    status: row.status,
    ...(row.agent_name ? { agentName: row.agent_name } : {}),
    automationLevel: row.automation_level,
    mode: row.mode,
    target: row.target,
    workspacePath: row.workspace_path,
    goal: row.goal,
    ...(row.verify_passed !== null ? { verifyPassed: row.verify_passed === 1 } : {}),
    updatedAt: row.updated_at,
  };
}

export class CodeTaskService {
  private readonly tasks: CodeTaskRepository;
  private readonly reviews: ReviewRepository;
  private readonly commits: CommitRepository;
  private readonly sessionManager: HarnessSessionManager;
  private readonly artifactWriter: ArtifactWriter;
  private readonly agent: CodexCliAgent;
  private readonly commitManager: CommitManager;

  constructor(private readonly db: Db, private readonly dataRoot: string, agent?: CodexCliAgent, commitManager?: CommitManager) {
    this.tasks = new CodeTaskRepository(db);
    this.reviews = new ReviewRepository(db);
    this.commits = new CommitRepository(db);
    this.sessionManager = new HarnessSessionManager(db);
    this.artifactWriter = new ArtifactWriter(dataRoot, db);
    this.agent = agent ?? new CodexCliAgent();
    this.commitManager = commitManager ?? new CommitManager(db);
  }

  listCodeTasks(query: ListCodeTasksQuery = {}): CodeTaskSummaryPage {
    const filter: import('@zarb/storage').ListCodeTasksFilter = { limit: query.limit ?? 20 };
    if (query.runId !== undefined) filter.runId = query.runId;
    if (query.status !== undefined) filter.status = query.status as CodeTaskRow['status'];
    if (query.cursor !== undefined) filter.cursor = query.cursor;
    const page = this.tasks.list(filter);
    return { items: page.items.map(toSummary), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  getCodeTask(taskId: string): CodeTaskDetail | null {
    const row = this.tasks.findById(taskId);
    if (!row) return null;
    const reviewRow = this.reviews.findByTaskId(taskId);
    const commitRow = this.commits.findByTaskId(taskId);
    return {
      summary: toSummary(row),
      scopePaths: row.scope_paths_json ? JSON.parse(row.scope_paths_json) as string[] : [],
      constraints: row.constraints_json ? JSON.parse(row.constraints_json) as string[] : [],
      verificationCommands: row.verification_commands_json ? JSON.parse(row.verification_commands_json) as string[] : [],
      changedFiles: row.changed_files_json ? JSON.parse(row.changed_files_json) as string[] : [],
      ...(row.diff_path ? { diffPath: row.diff_path } : {}),
      ...(row.patch_path ? { patchPath: row.patch_path } : {}),
      ...(row.raw_output_path ? { rawOutputPath: row.raw_output_path } : {}),
      ...(row.verify_output_path ? { verifyOutputPath: row.verify_output_path } : {}),
      reviews: reviewRow ? [{
        reviewId: reviewRow.id,
        taskId: reviewRow.task_id,
        decision: reviewRow.decision,
        ...(reviewRow.comment ? { comment: reviewRow.comment } : {}),
        ...(reviewRow.diff_hash ? { diffHash: reviewRow.diff_hash } : {}),
        ...(reviewRow.patch_hash ? { patchHash: reviewRow.patch_hash } : {}),
        codeTaskVersion: reviewRow.code_task_version ?? 1,
        createdAt: reviewRow.created_at,
      }] : [],
      ...(commitRow ? { commit: {
        commitRecordId: commitRow.id,
        taskId: commitRow.task_id,
        ...(commitRow.branch_name ? { branchName: commitRow.branch_name } : {}),
        ...(commitRow.commit_sha ? { commitSha: commitRow.commit_sha } : {}),
        ...(commitRow.commit_message ? { commitMessage: commitRow.commit_message } : {}),
        status: commitRow.status,
        ...(commitRow.error_message ? { errorMessage: commitRow.error_message } : {}),
        createdAt: commitRow.created_at,
      } } : {}),
    };
  }

  approveCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (row.status !== 'PENDING_APPROVAL' && row.status !== 'DRAFT') {
      return { success: false, message: `CodeTask cannot be approved in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    this.tasks.update(taskId, { status: 'APPROVED', updatedAt: new Date().toISOString() });
    return { success: true, message: 'CodeTask approved' };
  }

  rejectCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (row.status === 'COMMITTED' || row.status === 'CANCELLED') {
      return { success: false, message: `CodeTask cannot be rejected in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    this.tasks.update(taskId, { status: 'REJECTED', updatedAt: new Date().toISOString() });
    return { success: true, message: 'CodeTask rejected' };
  }

  executeCodeTask(taskId: string): Promise<ActionResult> {
    const row = this.tasks.findById(taskId);
    if (!row) return Promise.resolve({ success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' });
    if (row.status !== 'APPROVED') {
      return Promise.resolve({ success: false, message: `CodeTask must be APPROVED before execution, current status: ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' });
    }

    const now = new Date().toISOString();
    this.tasks.update(taskId, { status: 'RUNNING', updatedAt: now });

    // Fire-and-forget: return immediately, run agent in background
    void this.runExecution(taskId, row);

    return Promise.resolve({ success: true, message: 'CodeTask execution started', nextSuggestedAction: 'poll-code-task' });
  }

  private async runExecution(taskId: string, row: import('@zarb/storage').CodeTaskRow): Promise<void> {
    const session = this.sessionManager.startSession({
      runId: row.run_id,
      taskId,
      kind: 'code-repair',
      agentName: 'CodexCliAgent',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: this.dataRoot,
    });

    try {
      const verificationCommands: string[] = row.verification_commands_json
        ? JSON.parse(row.verification_commands_json) as string[]
        : [];

      const agentResult = await this.agent.run({ workspacePath: row.workspace_path, prompt: row.goal });

      // Non-zero exit (including timeout 124) = agent failure → skip to FAILED
      if (agentResult.exitCode !== 0) {
        this.artifactWriter.writeRawOutput(taskId, agentResult.rawOutput);
        this.tasks.update(taskId, { status: 'FAILED', harnessSessionId: session.session_id, rawOutputPath: `code-tasks/${taskId}/raw-output.txt`, updatedAt: new Date().toISOString() });
        this.sessionManager.completeSession(session.session_id);
        return;
      }

      // VERIFYING stage
      this.tasks.update(taskId, { status: 'VERIFYING', updatedAt: new Date().toISOString() });

      const artifacts = this.artifactWriter.generateArtifacts({
        taskId,
        sessionId: session.session_id,
        workspacePath: row.workspace_path,
        verificationCommands,
        rawOutput: agentResult.rawOutput,
      });

      const finalStatus = artifacts.verifyPassed ? 'SUCCEEDED' : 'FAILED';
      this.tasks.update(taskId, { status: finalStatus, updatedAt: new Date().toISOString() });
      this.sessionManager.completeSession(session.session_id);
    } catch (err) {
      this.tasks.update(taskId, { status: 'FAILED', updatedAt: new Date().toISOString() });
      this.sessionManager.completeSession(session.session_id);
      // Log but don't rethrow — background task
      console.error(`[CodeTaskService] execution failed for ${taskId}:`, err);
    }
  }

  retryCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (row.status !== 'FAILED' && row.status !== 'REJECTED') {
      return { success: false, message: `CodeTask can only be retried from FAILED or REJECTED status, current: ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    const newTaskId = `task-${String(Date.now())}`;
    const now = new Date().toISOString();
    this.tasks.create({
      taskId: newTaskId,
      parentTaskId: taskId,
      runId: row.run_id,
      ...(row.testcase_id ? { testcaseId: row.testcase_id } : {}),
      workspacePath: row.workspace_path,
      goal: row.goal,
      automationLevel: row.automation_level,
      mode: row.mode,
      target: row.target,
      ...(row.scope_paths_json ? { scopePathsJson: row.scope_paths_json } : {}),
      ...(row.constraints_json ? { constraintsJson: row.constraints_json } : {}),
      ...(row.verification_commands_json ? { verificationCommandsJson: row.verification_commands_json } : {}),
      attempt: row.attempt + 1,
      createdAt: now,
    });
    return { success: true, message: 'CodeTask retry created', nextSuggestedAction: 'refresh-code-task' };
  }

  cancelCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (row.status === 'COMMITTED' || row.status === 'CANCELLED') {
      return { success: false, message: `CodeTask cannot be cancelled in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    this.tasks.update(taskId, { status: 'CANCELLED', updatedAt: new Date().toISOString() });
    return { success: true, message: 'CodeTask cancelled' };
  }

  submitReview(input: SubmitReviewInput): ActionResult {
    const row = this.tasks.findById(input.taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };

    // Version must match current attempt
    if (input.codeTaskVersion !== row.attempt) {
      return { success: false, message: `Review version mismatch: expected ${String(row.attempt)}, got ${String(input.codeTaskVersion)}`, errorCode: 'CODE_TASK_VERSION_MISMATCH' };
    }

    // Normal review requires SUCCEEDED; FAILED requires explicit forceReviewOnVerifyFailure
    if (row.status === 'FAILED') {
      if (!input.forceReviewOnVerifyFailure || input.decision !== 'accept') {
        return { success: false, message: 'Task verify failed; set forceReviewOnVerifyFailure=true with decision=accept to override', errorCode: 'CODE_TASK_STATE_INVALID' };
      }
      // Override review only valid when verify actually failed with persisted artifacts
      if (row.verify_passed !== 0 || !row.diff_path) {
        return { success: false, message: 'Override review requires verify_passed=false and persisted diff/patch artifacts', errorCode: 'CODE_TASK_STATE_INVALID' };
      }
      // Mark override used
      this.tasks.update(input.taskId, { verifyOverrideUsed: true, updatedAt: new Date().toISOString() });
    } else if (row.status !== 'SUCCEEDED') {
      return { success: false, message: `Review not allowed in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    const now = new Date().toISOString();
    this.reviews.create({
      id: randomUUID(),
      taskId: input.taskId,
      decision: input.decision,
      ...(input.comment ? { comment: input.comment } : {}),
      ...(input.diffHash ? { diffHash: input.diffHash } : {}),
      ...(input.patchHash ? { patchHash: input.patchHash } : {}),
      codeTaskVersion: input.codeTaskVersion,
      createdAt: now,
    });

    if (input.decision === 'accept') {
      this.tasks.update(input.taskId, { status: 'COMMIT_PENDING', updatedAt: now });
    } else if (input.decision === 'reject') {
      this.tasks.update(input.taskId, { status: 'REJECTED', updatedAt: now });
    } else {
      // retry: mark original as superseded and immediately create new attempt
      this.tasks.update(input.taskId, { status: 'FAILED', updatedAt: now });
      const newTaskId = `task-${String(Date.now())}`;
      this.tasks.create({
        taskId: newTaskId,
        parentTaskId: input.taskId,
        runId: row.run_id,
        ...(row.testcase_id ? { testcaseId: row.testcase_id } : {}),
        workspacePath: row.workspace_path,
        goal: row.goal,
        automationLevel: row.automation_level,
        mode: row.mode,
        target: row.target,
        ...(row.scope_paths_json ? { scopePathsJson: row.scope_paths_json } : {}),
        ...(row.constraints_json ? { constraintsJson: row.constraints_json } : {}),
        ...(row.verification_commands_json ? { verificationCommandsJson: row.verification_commands_json } : {}),
        attempt: row.attempt + 1,
        createdAt: now,
      });
    }
    return { success: true, message: `Review submitted: ${input.decision}` };
  }

  createCommit(input: CreateCommitInput): ActionResult {
    const row = this.tasks.findById(input.taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };

    if (row.status !== 'COMMIT_PENDING') {
      return { success: false, message: `CodeTask must be COMMIT_PENDING, current status: ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }

    if (input.expectedTaskVersion !== undefined && input.expectedTaskVersion !== row.attempt) {
      return { success: false, message: `Version mismatch: expected ${String(row.attempt)}, got ${String(input.expectedTaskVersion)}`, errorCode: 'CODE_TASK_VERSION_MISMATCH' };
    }

    // Ensure commit record exists
    let commitRow = this.commits.findByTaskId(input.taskId);
    if (!commitRow) {
      this.commits.create({
        id: randomUUID(),
        taskId: input.taskId,
        commitMessage: input.commitMessage,
        createdAt: new Date().toISOString(),
      });
      commitRow = this.commits.findByTaskId(input.taskId);
    }

    const result = this.commitManager.commit({
      taskId: input.taskId,
      commitMessage: input.commitMessage,
      dataRoot: this.dataRoot,
      ...(input.branchName ? { branchName: input.branchName } : {}),
    });

    if (!result.success) {
      return { success: false, message: result.errorMessage ?? 'Commit failed', errorCode: 'COMMIT_FAILED' };
    }

    return { success: true, message: `Committed: ${result.commitSha ?? ''}` };
  }
}
