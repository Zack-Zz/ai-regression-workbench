import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, runMigrations, RunRepository, CodeTaskRepository, CommitRepository } from '@zarb/storage';
import { CommitManager } from '../src/index.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

function makeDb() {
  const db = openDb(join(dir, `test-${String(Date.now())}.db`));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function seedTask(db: ReturnType<typeof makeDb>, taskId = 't1', workspacePath = '/ws') {
  new RunRepository(db).create({ runId: 'r1', scopeType: 'suite', workspacePath, startedAt: new Date().toISOString() });
  new CodeTaskRepository(db).create({ taskId, runId: 'r1', workspacePath, goal: 'fix', createdAt: new Date().toISOString() });
  new CommitRepository(db).create({ id: `c-${taskId}`, taskId, commitMessage: 'fix: test', createdAt: new Date().toISOString() });
}

function initGitRepo(path: string) {
  mkdirSync(path, { recursive: true });
  execSync('git init', { cwd: path });
  execSync('git config user.email "test@test.com"', { cwd: path });
  execSync('git config user.name "Test"', { cwd: path });
}

beforeEach(() => {
  dir = join(tmpdir(), `zarb-review-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('CommitManager', () => {
  it('returns error when commit record not found', () => {
    const db = makeDb();
    new RunRepository(db).create({ runId: 'r1', scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
    new CodeTaskRepository(db).create({ taskId: 't1', runId: 'r1', workspacePath: '/ws', goal: 'fix', createdAt: new Date().toISOString() });
    const mgr = new CommitManager(db);
    const result = mgr.commit({ taskId: 't1', commitMessage: 'fix', dataRoot: dir });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Commit record not found');
  });

  it('returns error when task not found', () => {
    const db = makeDb();
    const mgr = new CommitManager(db);
    const result = mgr.commit({ taskId: 'nope', commitMessage: 'fix', dataRoot: dir });
    expect(result.success).toBe(false);
  });

  it('creates a real git commit and persists SHA', () => {
    const ws = join(dir, 'ws');
    initGitRepo(ws);
    writeFileSync(join(ws, 'file.ts'), 'const x = 1;\n');
    execSync('git add .', { cwd: ws });
    execSync('git commit -m "init"', { cwd: ws });
    writeFileSync(join(ws, 'file.ts'), 'const x = 2;\n');

    const db = makeDb();
    seedTask(db, 't1', ws);
    db.prepare("UPDATE code_tasks SET status='COMMIT_PENDING', changed_files_json='[\"file.ts\"]' WHERE task_id='t1'").run();

    const mgr = new CommitManager(db);
    const result = mgr.commit({ taskId: 't1', commitMessage: 'fix: update x', dataRoot: dir });

    expect(result.success).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const commitRow = new CommitRepository(db).findByTaskId('t1');
    expect(commitRow?.commit_sha).toBe(result.commitSha);
    expect(commitRow?.status).toBe('committed');

    const taskRow = new CodeTaskRepository(db).findById('t1');
    expect(taskRow?.status).toBe('COMMITTED');
  });

  it('persists failure reason when git commit fails', () => {
    const db = makeDb();
    seedTask(db, 't1', '/nonexistent-workspace');
    db.prepare("UPDATE code_tasks SET status='COMMIT_PENDING' WHERE task_id='t1'").run();

    const mgr = new CommitManager(db);
    const result = mgr.commit({ taskId: 't1', commitMessage: 'fix', dataRoot: dir });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeTruthy();

    const commitRow = new CommitRepository(db).findByTaskId('t1');
    expect(commitRow?.status).toBe('failed');
    expect(commitRow?.error_message).toBeTruthy();
  });

  it('creates branch before committing and persists branchName', () => {
    const ws = join(dir, 'ws2');
    initGitRepo(ws);
    writeFileSync(join(ws, 'a.ts'), 'const a = 1;\n');
    execSync('git add .', { cwd: ws });
    execSync('git commit -m "init"', { cwd: ws });
    writeFileSync(join(ws, 'a.ts'), 'const a = 2;\n');

    const db = makeDb();
    seedTask(db, 't2', ws);
    db.prepare("UPDATE code_tasks SET status='COMMIT_PENDING', changed_files_json='[\"a.ts\"]' WHERE task_id='t2'").run();

    const mgr = new CommitManager(db);
    const result = mgr.commit({ taskId: 't2', commitMessage: 'fix: branch', branchName: 'fix/test-branch', dataRoot: dir });

    expect(result.success).toBe(true);
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ws, encoding: 'utf8' }).trim();
    expect(branch).toBe('fix/test-branch');

    const commitRow = new CommitRepository(db).findByTaskId('t2');
    expect(commitRow?.branch_name).toBe('fix/test-branch');
  });

  it('does not stage unrelated dirty files — only commits task changedFiles', () => {
    const ws = join(dir, 'ws3');
    initGitRepo(ws);
    writeFileSync(join(ws, 'task-file.ts'), 'const x = 1;\n');
    writeFileSync(join(ws, 'unrelated.ts'), 'const y = 1;\n');
    execSync('git add .', { cwd: ws });
    execSync('git commit -m "init"', { cwd: ws });

    // Task changes task-file.ts; unrelated.ts is also dirty but not in changedFiles
    writeFileSync(join(ws, 'task-file.ts'), 'const x = 2;\n');
    writeFileSync(join(ws, 'unrelated.ts'), 'const y = 99;\n');

    const db = makeDb();
    seedTask(db, 't3', ws);
    db.prepare("UPDATE code_tasks SET status='COMMIT_PENDING', changed_files_json='[\"task-file.ts\"]' WHERE task_id='t3'").run();

    const mgr = new CommitManager(db);
    const result = mgr.commit({ taskId: 't3', commitMessage: 'fix: scoped', dataRoot: dir });

    expect(result.success).toBe(true);

    // Only task-file.ts should be in the commit, not unrelated.ts
    const committedFiles = execSync('git diff HEAD~1 HEAD --name-only', { cwd: ws, encoding: 'utf8' }).trim();
    expect(committedFiles).toContain('task-file.ts');
    expect(committedFiles).not.toContain('unrelated.ts');

    // unrelated.ts should still be dirty (unstaged)
    const status = execSync('git status --porcelain', { cwd: ws, encoding: 'utf8' });
    expect(status).toContain('unrelated.ts');
  });
});
