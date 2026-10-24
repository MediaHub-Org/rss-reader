/**
 * Browser replacement for Node's `timers` module.
 *
 * `rss-parser` → `xml2js` reads `require('timers').setImmediate` at module load
 * without a guard, so the module must exist even though we only ever parse
 * strings (never stream), where the browser's own timers are equivalent.
 */
const g = globalThis;

export const setTimeout = (handler, timeout, ...args) => g.setTimeout(handler, timeout, ...args);
export const clearTimeout = (id) => g.clearTimeout(id);
export const setInterval = (handler, timeout, ...args) => g.setInterval(handler, timeout, ...args);
export const clearInterval = (id) => g.clearInterval(id);
export const setImmediate = (handler, ...args) => g.setTimeout(handler, 0, ...args);
export const clearImmediate = (id) => g.clearTimeout(id);

export default {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
};
