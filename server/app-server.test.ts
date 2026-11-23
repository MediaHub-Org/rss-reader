// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppHandler, startAppServer } from './app-server.mjs';

const SECRET = 'top-secret-outside-root';
let base: string;
let root: string;
let server: http.Server;
let port: number;
let proxy: ReturnType<typeof vi.fn>;

function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: `localhost:${port}`, ...headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'app-server-test-'));
  root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>shell</title>');
  writeFileSync(join(root, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1);');
  writeFileSync(join(base, 'secret.txt'), SECRET);

  proxy = vi.fn(async () => ({ status: 200, contentType: 'application/xml', body: '<rss/>' }));
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  server.on('request', createAppHandler({ root, port, proxy }));
});

afterEach(() => proxy.mockClear());

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(base, { recursive: true, force: true });
});

describe('static files', () => {
  it('serves index.html at /', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('shell');
  });

  it('falls back to index.html for unknown routes', async () => {
    const route = await get('/feeds/x');
    expect(route.status).toBe(200);
    expect(route.body).toContain('shell');
    expect((await get('/assets/missing.js')).status).toBe(404);
  });

  it('caches hashed assets', async () => {
    const res = await get('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/javascript/);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('never caches the service worker', async () => {
    const res = await get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('refuses encoded traversal', async () => {
    for (const path of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%5c..%5csecret.txt', '/%2e%2e%2f%2e%2e%2fsecret.txt']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain(SECRET);
    }
  });
});

describe('origin guards', () => {
  it('rejects foreign Host', async () => {
    for (const path of ['/', '/proxy?url=https%3A%2F%2Fexample.com%2Ff.xml']) {
      const res = await get(path, { Host: `evil.example:${port}` });
      expect(res.status, path).toBe(421);
    }
    expect(proxy).not.toHaveBeenCalled();
  });

  it('rejects cross-site proxy calls', async () => {
    const path = '/proxy?url=https%3A%2F%2Fexample.com%2Ff.xml';
    expect((await get(path, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await get(path, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });

  it('proxies same-origin requests', async () => {
    const path = '/proxy?url=https%3A%2F%2Fexample.com%2Ff.xml';
    for (const headers of [{ Origin: `http://localhost:${port}` }, {}]) {
      const res = await get(path, headers);
      expect(res.status).toBe(200);
      expect(res.body).toBe('<rss/>');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(proxy).toHaveBeenCalledWith('https://example.com/f.xml', expect.any(Number));
  });
});

describe('proxy responses cannot run as pages', () => {
  const path = '/proxy?url=https%3A%2F%2Fexample.com%2Fx.html';

  it('rejects navigations to /proxy', async () => {
    expect((await get(path, { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' })).status).toBe(403);
    expect((await get(path, { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'document' })).status).toBe(403);
    expect((await get(path, { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'iframe' })).status).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });

  it('never serves upstream HTML as HTML', async () => {
    proxy.mockResolvedValueOnce({ status: 200, contentType: 'text/html', body: '<script>alert(1)</script>' });
    const res = await get(path, { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
  });
});

describe('missing or unreadable files', () => {
  it('answers 503 without crashing when index.html is gone', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'app-server-empty-'));
    const s = http.createServer();
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    const p = (s.address() as AddressInfo).port;
    s.on('request', createAppHandler({ root: emptyRoot, port: p, proxy }));
    const saved = port;
    port = p;
    try {
      expect((await get('/some/route')).status).toBe(503);
      expect((await get('/')).status).toBe(503);
    } finally {
      port = saved;
      await new Promise((r) => s.close(r));
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('startAppServer', () => {
  it('listens on loopback only', async () => {
    const servers = await startAppServer({ root, port: 0 });
    try {
      expect(servers.length).toBeGreaterThan(0);
      for (const s of servers) {
        expect(['127.0.0.1', '::1']).toContain((s.address() as AddressInfo).address);
      }
    } finally {
      await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    }
  });

  it('reports EADDRINUSE', async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as AddressInfo).port;
    try {
      await expect(startAppServer({ root, port: taken })).rejects.toThrow(/already in use/);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });
});
