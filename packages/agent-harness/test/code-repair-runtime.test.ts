import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { openDb, runMigrations, RunRepository, CodeTaskRepository, CodeTaskMemoryRepository } from '@zarb/storage';
import type { CodeTaskRow } from '@zarb/storage';
import {
  HarnessSessionManager,
  DEFAULT_CODE_REPAIR_POLICY,
  ToolExecutionPlanner,
  ToolRegistry,
} from '../src/runtime/index.js';
import type { CodeRepairContext } from '../src/runtime/index.js';
import type { CodeRepairTransport } from '../src/code-repair/index.js';
import { CodeRepairAgent } from '../src/code-repair/code-repair-agent.js';
import { CodeTaskMemory } from '../src/code-repair/code-task-memory.js';
import { CodeRepairPromptBuilder } from '../src/code-repair/prompt-builder.js';
import { ReadOnlyPlanAgent } from '../src/code-repair/plan-agent.js';
import { VerificationAgent } from '../src/code-repair/verification-agent.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-code-repair-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  return () => { rmSync(dir, { recursive: true, force: true }); };
});

function makeDb() {
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function seedRun(db: ReturnType<typeof makeDb>, runId = 'r1') {
  new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
}

function seedTask(db: ReturnType<typeof makeDb>, overrides: Partial<CodeTaskRow> = {}): CodeTaskRow {
  const repo = new CodeTaskRepository(db);
  repo.create({
    taskId: overrides.task_id ?? 'task-1',
    runId: overrides.run_id ?? 'r1',
    testcaseId: overrides.testcase_id ?? 'tc-1',
    workspacePath: overrides.workspace_path ?? '/ws',
    scopePathsJson: overrides.scope_paths_json ?? JSON.stringify(['src/login.ts', 'tests/login.spec.ts']),
    goal: overrides.goal ?? 'Fix the login redirect after authentication.',
    constraintsJson: overrides.constraints_json ?? JSON.stringify(['Keep the public API unchanged.']),
    verificationCommandsJson: overrides.verification_commands_json ?? JSON.stringify(['pnpm test -- login']),
    attempt: overrides.attempt ?? 2,
    createdAt: overrides.created_at ?? new Date().toISOString(),
  });
  const task = repo.findById(overrides.task_id ?? 'task-1');
  if (!task) throw new Error('expected seeded task');
  repo.update(task.task_id, { status: 'APPROVED', updatedAt: new Date().toISOString() });
  const approvedTask = repo.findById(task.task_id);
  if (!approvedTask) throw new Error('expected approved task');
  return approvedTask;
}

function makeContext(): CodeRepairContext {
  return {
    taskId: 'task-1',
    runId: 'r1',
    testcaseId: 'tc-1',
    workspacePath: '/ws',
    goal: 'Fix the login redirect after authentication.',
    scopePaths: ['src/login.ts', 'tests/login.spec.ts'],
    constraints: ['Keep the public API unchanged.'],
    verificationCommands: ['pnpm test -- login'],
    attempt: 2,
    analysisSummary: 'Redirect lands on /login even when auth succeeds.',
    probableCause: 'Session redirect helper may drop the original destination.',
    relevantMemories: [
      {
        kind: 'verify-failure',
        summary: 'Avoid touching the token parser again.',
        detail: 'Previous attempt changed token parsing without fixing the redirect.',
        files: ['src/auth/token.ts'],
        commands: ['pnpm test -- auth'],
      },
    ],
  };
}

describe('ReadOnlyPlanAgent', () => {
  it('builds a read-only plan with critical files and checklist', () => {
    const plan = new ReadOnlyPlanAgent().plan(makeContext());

    expect(plan.readOnly).toBe(true);
    expect(plan.criticalFiles).toEqual([
      'src/login.ts',
      'tests/login.spec.ts',
      'src/auth/token.ts',
    ]);
    expect(plan.checklist).toEqual([
      'Inspect the critical files before editing anything.',
      'Make the smallest change that fixes the goal without violating constraints.',
      'Make this attempt materially different from the recorded failed approaches before broadening scope.',
      'Run verification in the declared order and compare against prior failures.',
    ]);
    expect(plan.retryStrategy).toEqual([
      'Use the recorded failure memories to choose a different edit direction than the previous attempts.',
      'Optimize specifically for the declared verification path: pnpm test -- login.',
    ]);
    expect(plan.summary).toContain('Likely files: src/login.ts, tests/login.spec.ts, src/auth/token.ts.');
  });

  it('derives a retry strategy from compacted failure history', () => {
    const context = makeContext();
    context.relevantMemories = [
      {
        kind: 'retry-decision',
        summary: 'auto compact carry-over after attempt 2',
        detail: [
          'Compacted repair context for goal: Fix the login redirect after authentication.',
          'Recent attempts: attempt 1 verdict=retry files=src/login.ts note=redirect still loops | attempt 2 verdict=retry files=src/login.ts, tests/login.spec.ts note=still failing after helper-only edit',
          'Use this compact history instead of re-reading earlier verbose outputs.',
        ].join('\n'),
        files: ['src/login.ts', 'tests/login.spec.ts'],
        commands: ['pnpm test -- login'],
      },
    ];

    const plan = new ReadOnlyPlanAgent().plan(context);

    expect(plan.retryStrategy).toContain('Base this attempt on the compacted carry-over history instead of replaying the earlier verbose failure logs.');
    expect(plan.retryStrategy).toContain('Previous failures repeatedly touched: src/login.ts. Do not repeat the same narrow edit limited to those files.');
    expect(plan.retryStrategy).toContain('Widen inspection to adjacent targets that were not consistently changed in failed attempts: tests/login.spec.ts.');
    expect(plan.retryStrategy).toContain('Avoid another helper-only style edit that leaves the observable failing behavior unchanged.');
    expect(plan.summary).toContain('Retry strategy:');
  });

  it('flags repeated failure signals and no-op attempts in compacted history', () => {
    const context = makeContext();
    context.relevantMemories = [
      {
        kind: 'retry-decision',
        summary: 'auto compact carry-over after attempt 3',
        detail: [
          'Compacted repair context for goal: Fix the login redirect after authentication.',
          'Recent attempts: attempt 1 verdict=retry files=none note=$ pnpm test -- login FAIL redirect still loops | attempt 2 verdict=retry files=src/login.ts note=$ pnpm test -- login FAIL redirect still loops',
          'Use this compact history instead of re-reading earlier verbose outputs.',
        ].join('\n'),
        files: ['src/login.ts'],
        commands: ['pnpm test -- login'],
      },
    ];

    const plan = new ReadOnlyPlanAgent().plan(context);

    expect(plan.retryStrategy).toContain('At least one failed attempt produced no persisted file changes. Ensure the next attempt lands a concrete diff in the intended scope before another verify run.');
    expect(plan.retryStrategy).toContain('Repeated failing verification signal: "$ pnpm test -- login FAIL redirect still loops". Make the next edit prove that this exact signal disappears.');
  });
});

describe('VerificationAgent', () => {
  it('returns retry when verification fails and includes adversarial checks', () => {
    const context = makeContext();
    const plan = new ReadOnlyPlanAgent().plan(context);
    const assessment = new VerificationAgent().assess({
      context,
      plan,
      rawOutput: 'Updated redirect helper and test.',
      verifyPassed: false,
      verifyOutput: '$ pnpm test -- login\nFAIL login redirect still loops\n',
      changedFiles: ['src/login.ts'],
    });

    expect(assessment.verdict).toBe('retry');
    expect(assessment.retryPrompt).toContain('Verification Output:');
    expect(assessment.adversarialChecks).toContain('Re-run declared verification commands and inspect failures: pnpm test -- login.');
    expect(assessment.summary).toContain('System verification failed');
  });

  it('requests manual review when verification passes but changes escape the declared scope', () => {
    const context = makeContext();
    const plan = new ReadOnlyPlanAgent().plan(context);
    const assessment = new VerificationAgent().assess({
      context,
      plan,
      rawOutput: 'Changed login redirect and an unrelated script.',
      verifyPassed: true,
      verifyOutput: '$ pnpm test -- login\nPASS\n',
      changedFiles: ['src/login.ts', 'scripts/release.ts'],
    });

    expect(assessment.verdict).toBe('review');
    expect(assessment.summary).toContain('out-of-scope file changes');
  });
});

describe('CodeRepairPromptBuilder', () => {
  it('renders critical files, checklist, and retry strategy as explicit apply sections', () => {
    const context = makeContext();
    const plan = new ReadOnlyPlanAgent().plan(context);

    const prompt = new CodeRepairPromptBuilder().buildApplyPrompt(context, plan).prompt;

    expect(prompt).toContain('Plan:');
    expect(prompt).toContain('Critical Files:');
    expect(prompt).toContain('Checklist:');
    expect(prompt).toContain('Retry Strategy:');
    expect(prompt).toContain('src/login.ts');
    expect(prompt).toContain('Use the recorded failure memories to choose a different edit direction than the previous attempts.');
  });
});

describe('ToolExecutionPlanner', () => {
  it('applies concurrent read context modifiers in call order, not completion order', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1_000 });
    registry.register('read.slow', {
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'slow';
      },
      isReadOnly: true,
      isConcurrencySafe: true,
      modifyContext: (context: { values: string[] }, result) => ({
        values: [...context.values, result.value as string],
      }),
    });
    registry.register('read.fast', {
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return 'fast';
      },
      isReadOnly: true,
      isConcurrencySafe: true,
      modifyContext: (context: { values: string[] }, result) => ({
        values: [...context.values, result.value as string],
      }),
    });

    const planner = new ToolExecutionPlanner(registry);
    const executed = await planner.execute([
      { toolName: 'read.slow', input: {} },
      { toolName: 'read.fast', input: {} },
    ], { sessionId: 's1', stepIndex: 0 }, { values: [] });

    expect(executed.context.values).toEqual(['slow', 'fast']);
  });
});

describe('CodeTaskMemory', () => {
  it('prioritizes memories that overlap with scope paths and verification commands', () => {
    const db = makeDb();
    seedRun(db);
    const repo = new CodeTaskRepository(db);
    repo.create({
      taskId: 'old-unrelated',
      runId: 'r1',
      testcaseId: 'tc-1',
      workspacePath: '/ws',
      goal: 'old unrelated task',
      createdAt: new Date().toISOString(),
    });
    repo.create({
      taskId: 'old-relevant',
      runId: 'r1',
      testcaseId: 'tc-1',
      workspacePath: '/ws',
      goal: 'old relevant task',
      createdAt: new Date().toISOString(),
    });
    const memory = new CodeTaskMemory(db);

    memory.recordFailure({
      runId: 'r1',
      taskId: 'old-unrelated',
      testcaseId: 'tc-1',
      attempt: 1,
      kind: 'verify-failure',
      summary: 'Release script change still failed.',
      detail: 'Touched release packaging only.',
      files: ['scripts/release.ts'],
      commands: ['pnpm build'],
    });
    memory.recordFailure({
      runId: 'r1',
      taskId: 'old-relevant',
      testcaseId: 'tc-1',
      attempt: 1,
      kind: 'verify-failure',
      summary: 'Login redirect kept looping after auth.',
      detail: 'Changing the redirect helper without updating the login spec did not work.',
      files: ['src/login.ts', 'tests/login.spec.ts'],
      commands: ['pnpm test -- login'],
    });

    const selected = memory.selectRelevantMemories({
      runId: 'r1',
      taskId: 'task-1',
      testcaseId: 'tc-1',
      goal: 'Fix regression.',
      scopePaths: ['src/login.ts'],
      verificationCommands: ['pnpm test -- login'],
      limit: 2,
    });

    expect(selected[0]?.taskId).toBe('old-relevant');
    expect(selected[1]?.taskId).toBe('old-unrelated');
  });
});

describe('CodeRepairAgent', () => {
  it('returns an explicit task ledger and verification review after apply', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'FakeTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    const transport: CodeRepairTransport = {
      name: 'FakeTransport',
      run: async () => ({
        rawOutput: 'Updated src/login.ts and tests/login.spec.ts',
        exitCode: 0,
      }),
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const execution = await agent.execute({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
    });

    expect(execution.plan.summary).toContain('Likely files');
    expect(execution.taskLedger.find((item) => item.id === 'verify')?.status).toBe('pending');

    const verification = agent.reviewVerification({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      plan: execution.plan,
      rawOutput: execution.rawOutput,
      verifyPassed: false,
      verifyOutput: '$ pnpm test -- login\nFAIL redirect still loops\n',
      changedFiles: ['src/login.ts'],
      relevantMemories: execution.relevantMemories,
      taskLedger: execution.taskLedger,
    });

    expect(verification.verdict).toBe('retry');
    expect(verification.taskLedger.find((item) => item.id === 'verify')?.status).toBe('failed');
    expect(verification.taskLedger.find((item) => item.id === 'retry-decision')?.status).toBe('completed');
    expect(verification.retryPrompt).toContain('retry strategy');
  });

  it('retries after verification failure and settles successfully within the attempt budget', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'RetryTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    let transportCalls = 0;
    const transport: CodeRepairTransport = {
      name: 'RetryTransport',
      run: async () => {
        transportCalls += 1;
        return {
          rawOutput: transportCalls === 1
            ? 'Attempt 1 updated redirect helper but left a loop.'
            : 'Attempt 2 updated redirect helper and stabilized the test.',
          exitCode: 0,
        };
      },
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    let verifyCalls = 0;
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 3,
      verify: async ({ attemptNumber, execution }) => {
        verifyCalls += 1;
        return {
          diffPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.diff`,
          patchPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.patch`,
          verifyPath: `code-tasks/${task.task_id}/verify-${String(attemptNumber)}.txt`,
          rawOutputPath: `code-tasks/${task.task_id}/raw-output-${String(attemptNumber)}.txt`,
          verifyOutput: attemptNumber === 1
            ? '$ pnpm test -- login\nFAIL redirect still loops\n'
            : '$ pnpm test -- login\nPASS\n',
          verifyPassed: attemptNumber === 2,
          changedFiles: ['src/login.ts'],
        };
      },
    });

    expect(loop.finalStatus).toBe('SUCCEEDED');
    expect(loop.attempts).toHaveLength(2);
    expect(transportCalls).toBe(2);
    expect(verifyCalls).toBe(2);
    expect(loop.finalVerification?.verdict).toBe('pass');
    expect(loop.attempts[0]?.verification?.verdict).toBe('retry');

    const memories = new CodeTaskMemoryRepository(db).listByTask(task.task_id);
    expect(memories.some((item) => item.kind === 'verify-failure')).toBe(true);
    expect(memories.some((item) => item.kind === 'retry-decision')).toBe(true);
  });

  it('stops retrying after the max attempt budget is exhausted', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'RetryTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    let transportCalls = 0;
    const transport: CodeRepairTransport = {
      name: 'RetryTransport',
      run: async () => {
        transportCalls += 1;
        return {
          rawOutput: `Attempt ${String(transportCalls)} still failed verification.`,
          exitCode: 0,
        };
      },
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 2,
      verify: async ({ attemptNumber }) => ({
        diffPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.diff`,
        patchPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.patch`,
        verifyPath: `code-tasks/${task.task_id}/verify-${String(attemptNumber)}.txt`,
        rawOutputPath: `code-tasks/${task.task_id}/raw-output-${String(attemptNumber)}.txt`,
        verifyOutput: '$ pnpm test -- login\nFAIL redirect still loops\n',
        verifyPassed: false,
        changedFiles: ['src/login.ts'],
      }),
    });

    expect(loop.finalStatus).toBe('FAILED');
    expect(loop.attempts).toHaveLength(2);
    expect(transportCalls).toBe(2);
    expect(loop.finalVerification?.verdict).toBe('retry');
    expect(loop.finalVerification?.taskLedger.find((item) => item.id === 'retry-decision')?.summary).toContain('attempt budget was exhausted');
    expect(loop.summary).toContain('Attempt budget exhausted');
  });

  it('stops early when consecutive failed retries show no verification progress', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'RetryTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    let transportCalls = 0;
    const transport: CodeRepairTransport = {
      name: 'RetryTransport',
      run: async () => {
        transportCalls += 1;
        return {
          rawOutput: `Attempt ${String(transportCalls)} touched src/login.ts but the failure persisted.`,
          exitCode: 0,
        };
      },
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 4,
      verify: async ({ attemptNumber }) => ({
        diffPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.diff`,
        patchPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.patch`,
        verifyPath: `code-tasks/${task.task_id}/verify-${String(attemptNumber)}.txt`,
        rawOutputPath: `code-tasks/${task.task_id}/raw-output-${String(attemptNumber)}.txt`,
        verifyOutput: '$ pnpm test -- login\nFAIL redirect still loops\n',
        verifyPassed: false,
        changedFiles: ['src/login.ts'],
      }),
    });

    expect(loop.finalStatus).toBe('FAILED');
    expect(loop.stopReason).toBe('no_progress');
    expect(loop.attempts).toHaveLength(2);
    expect(transportCalls).toBe(2);
    expect(loop.finalVerification?.taskLedger.find((item) => item.id === 'retry-decision')?.summary).toContain('withheld');
    expect(loop.summary).toContain('No progress detected');

    const memories = new CodeTaskMemoryRepository(db).listByTask(task.task_id);
    const retryDecision = memories.find((item) => item.kind === 'retry-decision' && item.summary.includes('no progress was detected'));
    expect(retryDecision?.summary).toContain('no progress was detected');
  });

  it('treats repeated failure signals as no progress even when verify logs contain different noise', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'RetryTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    let transportCalls = 0;
    const transport: CodeRepairTransport = {
      name: 'RetryTransport',
      run: async () => {
        transportCalls += 1;
        return {
          rawOutput: `Attempt ${String(transportCalls)} touched src/login.ts but the redirect bug persisted.`,
          exitCode: 0,
        };
      },
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 4,
      verify: async ({ attemptNumber }) => ({
        diffPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.diff`,
        patchPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.patch`,
        verifyPath: `code-tasks/${task.task_id}/verify-${String(attemptNumber)}.txt`,
        rawOutputPath: `code-tasks/${task.task_id}/raw-output-${String(attemptNumber)}.txt`,
        verifyOutput: attemptNumber === 1
          ? '$ pnpm test -- login\nstdout: completed in 320ms\nFAIL redirect still loops\n'
          : '$ pnpm test -- login\nstdout: completed in 451ms\nstderr: extra trace noise\nFAIL redirect still loops\nstack: line 17\n',
        verifyPassed: false,
        changedFiles: ['src/login.ts'],
      }),
    });

    expect(loop.finalStatus).toBe('FAILED');
    expect(loop.stopReason).toBe('no_progress');
    expect(transportCalls).toBe(2);
    expect(loop.summary).toContain('No progress detected');
  });

  it('stops retrying when the token budget is exhausted', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'BudgetTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    let transportCalls = 0;
    const transport: CodeRepairTransport = {
      name: 'BudgetTransport',
      run: async () => {
        transportCalls += 1;
        return {
          rawOutput: `Attempt ${String(transportCalls)} ${'x'.repeat(2_400)}`,
          exitCode: 0,
        };
      },
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 4,
      tokenBudget: 300,
      enableAutoCompact: false,
      verify: async ({ attemptNumber }) => ({
        diffPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.diff`,
        patchPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.patch`,
        verifyPath: `code-tasks/${task.task_id}/verify-${String(attemptNumber)}.txt`,
        rawOutputPath: `code-tasks/${task.task_id}/raw-output-${String(attemptNumber)}.txt`,
        verifyOutput: '$ pnpm test -- login\nFAIL redirect still loops\n',
        verifyPassed: false,
        changedFiles: ['src/login.ts'],
      }),
    });

    expect(loop.finalStatus).toBe('FAILED');
    expect(loop.stopReason).toBe('token_budget_exhausted');
    expect(loop.attempts).toHaveLength(1);
    expect(transportCalls).toBe(1);
    expect(loop.budget.tokenBudget).toBe(300);
    expect(loop.budget.maxCompactions).toBe(1);
    expect(loop.budget.usedTokens).toBeGreaterThan(300);
    expect(loop.finalVerification?.taskLedger.find((item) => item.id === 'retry-decision')?.summary).toContain('token budget was exhausted');

    const memories = new CodeTaskMemoryRepository(db).listByTask(task.task_id);
    const retryDecision = memories.find((item) => item.kind === 'retry-decision');
    expect(retryDecision?.summary).toContain('token budget was exhausted');
  });

  it('auto compacts retry context before exhausting the token budget', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'CompactTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    let transportCalls = 0;
    const prompts: string[] = [];
    const verboseChunk = 'VERBOSE_TRACE_CHUNK_1234567890 ';
    const transport: CodeRepairTransport = {
      name: 'CompactTransport',
      run: async ({ prompt }) => {
        transportCalls += 1;
        prompts.push(prompt);
        return {
          rawOutput: `Attempt ${String(transportCalls)} ${'history '.repeat(240)}`,
          exitCode: 0,
        };
      },
    };

    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 3,
      tokenBudget: 500,
      maxCompactions: 2,
      verify: async ({ attemptNumber }) => ({
        diffPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.diff`,
        patchPath: `code-tasks/${task.task_id}/changes-${String(attemptNumber)}.patch`,
        verifyPath: `code-tasks/${task.task_id}/verify-${String(attemptNumber)}.txt`,
        rawOutputPath: `code-tasks/${task.task_id}/raw-output-${String(attemptNumber)}.txt`,
        verifyOutput: attemptNumber === 1
          ? `${'$ pnpm test -- login\\nFAIL redirect still loops\\n'}${verboseChunk.repeat(80)}`
          : '$ pnpm test -- login\nPASS\n',
        verifyPassed: attemptNumber === 2,
        changedFiles: ['src/login.ts'],
      }),
    });

    expect(loop.finalStatus).toBe('SUCCEEDED');
    expect(loop.budget.compactionsUsed).toBe(1);
    expect(loop.budget.maxCompactions).toBe(2);
    expect(transportCalls).toBe(2);
    expect(prompts[1]).toContain('Compacted repair context for goal');
    expect(prompts[1]).toContain('Use this compact history instead of re-reading earlier verbose outputs.');
    expect(prompts[1]).toContain('Previous failed attempt focused on: src/login.ts.');
    expect(prompts[1]).toContain('Widen inspection to adjacent targets that were not consistently changed in failed attempts: tests/login.spec.ts.');
    expect(prompts[1]).not.toContain(verboseChunk.repeat(12));

    const memories = new CodeTaskMemoryRepository(db).listByTask(task.task_id);
    const compactMemory = memories.find((item) => item.kind === 'retry-decision' && item.summary.includes('auto compact'));
    expect(compactMemory?.detail).toContain('Compacted repair context');
  });

  it('runs stop hooks with the final result and budget snapshot', async () => {
    const db = makeDb();
    seedRun(db);
    const task = seedTask(db);
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: task.run_id,
      taskId: task.task_id,
      kind: 'code-repair',
      agentName: 'HookTransport',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });

    const transport: CodeRepairTransport = {
      name: 'HookTransport',
      run: async () => ({
        rawOutput: 'Applied a minimal redirect fix.',
        exitCode: 0,
      }),
    };
    const stopHook = vi.fn();
    const agent = new CodeRepairAgent(db, transport, sessionManager);
    const loop = await agent.executeUntilSettled({
      task,
      sessionId: session.session_id,
      dataRoot: dir,
      maxAttempts: 2,
      tokenBudget: 800,
      stopHooks: [stopHook],
      verify: async () => ({
        diffPath: `code-tasks/${task.task_id}/changes.diff`,
        patchPath: `code-tasks/${task.task_id}/changes.patch`,
        verifyPath: `code-tasks/${task.task_id}/verify.txt`,
        rawOutputPath: `code-tasks/${task.task_id}/raw-output.txt`,
        verifyOutput: '$ pnpm test -- login\nPASS\n',
        verifyPassed: true,
        changedFiles: ['src/login.ts'],
      }),
    });

    expect(loop.finalStatus).toBe('SUCCEEDED');
    expect(stopHook).toHaveBeenCalledTimes(1);
    expect(stopHook.mock.calls[0]?.[0].result.stopReason).toBe('succeeded');
    expect(stopHook.mock.calls[0]?.[0].budget.attemptsUsed).toBe(1);
    expect(stopHook.mock.calls[0]?.[0].budget.tokenBudget).toBe(800);
    expect(stopHook.mock.calls[0]?.[0].budget.compactionsUsed).toBe(0);
    expect(stopHook.mock.calls[0]?.[0].budget.maxCompactions).toBe(1);
  });
});
