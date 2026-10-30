import { useEffect, useRef, useState } from 'react';
import type { ArticleFilter, ArticleView } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Icon } from './Icon';

const VIEWS: Array<{ value: ArticleView; label: string; icon: 'grid' | 'list' | 'magazine' | 'compact' }> = [
  { value: 'card', label: 'Card view', icon: 'grid' },
  { value: 'list', label: 'List view', icon: 'list' },
  { value: 'magazine', label: 'Magazine view', icon: 'magazine' },
  { value: 'compact', label: 'Compact view', icon: 'compact' },
];

const FILTERS: Array<{ value: ArticleFilter; label: string; icon: 'inbox' | 'eye' | 'star' }> = [
  { value: 'all', label: 'All articles', icon: 'inbox' },
  { value: 'unread', label: 'Unread only', icon: 'eye' },
  { value: 'starred', label: 'Starred only', icon: 'star' },
];

/** Top-bar View / Filtering menu, modelled on Fluent Reader's View menu. */
export function ViewMenu() {
  const state = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const view = VIEWS.find((entry) => entry.value === state.prefs.viewMode) ?? VIEWS[0];
  const filter = FILTERS.find((entry) => entry.value === state.prefs.articleFilter) ?? FILTERS[0];

  const chooseView = (value: ArticleView) => {
    store.setPreferences({ viewMode: value });
    setOpen(false);
  };
  const chooseFilter = (value: ArticleFilter) => {
    store.setPreferences({ articleFilter: value });
    setOpen(false);
  };

  return (
    <div className="view-menu-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-button topbar__view"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="View and filter articles"
        title={`${view.label} · ${filter.label}`}
      >
        <Icon name={view.icon} size={17} />
      </button>

      {open && (
        <div className="view-menu" role="menu" aria-label="View and filtering">
          <p className="view-menu__section">View</p>
          {VIEWS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={state.prefs.viewMode === entry.value}
              className="view-menu__item"
              onClick={() => chooseView(entry.value)}
            >
              <span className="view-menu__check">
                {state.prefs.viewMode === entry.value && <Icon name="check" size={15} />}
              </span>
              <Icon name={entry.icon} size={16} className="view-menu__icon" />
              <span>{entry.label}</span>
            </button>
          ))}

          <div className="view-menu__divider" role="separator" />
          <p className="view-menu__section">Filtering</p>
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={state.prefs.articleFilter === entry.value}
              className="view-menu__item"
              onClick={() => chooseFilter(entry.value)}
            >
              <span className="view-menu__check">
                {state.prefs.articleFilter === entry.value && <Icon name="check" size={15} />}
              </span>
              <Icon name={entry.icon} size={16} className="view-menu__icon" />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
