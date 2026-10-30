import { describe, expect, it } from 'vitest';
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
