// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isAllowedHost, proxyCallerAllowed, proxyResponseHeaders } from './guards.mjs';

describe('isAllowedHost', () => {
  it('accepts loopback names on the right port only', () => {
    expect(isAllowedHost('localhost:8788', 8788)).toBe(true);
    expect(isAllowedHost('127.0.0.1:8788', 8788)).toBe(true);
    expect(isAllowedHost('[::1]:8788', 8788)).toBe(true);
    expect(isAllowedHost('LOCALHOST:8788', 8788)).toBe(true);
    expect(isAllowedHost('evil.example:8788', 8788)).toBe(false);
    expect(isAllowedHost('localhost:4173', 8788)).toBe(false);
    expect(isAllowedHost(undefined, 8788)).toBe(false);
  });
});

describe('proxyCallerAllowed (standalone proxy on :8788 serving the app on :4173)', () => {
  const origins = new Set(['http://localhost:4173']);

  it('allows the app origin over CORS, even though it is same-site', () => {
    expect(proxyCallerAllowed({ origin: 'http://localhost:4173', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, origins)).toBe(true);
  });

  it('allows tools with no browser headers (curl)', () => {
    expect(proxyCallerAllowed({}, origins)).toBe(true);
  });

  it('rejects foreign or opaque origins and blind cross-site loads', () => {
    expect(proxyCallerAllowed({ origin: 'https://evil.example' }, origins)).toBe(false);
    expect(proxyCallerAllowed({ origin: 'null' }, origins)).toBe(false);
    expect(proxyCallerAllowed({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image' }, origins)).toBe(false);
    expect(proxyCallerAllowed({ 'sec-fetch-site': 'same-site' }, origins)).toBe(false);
  });

  it('rejects navigations even from the app origin', () => {
    expect(proxyCallerAllowed({ origin: 'http://localhost:4173', 'sec-fetch-mode': 'navigate' }, origins)).toBe(false);
    expect(proxyCallerAllowed({ 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' }, origins)).toBe(false);
  });
});

describe('proxyResponseHeaders', () => {
  it('downgrades HTML to plain text and forbids execution', () => {
    const headers = proxyResponseHeaders('text/html');
    expect(headers['Content-Type']).toMatch(/^text\/plain/);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toMatch(/sandbox/);
    expect(headers['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('keeps XML and JSON types', () => {
    expect(proxyResponseHeaders('application/rss+xml')['Content-Type']).toBe('application/rss+xml');
    expect(proxyResponseHeaders('application/json; charset=utf-8')['Content-Type']).toBe('application/json; charset=utf-8');
  });

  it('downgrades XHTML and SVG, which can also run script', () => {
    expect(proxyResponseHeaders('application/xhtml+xml')['Content-Type']).toMatch(/^text\/plain/);
    expect(proxyResponseHeaders('image/svg+xml')['Content-Type']).toMatch(/^text\/plain/);
  });
});
