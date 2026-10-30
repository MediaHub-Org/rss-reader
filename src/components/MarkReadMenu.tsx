import { useEffect, useMemo, useRef, useState } from 'react';
import { store, selectArticles } from '../store/store';
import { useStore } from '../hooks/useStore';
import { countLabel } from '../lib/format';
import { articlesToMarkRead } from '../lib/markRead';
import { Icon } from './Icon';

const OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'All articles' },
  { days: 1, label: 'Older than 1 day' },
  { days: 3, label: 'Older than 3 days' },
  { days: 7, label: 'Older than 7 days' },
];

/** Split control: the check button marks the visible list; the caret offers date cutoffs. */
export function MarkReadMenu() {
  const state = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const visible = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        filter: state.prefs.articleFilter,
        caseSensitive: state.prefs.searchCaseSensitive,
        fullText: state.prefs.searchFullText,
        searchAll: state.ui.searchAllFeeds,
      }),
    [state]
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const mark = (days: number) => {
    const ids = articlesToMarkRead(visible, state.readIds, days);
    if (!ids.length) {
      store.notify('info', 'Nothing to mark as read');
    } else {
      store.setRead(ids, true);
      store.notify('success', `Marked ${countLabel(ids.length, 'article')} as read`);
    }
    setOpen(false);
  };

  const unread = visible.filter((article) => !state.readIds[article.id]).length;

  return (
    <div className="mark-read" ref={rootRef}>
      <button
        type="button"
        className="icon-button"
        onClick={() => mark(0)}
        disabled={!unread}
        aria-label="Mark all visible articles as read"
        title="Mark all visible as read"
      >
        <Icon name="check" />
      </button>
      <button
        type="button"
        ref={triggerRef}
        className="icon-button mark-read__caret"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mark as read options"
        title="Mark as read…"
      >
        <Icon name="chevronDown" size={13} />
      </button>

      {open && (
        <div className="view-menu mark-read__menu" role="menu" aria-label="Mark as read">
          <p className="view-menu__section">Mark as read</p>
          {OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              role="menuitem"
              className="view-menu__item view-menu__item--plain"
              onClick={() => mark(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
