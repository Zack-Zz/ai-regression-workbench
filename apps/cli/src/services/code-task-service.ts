import { randomUUID } from 'node:crypto';
import type { Db, CodeTaskRow } from '@zarb/storage';
import { CodeTaskRepository, ReviewRepository, CommitRepository, CodeTaskDraftRepository, AnalysisRepository } from '@zarb/storage';
import { HarnessSessionManager, ArtifactWriter, CodexCliAgent, KiroCliAgent, DEFAULT_CODE_REPAIR_POLICY } from '@zarb/agent-harness';
import { CommitManager } from '@zarb/review-manager';
import type {
  CodeTaskSummary, CodeTaskDetail, CodeTaskSummaryPage, ActionResult,
  ListCodeTasksQuery, SubmitReviewInput, CreateCommitInput,
} from '@zarb/shared-types';
import {
  deriveRunStatusFromCodeTasks,
  isCodeTaskTransitionAllowed,
  isRunInCodeTaskCoordinationStage,
} from '@zarb/shared-types';
import type { RunStatus } from '@zarb/shared-types';
import { emitEvent } from '../event-bus.js';
import { appLogger } from '@zarb/logger';
import { resolveConfiguredRelativePath } from '../storage-paths.js';

const log = appLogger.child('CodeTaskService');

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
  private readonly drafts: CodeTaskDraftRepository;
  private readonly analyses: AnalysisRepository;
  private readonly sessionManager: HarnessSessionManager;
  private readonly artifactWriter: ArtifactWriter;
  private readonly agent: CodexCliAgent | KiroCliAgent;
  private readonly commitManager: CommitManager;
  private readonly codeTaskRoot: string;

  constructor(
    private readonly db: Db,
    private readonly dataRoot: string,
    agent?: CodexCliAgent | KiroCliAgent,
    commitManager?: CommitManager,
    codeTaskRoot?: string,
  ) {
    this.tasks = new CodeTaskRepository(db);
    this.reviews = new ReviewRepository(db);
    this.commits = new CommitRepository(db);
    this.drafts = new CodeTaskDraftRepository(db);
    this.analyses = new AnalysisRepository(db);
    this.sessionManager = new HarnessSessionManager(db);
    this.artifactWriter = new ArtifactWriter(dataRoot, db, codeTaskRoot);
    this.agent = agent ?? new CodexCliAgent();
    this.commitManager = commitManager ?? new CommitManager(db);
    this.codeTaskRoot = codeTaskRoot ?? `${dataRoot}/code-tasks`;
  }

  private emitTask(taskId: string, type: 'code-task.created' | 'code-task.updated' = 'code-task.updated'): void {
    emitEvent({ type, id: taskId });
  }

  private syncRunForTask(taskId: string): void {
    const row = this.tasks.findById(taskId);
    if (!row) return;
    this.syncRunForRun(row.run_id);
  }

  private syncRunForRun(runId: string): void {
    const run = this.db.prepare('SELECT status FROM test_runs WHERE run_id = ?').get(runId) as { status: RunStatus } | undefined;
    if (!run) return;
    if (!isRunInCodeTaskCoordinationStage(run.status)) return;

    const allTasks = this.tasks.list({ runId, limit: 1000 }).items;
    const newStatus = deriveRunStatusFromCodeTasks(allTasks.map((task) => task.status));
    if (!newStatus) return;

    if (newStatus !== run.status) {
      this.db.prepare('UPDATE test_runs SET status = ?, current_stage = ?, updated_at = ? WHERE run_id = ?')
        .run(newStatus, newStatus, new Date().toISOString(), runId);
    }
  }

  listCodeTasks(query: ListCodeTasksQuery = {}): CodeTaskSummaryPage {
    const filter: import('@zarb/storage').ListCodeTasksFilter = { limit: query.limit ?? 20 };
    if (query.runId !== undefined) filter.runId = query.runId;
    if (query.status !== undefined) filter.status = query.status as CodeTaskRow['status'];
    if (query.cursor !== undefined) filter.cursor = query.cursor;
    const page = this.tasks.list(filter);
    return { items: page.items.map(toSummary), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  listDrafts(runId: string, testcaseId?: string): import('@zarb/storage').CodeTaskDraftRow[] {
    const all = this.drafts.findByRun(runId);
    if (!testcaseId) return all;
    // Filter by testcaseId via the analysis record that links draft → testcase
    const analysis = this.analyses.findByTestcase(runId, testcaseId);
    if (!analysis) return [];
    return all.filter(d => d.analysis_id === analysis.id);
  }

  promoteToCodeTask(draftId: string, runId?: string, testcaseId?: string): ActionResult & { taskId?: string } {
    const draft = this.drafts.findById(draftId);
    if (!draft) return { success: false, message: 'Draft not found', errorCode: 'DRAFT_NOT_FOUND' };
    if (runId && draft.run_id !== runId) {
      return { success: false, message: 'Draft not found', errorCode: 'DRAFT_NOT_FOUND' };
    }
    const linkedAnalysis = draft.analysis_id
      ? this.db.prepare('SELECT testcase_id FROM failure_analysis WHERE id = ? LIMIT 1').get(draft.analysis_id) as { testcase_id: string | null } | undefined
      : undefined;
    if (testcaseId) {
      const analysis = this.analyses.findByTestcase(runId ?? draft.run_id, testcaseId);
      if (!analysis || draft.analysis_id !== analysis.id) {
        return { success: false, message: 'Draft not found', errorCode: 'DRAFT_NOT_FOUND' };
      }
    }
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.tasks.create({
      taskId,
      runId: draft.run_id,
      ...(linkedAnalysis?.testcase_id ? { testcaseId: linkedAnalysis.testcase_id } : {}),
      workspacePath: draft.workspace_path,
      goal: draft.goal,
      ...(draft.scope_paths_json ? { scopePathsJson: draft.scope_paths_json } : {}),
      ...(draft.constraints_json ? { constraintsJson: draft.constraints_json } : {}),
      ...(draft.verification_commands_json ? { verificationCommandsJson: draft.verification_commands_json } : {}),
      createdAt: now,
    });
    // Set status to PENDING_APPROVAL after creation
    this.tasks.update(taskId, { status: 'PENDING_APPROVAL', updatedAt: now });
    this.emitTask(taskId, 'code-task.created');
    this.syncRunForRun(draft.run_id);
    return { success: true, message: 'Promoted to CodeTask', taskId };
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

  getCodeTaskArtifactPath(
    taskId: string,
    kind: 'diff' | 'patch' | 'raw-output' | 'verify-output',
  ): string | null {
    const row = this.tasks.findById(taskId);
    if (!row) return null;
    const relativePath = kind === 'diff'
      ? row.diff_path
      : kind === 'patch'
        ? row.patch_path
        : kind === 'raw-output'
          ? row.raw_output_path
          : row.verify_output_path;
    if (!relativePath) return null;
    return resolveConfiguredRelativePath(this.codeTaskRoot, 'code-tasks', relativePath);
  }

  approveCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (!isCodeTaskTransitionAllowed(row.status, 'APPROVED')) {
      return { success: false, message: `CodeTask cannot be approved in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    this.tasks.update(taskId, { status: 'APPROVED', updatedAt: new Date().toISOString() });
    this.emitTask(taskId);
    this.syncRunForTask(taskId);
    return { success: true, message: 'CodeTask approved' };
  }

  rejectCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (!isCodeTaskTransitionAllowed(row.status, 'REJECTED')) {
      return { success: false, message: `CodeTask cannot be rejected in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    this.tasks.update(taskId, { status: 'REJECTED', updatedAt: new Date().toISOString() });
    this.emitTask(taskId);
    this.syncRunForTask(taskId);
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
    this.emitTask(taskId);
    this.syncRunForTask(taskId);

    // Fire-and-forget: return immediately, run agent in background
    void this.runExecution(taskId, row);

    return Promise.resolve({ success: true, message: 'CodeTask execution started', nextSuggestedAction: 'poll-code-task' });
  }

  private async runExecution(taskId: string, row: import('@zarb/storage').CodeTaskRow): Promise<void> {
    const session = this.sessionManager.startSession({
      runId: row.run_id,
      taskId,
      kind: 'code-repair',
      agentName: this.agent instanceof KiroCliAgent ? 'KiroCliAgent' : 'CodexCliAgent',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: this.dataRoot,
    });

    log.info('code task execution started', { taskId, runId: row.run_id, agent: this.agent instanceof KiroCliAgent ? 'KiroCliAgent' : 'CodexCliAgent', goal: row.goal.slice(0, 120) });

    try {
      const verificationCommands: string[] = row.verification_commands_json
        ? JSON.parse(row.verification_commands_json) as string[]
        : [];

      const t0 = Date.now();
      const agentResult = await this.agent.run({ workspacePath: row.workspace_path, prompt: row.goal });
      log.info('agent run completed', { taskId, exitCode: agentResult.exitCode, durationMs: Date.now() - t0 });

      // Record agent execution step
      this.sessionManager.appendStep(session.session_id, {
        stepIndex: 0,
        description: `codex exec: ${row.goal.slice(0, 100)}`,
        outcome: agentResult.exitCode === 0 ? 'ok' : `exit ${String(agentResult.exitCode)}`,
        timestamp: new Date().toISOString(),
      }, this.dataRoot);

      if (agentResult.exitCode !== 0) {
        log.warn('agent run failed', { taskId, exitCode: agentResult.exitCode });
        const rawOutputPath = this.artifactWriter.writeRawOutput(taskId, agentResult.rawOutput);
        this.tasks.update(taskId, { status: 'FAILED', harnessSessionId: session.session_id, rawOutputPath, updatedAt: new Date().toISOString() });
        this.emitTask(taskId);
        this.syncRunForTask(taskId);
        this.sessionManager.completeSession(session.session_id);
        return;
      }

      // VERIFYING stage
      log.info('code task verifying', { taskId, verificationCommands });
      this.tasks.update(taskId, { status: 'VERIFYING', updatedAt: new Date().toISOString() });
      this.emitTask(taskId);
      this.syncRunForTask(taskId);

      const artifacts = this.artifactWriter.generateArtifacts({
        taskId,
        sessionId: session.session_id,
        workspacePath: row.workspace_path,
        verificationCommands,
        rawOutput: agentResult.rawOutput,
      });

      const finalStatus = artifacts.verifyPassed ? 'SUCCEEDED' : 'FAILED';
      log.info('code task verify done', { taskId, verifyPassed: artifacts.verifyPassed, finalStatus });
      this.tasks.update(taskId, { status: finalStatus, updatedAt: new Date().toISOString() });
      this.emitTask(taskId);
      this.syncRunForTask(taskId);
      this.sessionManager.completeSession(session.session_id);
    } catch (err) {
      log.error('code task execution threw', { taskId, error: String(err) });
      this.tasks.update(taskId, { status: 'FAILED', updatedAt: new Date().toISOString() });
      this.emitTask(taskId);
      this.syncRunForTask(taskId);
      this.sessionManager.completeSession(session.session_id);
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
    this.syncRunForRun(row.run_id);
    return { success: true, message: 'CodeTask retry created', nextSuggestedAction: 'refresh-code-task' };
  }

  cancelCodeTask(taskId: string): ActionResult {
    const row = this.tasks.findById(taskId);
    if (!row) return { success: false, message: 'CodeTask not found', errorCode: 'CODE_TASK_NOT_FOUND' };
    if (!isCodeTaskTransitionAllowed(row.status, 'CANCELLED')) {
      return { success: false, message: `CodeTask cannot be cancelled in status ${row.status}`, errorCode: 'CODE_TASK_STATE_INVALID' };
    }
    this.tasks.update(taskId, { status: 'CANCELLED', updatedAt: new Date().toISOString() });
    this.emitTask(taskId);
    this.syncRunForTask(taskId);
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
      this.emitTask(input.taskId);
      this.syncRunForTask(input.taskId);
    } else if (input.decision === 'reject') {
      this.tasks.update(input.taskId, { status: 'REJECTED', updatedAt: now });
      this.emitTask(input.taskId);
      this.syncRunForTask(input.taskId);
    } else {
      // retry: align with the orchestrator flow by rejecting the reviewed attempt
      // and creating a follow-up draft task as the next attempt.
      this.tasks.update(input.taskId, { status: 'REJECTED', updatedAt: now });
      this.emitTask(input.taskId);
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
      this.syncRunForRun(row.run_id);
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

    const now = new Date().toISOString();
    if (commitRow) {
      this.commits.update(commitRow.id, {
        status: 'committed',
        ...(result.commitSha ? { commitSha: result.commitSha } : {}),
        ...(result.branchName ? { branchName: result.branchName } : {}),
        updatedAt: now,
      });
    }
    this.tasks.update(input.taskId, { status: 'COMMITTED', updatedAt: now });
    this.emitTask(input.taskId);
    this.syncRunForTask(input.taskId);
    return { success: true, message: `Committed: ${result.commitSha ?? ''}` };
  }
}
