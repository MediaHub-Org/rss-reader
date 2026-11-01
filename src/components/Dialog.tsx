import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { t } from '../lib/i18n';

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
  /** Render the children directly, without the dialog header/body chrome. */
  bare?: boolean;
  /** Accessible label when `bare` is set (there is no visible title). */
  ariaLabel?: string;
  className?: string;
  backdropClassName?: string;
  /**
   * Extra nodes placed inside the backdrop but outside the panel (for example
   * the reader's previous/next arrows). They take part in the focus cycle.
   */
  backdropChildren?: ReactNode;
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
  bare = false,
  ariaLabel,
  className = '',
  backdropClassName = '',
  backdropChildren,
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
    (focusable ?? panel)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) return;
      // A stacked dialog (folder picker, confirmation) owns Escape and Tab.
      // Both panels listen on document, so without this check one Escape
      // would close the picker and the dialog underneath it.
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (event.key === 'Escape') {
        // A context menu opened inside a dialog handles its own Escape; let
        // it bubble instead of closing the whole dialog too.
        if (document.querySelector('.context-menu')) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      // Include backdrop-level controls (reader arrows) in the cycle.
      const scope = panel.parentElement ?? panel;
      const items = Array.from(
        scope.querySelectorAll<HTMLElement>(
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
    // Save the app's real scroll containers. Hiding their overflow can move
    // the background by a pixel or two on some WebViews; restoring the exact
    // offsets keeps the list where the user left it.
    const scrollPositions = new Map<HTMLElement, number>();
    document
      .querySelectorAll<HTMLElement>('.content-area, .sidebar__scroll')
      .forEach((element) => scrollPositions.set(element, element.scrollTop));
    // The app scrolls inside .content-area and .sidebar__scroll, not on the
    // body, so locking the body alone left the background scrolling under the
    // dialog. The attribute is what the stylesheet hooks onto; `wasLocked`
    // keeps a stacked dialog from unlocking while an outer one is still open.
    const wasLocked = document.body.dataset.scrollLocked === 'true';
    document.body.dataset.scrollLocked = 'true';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      scrollPositions.forEach((top, element) => {
        element.scrollTop = top;
      });
      if (!wasLocked) delete document.body.dataset.scrollLocked;
      restoreTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`dialog-backdrop ${backdropClassName}`.trim()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog dialog--${size} ${bare ? 'dialog--bare' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare ? undefined : titleId}
        aria-label={bare ? ariaLabel : undefined}
        ref={panelRef}
        tabIndex={-1}
      >
        {bare ? (
          children
        ) : (
          <>
            <header className="dialog__header">
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close dialog')}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div className="dialog__body">{children}</div>
          </>
        )}
        {footer ? <footer className="dialog__footer">{footer}</footer> : null}
      </div>
      {backdropChildren}
    </div>
  );
}
