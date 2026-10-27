import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconProps } from './Icon';

export interface ContextMenuItem {
  /** A plain label row renders a muted, non-interactive section heading. */
  type?: 'action' | 'label' | 'divider';
  label?: string;
  icon?: IconProps['name'];
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A minimal right-click menu: fixed-positioned, clamped to the viewport,
 * closes on an outside click/Escape/user scroll or after an item is chosen.
 *
 * Rendered through a portal to <body> on purpose: a `position: fixed` node
 * inside the mobile sidebar would otherwise be positioned relative to the
 * sidebar (it uses a CSS transform), not the viewport, and the menu would
 * appear at the wrong place.
 *
 * Keyboard: the first enabled item receives focus on open; ArrowUp/Down,
 * Home/End move between items, Enter/Space activate, Escape closes.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [ready, setReady] = useState(false);

  const getItems = () =>
    Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []
    );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, clampedX), y: Math.max(8, clampedY) });
    setReady(true);
  }, [x, y]);

  useEffect(() => {
    // Focus the first item so the menu is usable without a mouse.
    requestAnimationFrame(() => getItems()[0]?.focus());
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      const list = getItems();
      if (!list.length) return;
      const current = list.indexOf(document.activeElement as HTMLButtonElement);

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : list.length - 1) : (current + delta + list.length) % list.length;
        list[next].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        list[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        list[list.length - 1].focus();
      } else if (event.key === 'Tab') {
        // The menu is transient; don't let Tab move focus behind it.
        event.preventDefault();
        onClose();
      }
    };
    const onScrollOrResize = () => onClose();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScrollOrResize);
    // Close on user scrolling, but not on the `scroll` events the browser
    // emits when focusing something (the card, the first menu item): those
    // arrive right after opening and would make the menu flash shut.
    window.addEventListener('wheel', onScrollOrResize, { passive: true });
    window.addEventListener('touchmove', onScrollOrResize, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('wheel', onScrollOrResize);
      window.removeEventListener('touchmove', onScrollOrResize);
    };
  }, [onClose]);

  const menu = (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Context menu"
      style={{ left: pos.x, top: pos.y, visibility: ready ? 'visible' : 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === 'divider') return <div className="context-menu__divider" key={index} role="separator" />;
        if (item.type === 'label') {
          return (
            <div className="context-menu__label" key={index} role="presentation">
              {item.label}
            </div>
          );
        }
        return (
          <button
            type="button"
            className={`context-menu__item ${item.danger ? 'is-danger' : ''}`}
            role="menuitem"
            key={index}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            <span>{item.label}</span>
            {item.checked && <Icon name="check" size={14} className="context-menu__check" />}
          </button>
        );
      })}
    </div>
  );

  return createPortal(menu, document.body);
}
