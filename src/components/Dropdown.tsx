import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface DropdownProps<T extends string> {
  value: T;
  options: Array<DropdownOption<T>>;
  onChange: (value: T) => void;
  /** Accessible name for the trigger. */
  label: string;
  /** Optional leading icon inside the trigger. */
  icon?: ReactNode;
  triggerTitle?: string;
  className?: string;
}

/**
 * Themed listbox dropdown.
 *
 * Replaces the native <select>: the OS-rendered popup and arrow ignore CSS
 * variables, so the menu could never match the light/dark theme. This version
 * inherits the design tokens and keeps native-quality keyboard support —
 * ArrowUp/Down, Home/End, Enter/Space, Escape, Tab, and outside-click to close,
 * with focus returned to the trigger.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  triggerTitle,
  className = '',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options[selectedIndex] ?? options[0];

  const openMenu = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    closeMenu();
  };

  /* close on outside pointer-down or Escape, whatever holds focus */
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

  /* keep the active option visible when the menu opens or changes */
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
    listRef.current?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(selectedIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(options.length - 1);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        closeMenu();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className={`dropdown ${className}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="dropdown__trigger"
        title={triggerTitle ?? label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${baseId}-listbox` : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
      >
        {icon}
        <span className="dropdown__value">{selected?.label}</span>
        <Icon name="chevronDown" size={14} className="dropdown__caret" />
      </button>

      {open && (
        <ul
          className="dropdown__menu"
          role="listbox"
          id={`${baseId}-listbox`}
          aria-label={label}
          ref={listRef}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${baseId}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`dropdown__option ${index === activeIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              <span className="dropdown__option-label">
                {option.label}
                {option.hint && <small>{option.hint}</small>}
              </span>
              {option.value === value && <Icon name="check" size={15} className="dropdown__check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
