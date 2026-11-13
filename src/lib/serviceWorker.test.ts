// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('public/sw.js', 'utf8');
const current = 'rss-reader-shell-test';
type LifecycleListener = (event: { waitUntil: (task: Promise<unknown>) => void }) => void;

function worker(options: { failedUrl?: string; names?: string[] } = {}) {
  const listeners = new Map<string, LifecycleListener>();
  const saved: string[] = [];
  const cache = { put: vi.fn(async (url: string) => { saved.push(url); }) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => options.names ?? []),
    delete: vi.fn(async () => true),
  };
  const self = {
    location: { href: 'https://reader.example/sw.js' },
    addEventListener: (name: string, listener: LifecycleListener) => listeners.set(name, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const fetch = vi.fn(async (url: string) => ({
    ok: url !== options.failedUrl,
    text: async () => '<script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">',
  }));
  runInNewContext(source
    .replace('__BUILD_VERSION__', 'test')
    .replace('/* __PRECACHE_ASSETS__ */ []', '["./assets/settings.js"]'), { self, caches, fetch, URL });
  const dispatch = (name: string) => {
    let pending: Promise<unknown> | undefined;
    listeners.get(name)!({ waitUntil: (task) => { pending = task; } });
    return pending!;
  };
  return { saved, caches, self, dispatch };
}

describe('offline app shell updates', () => {
  it('removes only old app caches and preserves other caches on the origin', async () => {
    const test = worker({ names: ['other-app', 'rss-reader-shell-old', current] });
    await test.dispatch('activate');
    expect(test.caches.delete.mock.calls).toEqual([['rss-reader-shell-old']]);
    expect(test.self.clients.claim).toHaveBeenCalledOnce();
  });

  it('caches theme initialization, entry assets and lazy settings before activating', async () => {
    const test = worker();
    await test.dispatch('install');
    expect(test.saved).toEqual(expect.arrayContaining([
      './', './index.html', './theme-init.js',
      'https://reader.example/assets/app.js', 'https://reader.example/assets/app.css', './assets/settings.js',
    ]));
    expect(test.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each(['./index.html', './theme-init.js', './assets/settings.js'])(
    'keeps the previous worker active if %s is unavailable', async (failedUrl) => {
      const test = worker({ failedUrl });
      await expect(test.dispatch('install')).rejects.toThrow('Could not cache');
      expect(test.self.skipWaiting).not.toHaveBeenCalled();
      expect(test.caches.delete).not.toHaveBeenCalled();
    }
  );
});
