import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { t } from '../lib/i18n';

interface CreateFolderDialogProps {
  open: boolean;
  /** Present when the folder is created from a feed's “New folder…” action. */
  feedTitle?: string;
  onClose: () => void;
  /** Return an error message to keep the dialog open. */
  onCreate: (name: string) => string | null;
}

/** Themed prompt for a new group, instead of an inline input in the sidebar. */
export function CreateFolderDialog({ open, feedTitle, onClose, onCreate }: CreateFolderDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('Folder name cannot be empty.'));
      return;
    }
    const message = onCreate(trimmed);
    if (message) {
      setError(message);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={feedTitle ? `New folder for “${feedTitle}”` : 'New folder'}
      size="sm"
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="button button--primary" onClick={submit}>
            {t('Create folder')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span className="field__label">{t('Folder name')}</span>
          <input
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder={t('e.g. Technology')}
            autoComplete="off"
            data-autofocus
          />
        </label>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
