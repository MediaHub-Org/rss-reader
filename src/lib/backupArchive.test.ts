import { describe, expect, it } from 'vitest';
import { createBackupArchive, looksLikeZip, readBackupArchive } from './backupArchive';

describe('backup archive', () => {
  it('round-trips JSON through a compressed ZIP', () => {
    const json = JSON.stringify({ version: 2, feeds: [{ url: 'https://example.com/feed' }] });
    const archive = createBackupArchive(json);
    expect(looksLikeZip(archive)).toBe(true);
    expect(readBackupArchive(archive)).toBe(json);
  });

  it('rejects non-ZIP input', () => {
    expect(looksLikeZip(new TextEncoder().encode('{"feeds":[]}'))).toBe(false);
    expect(() => readBackupArchive(new TextEncoder().encode('not a zip'))).toThrow();
  });
});
