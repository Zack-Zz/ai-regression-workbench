import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { openDb, runMigrations, RunRepository, CodeTaskRepository } from '@zarb/storage';
import { HarnessSessionManager, ToolRegistry, ArtifactWriter, DEFAULT_EXPLORATION_POLICY, DEFAULT_CODE_REPAIR_POLICY } from '../src/runtime/index.js';
import { ToolExecutionPlanner } from '../src/runtime/tool-execution-planner.js';
import { CodeRepairAgent } from '../src/code-repair/code-repair-agent.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-harness-test-${String(Date.now())}`);
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

// ---------------------------------------------------------------------------
// HarnessPolicy defaults
// ---------------------------------------------------------------------------

describe('HarnessPolicy defaults', () => {
  it('exploration policy disallows write scopes by default', () => {
    expect(DEFAULT_EXPLORATION_POLICY.allowedWriteScopes).toHaveLength(0);
    expect(DEFAULT_EXPLORATION_POLICY.requireApprovalFor).toContain('fs.write');
    expect(DEFAULT_EXPLORATION_POLICY.reviewOnVerifyFailureAllowed).toBe(false);
  });

  it('code-repair policy allows reviewOnVerifyFailure', () => {
    expect(DEFAULT_CODE_REPAIR_POLICY.reviewOnVerifyFailureAllowed).toBe(true);
    expect(DEFAULT_CODE_REPAIR_POLICY.requireApprovalFor).toContain('git.commit');
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

describe('ToolRegistry', () => {
  it('calls a registered tool and returns result', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000 });
    registry.register('echo', (input) => Promise.resolve(input));
    const result = await registry.call('echo', { msg: 'hi' }, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ msg: 'hi' });
    expect(result.record.status).toBe('ok');
  });

  it('returns error for unregistered tool', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000 });
    const result = await registry.call('unknown', {}, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('error');
  });

  it('denies tool requiring approval when no approvalId provided', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: ['shell.exec'], toolCallTimeoutMs: 1000 });
    registry.register('shell.exec', () => Promise.resolve('output'));
    const result = await registry.call('shell.exec', {}, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('denied');
  });

  it('allows tool requiring approval when approvalId provided', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: ['shell.exec'], toolCallTimeoutMs: 1000 });
    registry.register('shell.exec', () => Promise.resolve('output'));
    const result = await registry.call('shell.exec', {}, { sessionId: 's1', stepIndex: 0, approvalId: 'ap1' });
    expect(result.ok).toBe(true);
    expect(result.record.approvalId).toBe('ap1');
  });

  it('times out slow tools', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 10 });
    registry.register('slow', () => new Promise((resolve) => setTimeout(resolve, 500)));
    const result = await registry.call('slow', {}, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('timeout');
  });

  it('accumulates call log', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000 });
    registry.register('noop', () => Promise.resolve(null));
    await registry.call('noop', {}, { sessionId: 's1', stepIndex: 0 });
    await registry.call('noop', {}, { sessionId: 's1', stepIndex: 1 });
    expect(registry.getCallLog()).toHaveLength(2);
  });

  it('supports structured descriptors and context modification', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000 });
    registry.register('memory.lookup', {
      handler: async () => ['m1', 'm2'],
      isReadOnly: true,
      isConcurrencySafe: true,
      summarizeResult: (value) => `${String((value as string[]).length)} memories`,
      modifyContext: (context: { items: string[] }, result) => ({
        ...context,
        items: result.value as string[],
      }),
    });
    const result = await registry.call<string[]>('memory.lookup', {}, { sessionId: 's1', stepIndex: 0 });
    expect(result.record.resultSummary).toBe('2 memories');
    expect(registry.getContextModifier<{ items: string[] }>('memory.lookup')).toBeTypeOf('function');
  });
});

describe('ToolExecutionPlanner', () => {
  it('batches read-only concurrency-safe tools and applies context modifiers', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000 });
    registry.register('read.a', {
      handler: async () => 'A',
      isReadOnly: true,
      isConcurrencySafe: true,
      modifyContext: (context: { values: string[] }, result) => ({
        values: [...context.values, result.value as string],
      }),
    });
    registry.register('write.b', {
      handler: async () => 'B',
      isReadOnly: false,
      isConcurrencySafe: false,
      modifyContext: (context: { values: string[] }, result) => ({
        values: [...context.values, result.value as string],
      }),
    });

    const planner = new ToolExecutionPlanner(registry);
    const executed = await planner.execute([
      { toolName: 'read.a', input: {} },
      { toolName: 'write.b', input: {} },
    ], { sessionId: 's1', stepIndex: 0 }, { values: [] });

    expect(executed.results).toHaveLength(2);
    expect(executed.context.values).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// HarnessSessionManager
// ---------------------------------------------------------------------------

describe('HarnessSessionManager.startSession', () => {
  it('creates session in running status', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({
      runId: 'r1', kind: 'exploration', agentName: 'explorer',
      policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir,
    });
    expect(session.status).toBe('running');
    expect(session.agent_name).toBe('explorer');
    expect(session.policy_json).toBeTruthy();
  });

  it('persists contextRefs to disk', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({
      runId: 'r1', kind: 'exploration', agentName: 'explorer',
      policy: DEFAULT_EXPLORATION_POLICY,
      contextRefs: { runId: 'r1', failedTestcases: ['tc1'] },
      dataRoot: dir,
    });
    const absPath = join(dir, 'agent-traces', session.session_id, 'context-summary.json');
    expect(existsSync(absPath)).toBe(true);
    const content = JSON.parse(readFileSync(absPath, 'utf8')) as { contextRefs: unknown };
    expect(content.contextRefs).toEqual({ runId: 'r1', failedTestcases: ['tc1'] });
  });

  it('stores contextRefsJson in DB', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({
      runId: 'r1', kind: 'exploration', agentName: 'explorer',
      policy: DEFAULT_EXPLORATION_POLICY,
      contextRefs: { key: 'val' },
      dataRoot: dir,
    });
    expect(session.context_refs_json).toContain('"key"');
  });
});

describe('HarnessSessionManager pause/resume/cancel', () => {
  it('commitPause transitions to paused and persists checkpoint', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    const paused = mgr.commitPause(session.session_id, { checkpointId: 'ckpt1', stepIndex: 3, timestamp: new Date().toISOString() }, dir);
    expect(paused.status).toBe('paused');
    expect(paused.checkpoint_id).toBe('ckpt1');
    const stepsPath = join(dir, 'agent-traces', session.session_id, 'steps.jsonl');
    expect(existsSync(stepsPath)).toBe(true);
  });

  it('commitPause throws when session not running', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    mgr.cancelSession(session.session_id);
    expect(() => mgr.commitPause(session.session_id, { checkpointId: 'c', stepIndex: 0, timestamp: new Date().toISOString() }, dir)).toThrow(/not running/);
  });

  it('resumeSession restores to running', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    mgr.commitPause(session.session_id, { checkpointId: 'c', stepIndex: 1, timestamp: new Date().toISOString() }, dir);
    expect(mgr.resumeSession(session.session_id).status).toBe('running');
  });

  it('resumeSession throws when not paused', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    expect(() => mgr.resumeSession(session.session_id)).toThrow(/not paused/);
  });

  it('cancelSession sets status to cancelled', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    expect(mgr.cancelSession(session.session_id).status).toBe('cancelled');
  });

  it('cancelSession throws when already terminal', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    mgr.cancelSession(session.session_id);
    expect(() => mgr.cancelSession(session.session_id)).toThrow(/terminal/);
  });
});

describe('HarnessSessionManager trace appending', () => {
  it('appendStep writes to steps.jsonl', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    mgr.appendStep(session.session_id, { stepIndex: 0, description: 'navigate', outcome: 'ok', timestamp: new Date().toISOString() }, dir);
    const content = readFileSync(join(dir, 'agent-traces', session.session_id, 'steps.jsonl'), 'utf8');
    expect(content).toContain('navigate');
  });

  it('appendToolCall writes to tool-calls.jsonl', async () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000 });
    registry.register('noop', () => Promise.resolve(null));
    const result = await registry.call('noop', {}, { sessionId: session.session_id, stepIndex: 0 });
    mgr.appendToolCall(session.session_id, result.record, dir);
    const content = readFileSync(join(dir, 'agent-traces', session.session_id, 'tool-calls.jsonl'), 'utf8');
    expect(content).toContain('noop');
  });

  it('appendPromptSample writes to prompt-samples.jsonl', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    mgr.appendPromptSample(session.session_id, {
      sessionId: session.session_id,
      stepIndex: 0,
      timestamp: new Date().toISOString(),
      phase: 'exploration-decision',
      templateVersion: 'exploration-decision/default@v1',
      prompt: 'prompt body',
      response: '{"action":"done"}',
      sampledBy: 'first-step',
    }, dir);
    const content = readFileSync(join(dir, 'agent-traces', session.session_id, 'prompt-samples.jsonl'), 'utf8');
    expect(content).toContain('prompt body');
    expect(content).toContain('exploration-decision');
  });
});

describe('HarnessSessionManager.completeSession', () => {
  it('sets status to completed with summary', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'code-repair', agentName: 'coder', policy: DEFAULT_CODE_REPAIR_POLICY, dataRoot: dir });
    const done = mgr.completeSession(session.session_id, 'fixed 2 issues');
    expect(done.status).toBe('completed');
    expect(done.summary).toBe('fixed 2 issues');
    expect(done.ended_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ArtifactWriter
// ---------------------------------------------------------------------------

describe('ArtifactWriter', () => {
  it('writes diff to correct relative path', () => {
    const writer = new ArtifactWriter(dir);
    const relPath = writer.writeDiff('t1', 'diff content');
    expect(relPath).toBe('code-tasks/t1/changes.diff');
    expect(existsSync(join(dir, relPath))).toBe(true);
    expect(readFileSync(join(dir, relPath), 'utf8')).toBe('diff content');
  });

  it('writes patch', () => {
    const writer = new ArtifactWriter(dir);
    const relPath = writer.writePatch('t1', 'patch content');
    expect(relPath).toBe('code-tasks/t1/changes.patch');
    expect(existsSync(join(dir, relPath))).toBe(true);
  });

  it('writes verify output', () => {
    const writer = new ArtifactWriter(dir);
    const relPath = writer.writeVerifyOutput('t1', 'all tests passed');
    expect(relPath).toBe('code-tasks/t1/verify.txt');
    expect(readFileSync(join(dir, relPath), 'utf8')).toBe('all tests passed');
  });

  it('writes raw output', () => {
    const writer = new ArtifactWriter(dir);
    const relPath = writer.writeRawOutput('t1', 'agent raw output');
    expect(relPath).toBe('code-tasks/t1/raw-output.txt');
    expect(existsSync(join(dir, relPath))).toBe(true);
  });

  it('writes code task artifacts under a configured codeTaskRoot', () => {
    const codeTaskRoot = join(dir, 'custom-code-tasks');
    const writer = new ArtifactWriter(dir, undefined, codeTaskRoot);
    const relPath = writer.writeDiff('t9', 'custom diff');
    expect(relPath).toBe('custom-code-tasks/t9/changes.diff');
    expect(existsSync(join(dir, relPath))).toBe(true);
    expect(readFileSync(join(dir, relPath), 'utf8')).toBe('custom diff');
  });

  it('generateArtifacts: diff and patch both reflect current workspace changes', () => {
    // Set up a minimal git repo with an uncommitted change
    const ws = join(dir, 'ws');
    mkdirSync(ws, { recursive: true });
    execSync('git init', { cwd: ws });
    execSync('git config user.email "test@test.com"', { cwd: ws });
    execSync('git config user.name "Test"', { cwd: ws });
    writeFileSync(join(ws, 'foo.ts'), 'const x = 1;\n');
    execSync('git add .', { cwd: ws });
    execSync('git commit -m "init"', { cwd: ws });
    // Make an uncommitted change
    writeFileSync(join(ws, 'foo.ts'), 'const x = 2;\n');

    const db = makeDb(); seedRun(db);
    new CodeTaskRepository(db).create({ taskId: 'task1', runId: 'r1', workspacePath: ws, goal: 'fix', createdAt: new Date().toISOString() });

    const writer = new ArtifactWriter(dir, db);
    const result = writer.generateArtifacts({ taskId: 'task1', sessionId: 'sess1', workspacePath: ws, verificationCommands: [] });

    const diffContent = readFileSync(join(dir, result.diffPath), 'utf8');
    const patchContent = readFileSync(join(dir, result.patchPath), 'utf8');
    // Both should contain the workspace change and be identical (same git diff HEAD source)
    expect(diffContent).toContain('x = 2');
    expect(patchContent).toBe(diffContent);
  });

  it('generateArtifacts: newly created untracked files appear in changedFiles and diff', () => {
    const ws = join(dir, 'ws2');
    mkdirSync(ws, { recursive: true });
    execSync('git init', { cwd: ws });
    execSync('git config user.email "test@test.com"', { cwd: ws });
    execSync('git config user.name "Test"', { cwd: ws });
    writeFileSync(join(ws, 'existing.ts'), 'const a = 1;\n');
    execSync('git add .', { cwd: ws });
    execSync('git commit -m "init"', { cwd: ws });
    // Create a new untracked file (not staged)
    writeFileSync(join(ws, 'new-file.ts'), 'export const b = 2;\n');

    const db = makeDb(); seedRun(db);
    new CodeTaskRepository(db).create({ taskId: 'task2', runId: 'r1', workspacePath: ws, goal: 'fix', createdAt: new Date().toISOString() });

    const writer = new ArtifactWriter(dir, db);
    const result = writer.generateArtifacts({ taskId: 'task2', sessionId: 'sess2', workspacePath: ws, verificationCommands: [] });

    expect(result.changedFiles).toContain('new-file.ts');
    const diffContent = readFileSync(join(dir, result.diffPath), 'utf8');
    expect(diffContent).toContain('new-file.ts');
  });

  it('generateArtifacts: does not destroy pre-existing staged changes', () => {
    const ws = join(dir, 'ws3');
    mkdirSync(ws, { recursive: true });
    execSync('git init', { cwd: ws });
    execSync('git config user.email "test@test.com"', { cwd: ws });
    execSync('git config user.name "Test"', { cwd: ws });
    writeFileSync(join(ws, 'staged.ts'), 'const x = 1;\n');
    execSync('git add .', { cwd: ws });
    execSync('git commit -m "init"', { cwd: ws });
    // Stage a modification
    writeFileSync(join(ws, 'staged.ts'), 'const x = 99;\n');
    execSync('git add staged.ts', { cwd: ws });
    // Also create an untracked file
    writeFileSync(join(ws, 'untracked.ts'), 'export const y = 3;\n');

    const db = makeDb(); seedRun(db);
    new CodeTaskRepository(db).create({ taskId: 'task3', runId: 'r1', workspacePath: ws, goal: 'fix', createdAt: new Date().toISOString() });

    const writer = new ArtifactWriter(dir, db);
    writer.generateArtifacts({ taskId: 'task3', sessionId: 'sess3', workspacePath: ws, verificationCommands: [] });

    // Staged change must still be staged after artifact generation
    const stagedAfter = execSync('git diff --cached --name-only', { cwd: ws, encoding: 'utf8' }).trim();
    expect(stagedAfter).toContain('staged.ts');
  });
});

describe('CodeRepairAgent', () => {
  it('assembles staged prompts, runs transport, and records prompt samples', async () => {
    const db = makeDb();
    seedRun(db, 'r-code-repair');
    new CodeTaskRepository(db).create({
      taskId: 'task-code-repair',
      runId: 'r-code-repair',
      workspacePath: '/ws',
      goal: 'fix flaky test',
      scopePathsJson: JSON.stringify(['apps/cli/src/services/code-task-service.ts']),
      verificationCommandsJson: JSON.stringify(['pnpm test']),
      createdAt: new Date().toISOString(),
    });
    const task = new CodeTaskRepository(db).findById('task-code-repair');
    expect(task).toBeTruthy();
    const sessionManager = new HarnessSessionManager(db);
    const session = sessionManager.startSession({
      runId: 'r-code-repair',
      taskId: 'task-code-repair',
      kind: 'code-repair',
      agentName: 'CodeRepairAgent',
      policy: DEFAULT_CODE_REPAIR_POLICY,
      dataRoot: dir,
    });
    const transport = {
      name: 'MockTransport',
      run: async () => ({ rawOutput: 'patched file successfully', exitCode: 0 }),
    };
    const agent = new CodeRepairAgent(db, transport, sessionManager);

    const result = await agent.execute({
      task: task!,
      sessionId: session.session_id,
      dataRoot: dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.planSummary).toContain('Read-only plan for task task-code-repair');
    expect(result.taskLedger.find((item) => item.id === 'apply')?.status).toBe('completed');
    const promptSamples = readFileSync(join(dir, 'agent-traces', session.session_id, 'prompt-samples.jsonl'), 'utf8');
    expect(promptSamples).toContain('code-repair-plan');
    expect(promptSamples).toContain('code-repair-apply');
    expect(promptSamples).toContain('code-repair-verify');
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry — host and write scope enforcement
// ---------------------------------------------------------------------------

describe('ToolRegistry policy enforcement', () => {
  it('denies playwright tool when host not in allowedHosts', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000, allowedHosts: ['example.com'] });
    registry.register('playwright.goto', (input) => Promise.resolve(input));
    const result = await registry.call('playwright.goto', { url: 'https://evil.com/page' }, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('denied');
    expect(result.error).toContain('allowedHosts');
  });

  it('allows playwright tool when host is in allowedHosts', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000, allowedHosts: ['example.com'] });
    registry.register('playwright.goto', (input) => Promise.resolve(input));
    const result = await registry.call('playwright.goto', { url: 'https://example.com/page' }, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(true);
  });

  it('denies fs.write when allowedWriteScopes is empty (exploration default = read-only)', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000, allowedWriteScopes: [] });
    registry.register('fs.write', (input) => Promise.resolve(input));
    const result = await registry.call('fs.write', { path: '/any/path' }, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('denied');
  });

  it('denies fs.write when path not in allowedWriteScopes', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000, allowedWriteScopes: ['/workspace/tests/'] });
    registry.register('fs.write', (input) => Promise.resolve(input));
    const result = await registry.call('fs.write', { path: '/etc/passwd' }, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('denied');
    expect(result.error).toContain('allowedWriteScopes');
  });

  it('allows fs.write when path is within allowedWriteScopes', async () => {
    const registry = new ToolRegistry({ requireApprovalFor: [], toolCallTimeoutMs: 1000, allowedWriteScopes: ['/workspace/tests/'] });
    registry.register('fs.write', (input) => Promise.resolve(input));
    const result = await registry.call('fs.write', { path: '/workspace/tests/foo.ts' }, { sessionId: 's1', stepIndex: 0 });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HarnessSessionManager — approval persistence and budget/stopConditions
// ---------------------------------------------------------------------------

describe('HarnessSessionManager approval flow', () => {
  it('requestApproval transitions to waiting-approval and persists record', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    const record = mgr.requestApproval(session.session_id, 'shell.exec', 2, dir);
    expect(record.status).toBe('pending');
    expect(record.toolName).toBe('shell.exec');
    expect(mgr.findById(session.session_id)?.status).toBe('waiting-approval');
    const toolCallsPath = join(dir, 'agent-traces', session.session_id, 'tool-calls.jsonl');
    expect(readFileSync(toolCallsPath, 'utf8')).toContain('shell.exec');
  });

  it('grantApproval transitions back to running and persists grant', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    const pending = mgr.requestApproval(session.session_id, 'shell.exec', 2, dir);
    const granted = mgr.grantApproval(session.session_id, pending, dir);
    expect(granted.status).toBe('granted');
    expect(mgr.findById(session.session_id)?.status).toBe('running');
  });
});

describe('HarnessSessionManager budget and stopConditions', () => {
  it('checkSessionBudget returns false when within budget', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: { ...DEFAULT_EXPLORATION_POLICY, sessionBudgetMs: 60_000 }, dataRoot: dir });
    expect(mgr.checkSessionBudget(session.session_id)).toBe(false);
  });

  it('checkSessionBudget returns true when budget exceeded', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: { ...DEFAULT_EXPLORATION_POLICY, sessionBudgetMs: 0 }, dataRoot: dir });
    expect(mgr.checkSessionBudget(session.session_id)).toBe(true);
  });

  it('evaluateStopConditions triggers on maxFindings', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const policy = { ...DEFAULT_EXPLORATION_POLICY, stopConditions: { maxFindings: 3 } };
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy, dataRoot: dir });
    const result = mgr.evaluateStopConditions(session.session_id, { findingCount: 3, stepsSinceLastFinding: 0, focusAreasCovered: false });
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain('maxFindings');
  });

  it('evaluateStopConditions triggers on noNewFindings', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const policy = { ...DEFAULT_EXPLORATION_POLICY, stopConditions: { stopWhenNoNewFindingsForSteps: 5 } };
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy, dataRoot: dir });
    const result = mgr.evaluateStopConditions(session.session_id, { findingCount: 0, stepsSinceLastFinding: 5, focusAreasCovered: false });
    expect(result.shouldStop).toBe(true);
  });

  it('evaluateStopConditions returns false when conditions not met', () => {
    const db = makeDb(); seedRun(db);
    const mgr = new HarnessSessionManager(db);
    const session = mgr.startSession({ runId: 'r1', kind: 'exploration', agentName: 'a', policy: DEFAULT_EXPLORATION_POLICY, dataRoot: dir });
    const result = mgr.evaluateStopConditions(session.session_id, { findingCount: 1, stepsSinceLastFinding: 0, focusAreasCovered: false });
    expect(result.shouldStop).toBe(false);
  });
});
