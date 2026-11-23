#!/usr/bin/env node
/**
 * Local app server for the installed PWA: `npm run serve` (port 4173).
 *
 * Serves the built bundle (dist/) and the feed proxy (/proxy) from one origin,
 * http://localhost:4173, so the PWA can refresh feeds with no CORS and no
 * third-party proxy. The port matches `vite preview` on purpose: the installed
 * PWA keeps its data under that origin.
 *
 * Guard rails:
 *  - listens on loopback only (127.0.0.1 and ::1), never on the network;
 *  - answers only to Host headers naming this machine (anti DNS-rebinding);
 *  - /proxy sends no CORS headers and refuses cross-site callers, so other
 *    websites cannot use it as an open proxy;
 *  - static paths cannot escape dist/.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream';
import { proxyFeedRequest } from './proxy-lib.mjs';
import { isAllowedHost, loopbackOrigins, proxyCallerAllowed, proxyResponseHeaders } from './guards.mjs';

export const DEFAULT_PORT = 4173;
const LOOPBACK = ['127.0.0.1', '::1'];
const PROXY_TIMEOUT_MS = 15_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/** Map a URL pathname to a file inside root, or null if it would escape it. */
function resolveStatic(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalised = decoded.replace(/\\/g, '/');
  const target = resolve(root, `.${normalised.startsWith('/') ? '' : '/'}${normalised}`);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function serveFile(req, res, file) {
  const name = file.slice(file.lastIndexOf(sep) + 1);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const isAsset = file.includes(`${sep}assets${sep}`);
  res.setHeader(
    'Cache-Control',
    isAsset && name !== 'sw.js' ? 'public, max-age=31536000, immutable' : 'no-cache'
  );
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  // A file can vanish between stat and open (e.g. during `npm run build`);
  // that must fail this one response, never the whole server.
  pipeline(createReadStream(file), res, (err) => {
    if (!err) return;
    if (!res.headersSent) send(res, 503, 'The app is being rebuilt. Try again in a moment.');
    else res.destroy();
  });
}

/**
 * Build the request handler. `proxy` is injectable for tests.
 * @param {{ root: string, port: number, proxy?: typeof proxyFeedRequest }} opts
 */
export function createAppHandler({ root, port, proxy = proxyFeedRequest }) {
  const rootDir = resolve(root);
  const origins = loopbackOrigins(port);

  return async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, port)) {
        send(res, 421, 'Unknown host.');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        send(res, 405, 'Method not allowed.');
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/proxy') {
        if (!proxyCallerAllowed(req.headers, origins)) {
          send(res, 403, 'The feed proxy only answers this app.');
          return;
        }
        const result = await proxy(url.searchParams.get('url'), PROXY_TIMEOUT_MS);
        res.statusCode = result.status;
        for (const [name, value] of Object.entries(proxyResponseHeaders(result.contentType))) {
          res.setHeader(name, value);
        }
        res.end(req.method === 'HEAD' ? undefined : result.body);
        return;
      }

      const target = resolveStatic(rootDir, url.pathname);
      if (!target) {
        send(res, 404, 'Not found.');
        return;
      }
      if (isFile(target)) {
        serveFile(req, res, target);
        return;
      }
      if (target.startsWith(join(rootDir, 'assets')) || extname(target)) {
        send(res, 404, 'Not found.');
        return;
      }
      // App route: hand back the shell, unless a rebuild has emptied dist/.
      const shell = join(rootDir, 'index.html');
      if (!isFile(shell)) {
        send(res, 503, 'The app is being rebuilt. Try again in a moment.');
        return;
      }
      serveFile(req, res, shell);
    } catch (err) {
      if (!res.headersSent) send(res, 500, 'Internal error.');
      else res.destroy(err instanceof Error ? err : undefined);
    }
  };
}

function listen(server, port, host) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (err) => {
      server.off('listening', onListening);
      rejectListen(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Start one server per loopback address. IPv6 loopback is skipped when the
 * machine does not have it.
 * @param {{ root: string, port?: number }} opts
 */
export async function startAppServer({ root, port = DEFAULT_PORT }) {
  const servers = [];
  let actualPort = port;
  try {
    for (const host of LOOPBACK) {
      const server = http.createServer();
      try {
        await listen(server, actualPort, host);
      } catch (err) {
        if (host === '::1' && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(err?.code)) continue;
        if (err?.code === 'EADDRINUSE') {
          throw new Error(`Port ${actualPort} is already in use. Is the app already running (or "vite preview")?`);
        }
        throw err;
      }
      actualPort = server.address().port;
      servers.push(server);
    }
  } catch (err) {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    throw err;
  }
  const handler = createAppHandler({ root, port: actualPort });
  for (const server of servers) server.on('request', handler);
  return servers;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  if (!existsSync(join(root, 'index.html'))) {
    console.error('dist/ is missing — run "npm run build" first.');
    process.exit(1);
  }
  const port = Number(process.env.PORT || DEFAULT_PORT);
  try {
    await startAppServer({ root, port });
    console.log(`RSS Reader is served on http://localhost:${port} (loopback only).`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
