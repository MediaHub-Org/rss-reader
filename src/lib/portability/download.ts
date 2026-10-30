/**
 * Text-file export. In the browser this triggers a download; in the desktop
 * shell it opens the native Save dialog. The outcome distinguishes a user
 * cancellation from an actual write error.
 */
import { isDesktopApp, saveTextFile, type SaveOutcome } from '../desktop';

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
