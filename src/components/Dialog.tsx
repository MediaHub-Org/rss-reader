import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra class for sizing (wide dialogs for settings/import). */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Yield Escape/Tab handling to a dialog stacked on top of this one. Without
   * it, two open dialogs both listen on `document` and one Escape would close
   * both, and each would fight over the Tab cycle.
   */
  suspended?: boolean;
}

/**
 * Accessible modal dialog: role=dialog, aria-labelledby, focus moved in on open
 * and restored on close, Escape to dismiss, Tab cycled inside the dialog.
 *
 * The lifecycle effect deliberately depends only on `open`: `onClose` is often
 * an inline function that gets a new identity on every parent render. Keeping
 * it in the dependency list made the effect re-run (and steal focus back to
 * the first control) while typing in an input or textarea.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'sm',
  suspended = false,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const suspendedRef = useRef(suspended);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusable =
      panel?.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ??
      panel
        ?.querySelector('.dialog__body, .dialog__footer')
        ?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
        ) ??
      panel?.querySelector<HTMLElement>(
        'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
      );
    (focusable ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="dialog__header">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer ? <footer className="dialog__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
