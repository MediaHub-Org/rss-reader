/**
 * Shared feed-proxy core.
 *
 * Used by two hosts:
 *   - the Vite dev/preview middleware (vite.config.ts)
 *   - a standalone Node server (server/proxy.mjs, `npm run proxy`)
 *
 * Kept as plain ESM JavaScript so both bundler and plain Node can import it.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — feeds are text, anything larger is abuse
const MAX_REDIRECTS = 5;

/** Hostnames that must never be reached through the proxy (SSRF guard). */
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', '0.0.0.0', '::1']);

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|224\.|240\.)/.test(host)) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = /^172\.(\d+)\./.exec(host);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Normalise and validate a user-supplied feed URL.
 * Returns { ok } or { ok:false, error }.
 */
export function validateFeedUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Please enter a feed URL.' };
  }
  let candidate = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) feed URLs are supported.' };
  }
  if (isPrivateHost(url.hostname)) {
    return { ok: false, error: 'That host is not reachable from the proxy.' };
  }
  return { ok: true, url: url.toString() };
}

async function readBody(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error('That feed is larger than 5 MB.');
  }

  // A single arrayBuffer() read: hand-rolled chunk accumulation over
  // response.body() copies views that can be recycled by the HTTP stack,
  // which silently corrupts multi-byte content mid-document.
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error('That feed is larger than 5 MB.');
  }
  return new Uint8Array(buffer);
}

async function fetchOnce(url, { method = 'GET', timeoutMs, redirects = 0 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RSSReader/0.1; +https://localhost/rss-reader)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.8',
        ...(method === 'HEAD' ? {} : {}),
      },
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (redirects >= MAX_REDIRECTS) throw new Error('Too many redirects');
      const next = new URL(response.headers.get('location'), url).toString();
      const v = validateFeedUrl(next);
      if (!v.ok) throw new Error(v.error);
      return fetchOnce(v.url, { timeoutMs, redirects: redirects + 1 });
    }

    return { response, url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a feed on behalf of the browser.
 * @param {string|null} rawTarget
 * @param {number} [timeoutMs]
 * @returns {Promise<{status:number, contentType:string, body:string}>}
 */
export async function proxyFeedRequest(rawTarget, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const v = validateFeedUrl(rawTarget ?? '');
  if (!v.ok) {
    return json(400, v.error);
  }

  const attempts = [];
  if (v.url.startsWith('http://')) {
    // Spec: prefer HTTPS for external requests, fall back to plain HTTP only if needed.
    attempts.push(v.url.replace(/^http:\/\//, 'https://'));
    attempts.push(v.url);
  } else {
    attempts.push(v.url);
  }

  let lastError;
  for (const attempt of attempts) {
    try {
      const { response, url } = await fetchOnce(attempt, { timeoutMs });

      if (response.status === 405) {
        // Some origins reject GET-less verbs oddly; retry once with GET.
        const retry = await fetchOnce(url, { method: 'GET', timeoutMs });
        return await toResult(retry.response);
      }

      if (!response.ok) {
        lastError = `Upstream returned ${response.status} ${response.statusText}`;
        continue;
      }
      return await toResult(response);
    } catch (err) {
      lastError = err?.name === 'AbortError' ? 'The request timed out.' : String(err?.message || err);
    }
  }

  return json(502, lastError || 'Unable to fetch that feed.');
}

async function toResult(response) {
  const bytes = await readBody(response);
  const contentType =
    response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';
  return {
    status: 200,
    contentType: contentType.includes('xml') || contentType.includes('html') ? contentType : 'text/plain; charset=utf-8',
    body: Buffer.from(bytes).toString('utf8'),
    finalUrl: response.url,
  };
}

function json(status, message) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ error: message }),
  };
}
