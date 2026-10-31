import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const BACKUP_ENTRY = 'rss-reader-backup.json';
const MANIFEST_ENTRY = 'manifest.json';
const README_ENTRY = 'README.txt';

export interface BackupArchiveManifest {
  format: 'rss-reader-backup';
  version: 1;
  createdAt: string;
}

/** Build a compressed ZIP containing the JSON backup and a small manifest. */
export function createBackupArchive(json: string): Uint8Array {
  const manifest: BackupArchiveManifest = {
    format: 'rss-reader-backup',
    version: 1,
    createdAt: new Date().toISOString(),
  };
  return zipSync(
    {
      [BACKUP_ENTRY]: strToU8(json),
      [MANIFEST_ENTRY]: strToU8(JSON.stringify(manifest, null, 2)),
      [README_ENTRY]: strToU8(
        [
          'RSS Reader backup',
          '',
          'rss-reader-backup.json contains subscriptions, groups, read/starred state,',
          'rules, preferences and cached articles. Import the ZIP from RSS Reader;',
          'there is no need to extract it manually.',
          '',
        ].join('\n')
      ),
    },
    { level: 6 }
  );
}

/** True for a ZIP local-file header. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/** Read the JSON backup out of a ZIP produced by createBackupArchive. */
export function readBackupArchive(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const name =
    files[BACKUP_ENTRY] !== undefined
      ? BACKUP_ENTRY
      : Object.keys(files).find(
          (entry) => entry.endsWith('.json') && entry !== MANIFEST_ENTRY
        );
  if (!name) throw new Error('That ZIP does not contain an RSS Reader backup.');
  return strFromU8(files[name]);
}
