import { useEffect, useRef } from 'react';
import { Dialog } from './Dialog';
import { t } from '../lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation prompt used for irreversible actions (unsubscribe, delete folder).
 * Pressing Enter confirms immediately (unless focus was moved to Cancel).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = t('Confirm'),
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (document.activeElement === cancelRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onConfirm]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            className="button button--ghost"
            onClick={onCancel}
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            data-autofocus="true"
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </Dialog>
  );
}
