import { describe, expect, it } from 'vitest';
import { cleanTitle } from './format';
import { countLabel } from './format';

describe('countLabel', () => {
  it('uses the singular for one', () => {
    expect(countLabel(1, 'feed')).toBe('1 feed');
    expect(countLabel(1, 'read entry', 'read entries')).toBe('1 read entry');
  });

  it('uses the plural otherwise, including zero', () => {
    expect(countLabel(0, 'feed')).toBe('0 feeds');
    expect(countLabel(2, 'feed')).toBe('2 feeds');
    expect(countLabel(3, 'read entry', 'read entries')).toBe('3 read entries');
  });
});

describe('cleanTitle', () => {
  it('decodes quote entities and collapses whitespace', () => {
    expect(cleanTitle('A &quot;quoted&quot; title')).toBe('A "quoted" title');
    expect(cleanTitle('  A &#34;quoted&#34;  title  ')).toBe('A "quoted" title');
    expect(cleanTitle('A &#x22;quoted&#x22; title')).toBe('A "quoted" title');
  });
});
