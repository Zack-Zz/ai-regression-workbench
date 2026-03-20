#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const nodeCmd = process.execPath;
const inspectArg = process.argv.find((arg) => arg === '--inspect' || arg.startsWith('--inspect='));

let shuttingDown = false;
let restartingServer = false;
let restartTimer = null;
let server = null;

function runOnce(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${String(code)}`));
    });
  });
}

function terminate(children, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  for (const child of children) {
    if (!child || child.killed) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child || child.killed) continue;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    process.exit(code);
  }, 1200).unref();
}

function spawnServer() {
  const nodeArgs = [];
  if (inspectArg) nodeArgs.push(inspectArg === '--inspect' ? '--inspect=9229' : inspectArg);
  nodeArgs.push('apps/cli/dist/bin.js');
  console.log(`[dev-api] server: ${nodeCmd} ${nodeArgs.join(' ')}`);
  const child = spawn(nodeCmd, nodeArgs, { stdio: 'inherit', env: process.env });
  child.on('error', (err) => {
    if (shuttingDown) return;
    console.error('[dev-api] server failed to start:', err);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (restartingServer) return;
    console.error(`[dev-api] server process exited (${String(code ?? signal)})`);
    server = null;
    console.log('[dev-api] waiting for next successful build to restart server');
  });
  server = child;
  return child;
}

function scheduleRestart(reason) {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (shuttingDown) return;
    console.log(`[dev-api] restart server (${reason})`);
    if (!server || server.killed) {
      spawnServer();
      return;
    }
    restartingServer = true;
    server.once('exit', () => {
      restartingServer = false;
      if (!shuttingDown) spawnServer();
    });
    try {
      server.kill('SIGTERM');
    } catch {
      restartingServer = false;
      spawnServer();
      return;
    }
    setTimeout(() => {
      if (server && !server.killed) {
        try {
          server.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, 800).unref();
  }, 180);
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

async function main() {
  const startupTs = Date.now();
  const restartGraceMs = 5000;
  console.log('[dev-api] initial build: tsc -b apps/cli');
  await runOnce(pnpmCmd, ['-s', 'tsc', '-b', 'apps/cli'], 'initial build');

  console.log('[dev-api] watch build: tsc -b apps/cli -w');
  const tscWatch = spawn(pnpmCmd, ['-s', 'tsc', '-b', 'apps/cli', '-w', '--preserveWatchOutput'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  tscWatch.on('error', (err) => {
    if (shuttingDown) return;
    console.error('[dev-api] tsc watch failed to start:', err);
  });

  let buffered = '';
  let successfulBuildCount = 0;
  const handleChunk = (chunk, target) => {
    const text = String(chunk);
    target.write(text);
    buffered += text;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const clean = stripAnsi(line);
      const match = clean.match(/Found\s+(\d+)\s+errors?/);
      if (!match) continue;
      if (!/Watching for file changes/.test(clean)) continue;
      const errors = Number(match[1]);
      if (errors !== 0) {
        console.log('[dev-api] build contains errors, skip restart');
        continue;
      }
      successfulBuildCount += 1;
      if (successfulBuildCount > 1 && Date.now() - startupTs >= restartGraceMs) {
        scheduleRestart('incremental build success');
      }
    }
  };

  tscWatch.stdout?.on('data', (chunk) => handleChunk(chunk, process.stdout));
  tscWatch.stderr?.on('data', (chunk) => handleChunk(chunk, process.stderr));

  spawnServer();

  process.on('SIGINT', () => terminate([tscWatch, server], 0));
  process.on('SIGTERM', () => terminate([tscWatch, server], 0));

  tscWatch.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev-api] tsc watch exited unexpectedly (${String(code ?? signal)})`);
    terminate([tscWatch, server], typeof code === 'number' ? code : 1);
  });
}

main().catch((err) => {
  console.error('[dev-api] startup failed:', err);
  process.exit(1);
});
