import { useState } from 'react';
import { store } from '../store/store';
import { Dialog } from './Dialog';

interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
}

const SUGGESTIONS = [
  { label: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { label: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { label: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'NASA', url: 'https://www.nasa.gov/feed/' },
];

export function AddFeedDialog({ open, onClose }: AddFeedDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (raw: string) => {
    if (busy) return;
    const url = raw.trim();
    if (!url) {
      setError('Enter a feed URL.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await store.addFeed(url);
    setBusy(false);

    if (result.ok) {
      setValue('');
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
      title="Add feed"
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit(value)}
            disabled={busy || !value.trim()}
          >
            {busy ? 'Checking…' : 'Subscribe'}
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
          <span className="field__label">Feed URL</span>
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
            Paste a feed URL, or a website address — the feed is discovered automatically.
          </p>
        )}
      </form>

      <div className="suggestions">
        <p className="suggestions__title">Popular feeds</p>
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
