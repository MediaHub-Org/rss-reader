/**
 * One-command launcher: `npm start`
 *
 * 1. If the app is already served on :4173, just open it.
 * 2. Otherwise rebuild when the sources are newer than dist/, start the
 *    local app server (server/app-server.mjs) in the background, wait for
 *    the port, then open the app.
 *
 * The server outlives this process so the installed PWA can talk to it; the
 * window that started it can close immediately. Pass --no-open to skip
 * opening the browser (used by CI/tests).
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const ROOT = resolve(import.meta.dirname, '..');
const NO_OPEN = process.argv.includes('--no-open');

// Drive the toolchain directly with this Node instead of going through npm:
// `npm` is a .cmd shim on Windows (spawn ENOENT without a shell) and may not
// be on PATH at all in a non-interactive shell.
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is something serving the app? */
async function isUp() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Newest modification time under the given paths (dist/ excluded). */
function newestSourceMtime() {
  const roots = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'];
  let newest = 0;
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  };
  for (const root of roots) {
    const path = join(ROOT, root);
    if (existsSync(path)) visit(path);
  }
  return newest;
}

function build() {
  console.log('Building the app…');
  execFileSync(process.execPath, [TSC, '-b'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync(process.execPath, [VITE, 'build'], { cwd: ROOT, stdio: 'inherit' });
}

/** Is something holding the port, even if it is not answering HTTP? */
function portInUse(port) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolveProbe(true);
    });
    socket.once('error', () => resolveProbe(false));
  });
}

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, 'server', 'app-server.mjs')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  // `stdio: 'ignore'` keeps the server independent of this window, so its
  // EADDRINUSE message cannot be read from here. Watching the exit at least
  // turns the 30 s generic timeout into an immediate, accurate failure.
  let exitCode = null;
  child.on('exit', (code) => {
    exitCode = code ?? 0;
  });
  child.on('error', (error) => {
    console.error(`Could not start the app server: ${error.message}`);
    process.exit(1);
  });
  child.unref();
  console.log(`Starting the app server on ${BASE} (pid ${child.pid})…`);
  return { hasExited: () => exitCode !== null };
}

/** Open the app with whatever the host provides. */
async function openApp() {
  const open = (cmd, args) =>
    new Promise((resolveOpen) => {
      try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', () => resolveOpen(false));
        child.on('spawn', () => {
          child.unref();
          resolveOpen(true);
        });
      } catch {
        resolveOpen(false);
      }
    });

  // Running under WSL: hand the URL to the Windows browser, which is where
  // the installed PWA lives.
  if (process.platform === 'linux') {
    for (const cmd of [
      ['cmd.exe', ['/c', 'start', '', BASE]],
      ['wslview', [BASE]],
      ['xdg-open', [BASE]],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      if (await open(cmd[0], cmd[1])) return;
    }
  } else if (process.platform === 'darwin') {
    if (await open('open', [BASE])) return;
  } else if (await open('cmd', ['/c', 'start', '', BASE])) return;

  console.log(`Open ${BASE} in your browser.`);
}

const alreadyRunning = await isUp();

if (!alreadyRunning) {
  if (await portInUse(PORT)) {
    console.error(
      `Port ${PORT} is already in use by another process (an old app server, "vite preview" or the scheduled task). Close it and run "npm start" again.`
    );
    process.exit(1);
  }
  const distIndex = join(ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex) || statSync(distIndex).mtimeMs < newestSourceMtime()) {
    build();
  }
  const server = startServer();

  const deadline = Date.now() + 30_000;
  while (!(await isUp())) {
    if (server.hasExited()) {
      console.error(
        `The app server exited before serving ${BASE}. Port ${PORT} may be taken by another process; run "npm run serve" to see the error.`
      );
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error(`The app did not come up on ${BASE}. Check "npm run serve".`);
      process.exit(1);
    }
    await sleep(300);
  }
}

console.log(`Ready → ${BASE}`);
if (!NO_OPEN) await openApp();
