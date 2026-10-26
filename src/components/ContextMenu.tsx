import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconProps } from './Icon';

export interface ContextMenuItem {
  /** A plain label row renders a muted, non-interactive section heading. */
  type?: 'action' | 'label' | 'divider';
  label?: string;
  icon?: IconProps['name'];
  checked?: boolean;
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
 * closes on an outside click/Escape or after an item is chosen. Built here
 * rather than reusing Dropdown -- Dropdown is anchored to its own trigger
 * button, this has no trigger, it's summoned at the cursor.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, clampedX), y: Math.max(8, clampedY) });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, index) => {
        if (item.type === 'divider') return <div className="context-menu__divider" key={index} />;
        if (item.type === 'label') {
          return (
            <div className="context-menu__label" key={index}>
              {item.label}
            </div>
          );
        }
        return (
          <button
            type="button"
            className="context-menu__item"
            role="menuitem"
            key={index}
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
}
