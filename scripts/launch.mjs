/**
 * One-command launcher: `npm start`
 *
 * 1. If the app is already served on :4173, just open it.
 * 2. Otherwise rebuild when the sources are newer than dist/, start
 *    `vite preview` in the background, wait for the port, then open the app.
 *
 * The server outlives this process so the installed PWA can talk to it; the
 * window that started it can close immediately. Pass --no-open to skip
 * opening the browser (used by CI/tests).
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
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

function startServer() {
  const child = spawn(process.execPath, [VITE, 'preview'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (error) => {
    console.error(`Could not start the app server: ${error.message}`);
    process.exit(1);
  });
  child.unref();
  console.log(`Starting the app server on ${BASE} (pid ${child.pid})…`);
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
  const distIndex = join(ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex) || statSync(distIndex).mtimeMs < newestSourceMtime()) {
    build();
  }
  startServer();

  const deadline = Date.now() + 30_000;
  while (!(await isUp())) {
    if (Date.now() > deadline) {
      console.error(`The app did not come up on ${BASE}. Check "npm run preview".`);
      process.exit(1);
    }
    await sleep(300);
  }
}

console.log(`Ready → ${BASE}`);
if (!NO_OPEN) await openApp();
