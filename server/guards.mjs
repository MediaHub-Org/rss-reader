/**
 * Request guards shared by the local app server and the standalone proxy, so
 * neither can be used by other websites:
 *
 *  - isAllowedHost: only Host headers naming this machine (anti DNS-rebinding).
 *  - proxyCallerAllowed: only the app itself may call /proxy — never a foreign
 *    or opaque origin, never a blind cross-site load (<img>, <script>, no-cors),
 *    and never a navigation (a link in a feed must not open /proxy as a page).
 *  - proxyResponseHeaders: a proxied body can never execute on the app origin.
 */

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

/** @param {string | undefined} host @param {number} port */
export function isAllowedHost(host, port) {
  if (!host) return false;
  const value = String(host).toLowerCase();
  return LOOPBACK_NAMES.some((name) => value === `${name}:${port}`);
}

/** Origins of the app when it is served on `port`. */
export function loopbackOrigins(port) {
  return new Set(LOOPBACK_NAMES.map((name) => `http://${name}:${port}`));
}

/**
 * @param {Record<string, string | string[] | undefined>} headers  lower-cased Node headers
 * @param {Set<string>} allowedOrigins
 */
export function proxyCallerAllowed(headers, allowedOrigins) {
  const mode = String(headers['sec-fetch-mode'] || '');
  const dest = String(headers['sec-fetch-dest'] || '');
  const site = String(headers['sec-fetch-site'] || '');
  const origin = headers.origin === undefined ? undefined : String(headers.origin);

  if (mode === 'navigate' || (dest && dest !== 'empty')) return false;
  if (origin !== undefined) return allowedOrigins.has(origin);
  // No Origin: a same-origin GET from the app, or a tool such as curl.
  return site === '' || site === 'same-origin' || site === 'none';
}

const EXECUTABLE_TYPES = /html|svg|xsl|javascript|ecmascript/i;

/** @param {string} contentType */
export function proxyResponseHeaders(contentType) {
  return {
    'Content-Type': EXECUTABLE_TYPES.test(contentType) ? 'text/plain; charset=utf-8' : contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  };
}
