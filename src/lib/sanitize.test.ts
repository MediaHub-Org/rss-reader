import { describe, expect, it } from 'vitest';
import { sanitizeHtml, sanitizeText } from './sanitize';

describe('sanitizeHtml', () => {
  it('strips scripts, handlers and dangerous protocols', () => {
    const html = sanitizeHtml(
      '<p onclick="alert(1)">Hi <a href="javascript:alert(1)">bad</a></p>' +
        '<script>alert(1)</script><iframe src="https://evil.example"></iframe>',
      'https://example.com/story'
    );

    expect(html).toContain('Hi');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
  });

  it('resolves relative links and images and hardens external links', () => {
    const html = sanitizeHtml(
      '<p><a href="/next">Next</a><img src="photo.png" onerror="x"></p>',
      'https://example.com/posts/story'
    );

    expect(html).toContain('href="https://example.com/next"');
    expect(html).toContain('src="https://example.com/posts/photo.png"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('onerror');
    expect(html).toContain('loading="lazy"');
  });

  it('keeps safe formatting and returns an empty string for empty input', () => {
    expect(sanitizeHtml('<p><strong>bold</strong> <em>italic</em></p>')).toContain(
      '<strong>bold</strong>'
    );
    expect(sanitizeHtml('')).toBe('');
  });

  it('sanitizes plain text separately', () => {
    expect(sanitizeText('<b>Hello</b> <script>bad()</script>')).toBe('Hello ');
  });
});
