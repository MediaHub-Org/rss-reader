/**
 * Text-file export. In the browser this triggers a download; in the desktop
 * shell it opens the native Save dialog. The outcome distinguishes a user
 * cancellation from an actual write error.
 */
import { isDesktopApp, saveBinaryFile, saveTextFile, type SaveOutcome } from '../desktop';

export async function downloadFile(
  filename: string,
  contents: string,
  mime: string
): Promise<SaveOutcome> {
  if (isDesktopApp()) return saveTextFile(filename, contents);

  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return 'saved';
}

/** Binary sibling of downloadFile, used for compressed backups. */
export async function downloadBinaryFile(
  filename: string,
  contents: Uint8Array,
  mime: string
): Promise<SaveOutcome> {
  if (isDesktopApp()) return saveBinaryFile(filename, contents);

  const blob = new Blob([contents as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return 'saved';
}
