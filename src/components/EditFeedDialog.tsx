import { useEffect, useState } from 'react';
import type { Feed } from '../types';
import { store } from '../store/store';
import { Dialog } from './Dialog';
import { t } from '../lib/i18n';

interface EditFeedDialogProps {
  open: boolean;
  feed: Feed | null;
  folders: string[];
  onClose: () => void;
}

/** Edit a feed's name, group and source URL from one place. */
export function EditFeedDialog({ open, feed, folders, onClose }: EditFeedDialogProps) {
  const [name, setName] = useState(feed?.title ?? '');
  const [url, setUrl] = useState(feed?.url ?? '');
  const [folder, setFolder] = useState(feed?.folder ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !feed) return;
    setName(feed.title);
    setUrl(feed.url);
    setFolder(feed.folder ?? '');
    setError(null);
    setBusy(false);
  }, [open, feed]);

  const submit = async () => {
    if (!feed || busy) return;
    setBusy(true);
    setError(null);
    const result = await store.updateFeed(feed.id, { title: name, url, folder });
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? t('Could not update that feed.'));
      return;
    }
    onClose();
  };

  const urlChanged = Boolean(feed && url.trim() && url.trim() !== feed.url);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Edit feed')}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={busy || !name.trim() || !url.trim()}
          >
            {busy ? t('Saving…') : t('Save changes')}
          </button>
        </>
      }
    >
      <form
        className="edit-feed-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span className="field__label">{t('Feed name')}</span>
          <input
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            autoFocus
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span className="field__label">{t('Group')}</span>
          <input
            className="input"
            list="edit-feed-folders"
            value={folder}
            placeholder={t('Ungrouped')}
            onChange={(event) => setFolder(event.target.value)}
            spellCheck={false}
          />
          <datalist id="edit-feed-folders">
            {folders.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>

        <label className="field">
          <span className="field__label">{t('Feed link')}</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        {urlChanged && (
          <p className="field__hint">
            {t('Changing the feed link clears this source’s cached articles and read state, then reloads it from the new URL.')}
          </p>
        )}

        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
