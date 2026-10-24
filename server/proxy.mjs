#!/usr/bin/env node
/**
 * Standalone feed proxy: `npm run proxy` (default port 8788).
 *
 * The app tries direct fetching first and only falls back to this proxy when the
 * browser blocks the request with a CORS error, so running it is optional in dev
 * (the Vite dev server mounts the same handler on /proxy) but recommended when
 * serving the built bundle from a plain static host.
 *
 *   http://localhost:8788/proxy?url=https%3A%2F%2Fexample.com%2Ffeed.xml
 */
import http from 'node:http';
import { proxyFeedRequest } from './proxy-lib.mjs';

const PORT = Number(process.env.PROXY_PORT || 8788);
const ALLOW_ORIGIN = process.env.PROXY_ORIGIN || '*';

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (url.pathname !== '/proxy') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('RSS reader proxy. Use /proxy?url=<encoded feed url>');
    return;
  }

  const result = await proxyFeedRequest(url.searchParams.get('url'), 15_000);
  res.statusCode = result.status;
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(result.body);
});

server.listen(PORT, () => {
  console.log(`Feed proxy listening on http://localhost:${PORT}/proxy?url=...`);
});
