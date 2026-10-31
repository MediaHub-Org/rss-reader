import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './updates';

describe('isNewerVersion', () => {
  it('compares numeric version segments', () => {
    expect(isNewerVersion('0.14.0', '0.13.4')).toBe(true);
    expect(isNewerVersion('0.13.10', '0.13.4')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.13.4', '0.13.4')).toBe(false);
    expect(isNewerVersion('v0.13.3', '0.13.4')).toBe(false);
  });

  it('ignores prerelease suffixes', () => {
    expect(isNewerVersion('0.14.0-beta.1', '0.13.4')).toBe(true);
    expect(isNewerVersion('0.13.4-beta.1', '0.13.4')).toBe(false);
  });
});
