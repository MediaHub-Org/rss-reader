import { describe, expect, it } from 'vitest';
import { extractReadableHtml, readableLength } from './fullContent';

const page = `
<!doctype html>
<html><head><title>Story</title><style>.x{color:red}</style></head>
<body>
  <nav><a href="/">Home</a></nav>
  <main>
    <article>
      <h1>A real story</h1>
      <p>First paragraph with a <a href="/details">relative link</a>.</p>
      <script>alert(1)</script>
      <p>Second paragraph keeps enough text to be considered readable by the extractor.</p>
    </article>
  </main>
  <aside class="related">Related stories</aside>
</body></html>`;

describe('extractReadableHtml', () => {
  it('picks the article body and strips page chrome', () => {
    const html = extractReadableHtml(page, 'https://example.com/story');
    expect(html).toContain('A real story');
    expect(html).toContain('Second paragraph');
    expect(html).not.toContain('Related stories');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('Home');
  });

  it('resolves relative links against the article URL', () => {
    const html = extractReadableHtml(page, 'https://example.com/story');
    expect(html).toContain('https://example.com/details');
  });

  it('measures visible text', () => {
    expect(readableLength('<p>Hello <b>world</b></p>')).toBe(11);
  });
});
