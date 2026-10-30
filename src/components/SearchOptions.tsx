import { useEffect, useRef, useState } from 'react';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Icon } from './Icon';

/** Case/full-text options attached to the sidebar search field. */
export function SearchOptions() {
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

  return (
    <div className="search-options-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`search__options ${open ? 'is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Search options"
        title="Search options"
      >
        Aa
      </button>

      {open && (
        <div className="search-options" role="menu" aria-label="Search options">
          <p className="view-menu__section">Search</p>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.prefs.searchCaseSensitive}
            className="view-menu__item"
            onClick={() =>
              store.setPreferences({
                searchCaseSensitive: !state.prefs.searchCaseSensitive,
              })
            }
          >
            <span className="view-menu__check">
              {state.prefs.searchCaseSensitive && <Icon name="check" size={15} />}
            </span>
            <span>Case sensitive</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.prefs.searchFullText}
            className="view-menu__item"
            onClick={() =>
              store.setPreferences({
                searchFullText: !state.prefs.searchFullText,
              })
            }
          >
            <span className="view-menu__check">
              {state.prefs.searchFullText && <Icon name="check" size={15} />}
            </span>
            <span>Search in full text</span>
          </button>
        </div>
      )}
    </div>
  );
}
