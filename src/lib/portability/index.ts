/**
 * Import/export façade.
 *
 * OPML is the standard subscription format; the JSON backup additionally
 * carries read state, preferences and cached articles. Format detection is
 * content-based: XML → OPML, `{` → JSON backup.
 */
import { parseJsonBackup } from './backup';
import { parseOpml } from './opml';
import { ImportError, type ImportResult } from './types';

export * from './types';
export { exportOpml } from './opml';
export { exportFullBackup } from './backup';
export { downloadFile } from './download';
export type { SaveOutcome } from '../desktop';

export function importSubscriptions(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) throw new ImportError('That file is empty.');

  if (trimmed.startsWith('{')) return parseJsonBackup(trimmed);
  if (trimmed.startsWith('<')) return parseOpml(trimmed);

  throw new ImportError('Unsupported file — expected an OPML or JSON backup.');
}
