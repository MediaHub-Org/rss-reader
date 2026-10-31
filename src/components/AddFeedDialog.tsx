import { useEffect, useMemo, useState } from 'react';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { byName } from '../lib/portability';
import { Dialog } from './Dialog';
import { t } from '../lib/i18n';

interface AddFeedDialogProps {
  open: boolean;
  /** Preselect a folder (e.g. “Add feed” from a folder's context menu). */
  initialFolder?: string;
  onClose: () => void;
}

const SUGGESTIONS = [
  { label: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { label: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { label: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'NASA', url: 'https://www.nasa.gov/feed/' },
  { label: 'El Mundo', url: 'https://estaticos.elmundo.es/elmundo/rss/portada.xml' },
  { label: 'Euronews', url: 'https://www.euronews.com/rss' },
  { label: 'The Next Web', url: 'https://feeds2.feedburner.com/thenextweb' },
  { label: 'NASA APOD', url: 'https://apod.nasa.gov/apod.rss' },
  { label: 'Veritasium', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA' },
];

export function AddFeedDialog({ open, initialFolder, onClose }: AddFeedDialogProps) {
  const state = useStore();
  const [value, setValue] = useState('');
  const [folder, setFolder] = useState(initialFolder ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start each visit clean, seeded with the folder the dialog was opened from.
  useEffect(() => {
    if (!open) return;
    setValue('');
    setFolder(initialFolder ?? '');
    setError(null);
  }, [open, initialFolder]);

  const folders = useMemo(
    () =>
      [
        ...new Set([
          ...state.folders,
          ...state.feeds.map((f) => f.folder?.trim()).filter(Boolean) as string[],
        ]),
      ].sort(byName),
    [state.feeds, state.folders]
  );

  const submit = async (raw: string) => {
    if (busy) return;
    const url = raw.trim();
    if (!url) {
      setError(t('Enter a feed URL.'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await store.addFeed(url, folder);
    setBusy(false);

    if (result.ok) {
      setValue('');
      setFolder('');
      store.notify('success', result.message || 'Subscribed');
      onClose();
    } else {
      setError(result.message || 'Could not add that feed.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Add feed')}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit(value)}
            disabled={busy || !value.trim()}
          >
            {busy ? t('Checking…') : t('Subscribe')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(value);
        }}
      >
        <label className="field">
          <span className="field__label">{t('Feed URL')}</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://example.com/feed.xml"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'add-feed-error' : 'add-feed-hint'}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        {error ? (
          <p className="field__error" id="add-feed-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="field__hint" id="add-feed-hint">
            {t('Paste a feed URL, or a website address — the feed is discovered automatically.')}
          </p>
        )}

        <label className="field">
          <span className="field__label">{t('Folder (optional)')}</span>
          <input
            className="input"
            type="text"
            list="feed-folder-options"
            placeholder={t('e.g. Tech, News — or leave blank')}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            spellCheck={false}
          />
          <datalist id="feed-folder-options">
            {folders.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </form>

      <div className="suggestions">
        <p className="suggestions__title">{t('Popular feeds')}</p>
        <div className="suggestions__list">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.url}
              type="button"
              className="chip chip--button"
              onClick={() => void submit(suggestion.url)}
              disabled={busy}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
