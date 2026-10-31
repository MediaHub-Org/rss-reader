/* eslint-env serviceworker */
/**
 * App-shell service worker — makes the installed app start instantly and keep
 * working offline (feed content still needs the network).
 *
 * Deliberate rules:
 *  - /proxy is NEVER cached: feed reads are private and must stay fresh.
 *  - hashed build assets are cache-first (immutable filenames).
 *  - navigations are network-first with a cached shell fallback.
 *
 * Registered by src/main.tsx in production builds only.
 */
const VERSION = 'rss-reader-shell-__BUILD_VERSION__';
const SHELL = ['./', './index.html'];

/**
 * The first page load happens *before* the service worker controls it, so its
 * hashed CSS/JS never pass through here. Read the shell HTML at install time
 * and precache exactly what it references, otherwise an offline start renders
 * a blank page.
 */
async function collectShellAssets(cache) {
  const html = await (await fetch('./index.html')).text();
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)]
    .map((match) => new URL(match[1], self.location.href).href);

  const urls = [...SHELL, ...assets];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch {
        // A missing optional asset must never break installation.
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => collectShellAssets(cache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  // ignoreVary: the origin server sends `Vary: Origin`, and CORS-mode
  // subresources (module scripts, stylesheets) carry a different Origin than
  // the precache request did — the asset URLs are hashed, so identity is exact.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) void cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const shell = await cache.match('./index.html', { ignoreVary: true });
    if (shell && request.mode === 'navigate') return shell;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let the browser handle third parties
  if (url.pathname.endsWith('/proxy')) return;     // feed traffic: always live

  if (request.mode === 'navigate' || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
