/**
 * Browser replacement for Node's `stream` module.
 *
 * `sax` (used by xml2js) references `require('stream').Stream` to expose its
 * push-based parser. Parsing a feed string never streams, so a minimal base
 * class keeps module initialisation happy without pulling in a full polyfill.
 */
export class Stream {
  constructor() {
    this.readable = false;
    this.writable = false;
  }
  pipe(dest) {
    return dest;
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  emit() {
    return false;
  }
  removeListener() {
    return this;
  }
  removeAllListeners() {
    return this;
  }
  pause() {
    return this;
  }
  resume() {
    return this;
  }
}

export default Stream;
