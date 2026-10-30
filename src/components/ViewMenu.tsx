import { useEffect, useRef, useState } from 'react';
import type { ArticleView } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Icon } from './Icon';

const VIEWS: Array<{ value: ArticleView; label: string; icon: 'grid' | 'list' | 'magazine' | 'compact' }> = [
  { value: 'card', label: 'Card view', icon: 'grid' },
  { value: 'list', label: 'List view', icon: 'list' },
  { value: 'magazine', label: 'Magazine view', icon: 'magazine' },
  { value: 'compact', label: 'Compact view', icon: 'compact' },
];

/** Top-bar layout selector. Filtering has its own sibling menu. */
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

  return (
    <div className="view-menu-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="topbar-tool topbar__view"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${view.label}`}
        title={`View: ${view.label}`}
      >
        <Icon name={view.icon} size={16} />
        <span className="topbar-tool__label">View</span>
        <Icon name="chevronDown" size={12} className="topbar-tool__caret" />
      </button>

      {open && (
        <div className="view-menu" role="menu" aria-label="Article view">
          <p className="view-menu__section">View</p>
          {VIEWS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={state.prefs.viewMode === entry.value}
              className="view-menu__item"
              onClick={() => {
                store.setPreferences({ viewMode: entry.value });
                setOpen(false);
              }}
            >
              <span className="view-menu__check">
                {state.prefs.viewMode === entry.value && <Icon name="check" size={15} />}
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
