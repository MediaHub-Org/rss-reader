import { useEffect, useState } from 'react';
import {
  autoBackupsAvailable,
  createAutoBackup,
  deleteAutoBackup,
  listAutoBackups,
  readAutoBackup,
  type AutoBackupInfo,
  type AutoBackupList,
} from '../lib/backups';
import { applyImport } from '../lib/applyImport';
import { ImportError, importSubscriptions } from '../lib/portability';
import { formatBytes, formatDate } from '../lib/format';
import { store } from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { t } from '../lib/i18n';

interface BackupsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Confirm =
  | { kind: 'restore'; item: AutoBackupInfo }
  | { kind: 'delete'; item: AutoBackupInfo };

export function BackupsDialog({ open, onClose }: BackupsDialogProps) {
  const available = autoBackupsAvailable();
  const [list, setList] = useState<AutoBackupList>({ directory: '', items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setList(await listAutoBackups());
      setError(null);
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !available) return;
    void load();
    // Load once per opening; the list is refreshed after every action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, available]);

  const backupNow = async () => {
    setBusy('backup');
    try {
      const info = await createAutoBackup();
      store.notify('success', `Backup created (${formatBytes(info.bytes)})`);
      await load();
    } catch (err) {
      store.notify('error', String((err as Error)?.message || 'Could not create the backup.'));
    } finally {
      setBusy(null);
    }
  };

  const applyConfirm = async () => {
    if (!confirm) return;
    const { kind, item } = confirm;
    setConfirm(null);
    setBusy(kind);

    try {
      if (kind === 'delete') {
        await deleteAutoBackup(item.name);
        store.notify('success', 'Backup deleted');
        await load();
        return;
      }

      const text = await readAutoBackup(item.name);
      const parsed = importSubscriptions(text);
      const result = await applyImport(parsed, { replace: true });
      store.notify(result.changed ? 'success' : 'info', result.message);
      onClose();
    } catch (err) {
      store.notify(
        'error',
        err instanceof ImportError
          ? err.message
          : kind === 'restore'
            ? t('Could not restore that backup.')
            : t('Could not delete that backup.')
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmCopy = (() => {
    if (!confirm) return null;
    const when = formatDate(confirm.item.createdAt);
    return confirm.kind === 'restore'
      ? {
          title: t('Restore this backup?'),
          message: `This replaces your current feeds, read state, preferences and cached articles with the snapshot from ${when}. This cannot be undone.`,
          label: t('Restore'),
        }
      : {
          title: t('Delete this backup?'),
          message: `The snapshot from ${when} will be removed from disk. This cannot be undone.`,
          label: t('Delete'),
        };
  })();

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={t('Backups')}
        size="md"
        suspended={confirm !== null}
        footer={
          <>
            <button type="button" className="button button--ghost" onClick={onClose} disabled={busy !== null}>
              {t('Close')}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void backupNow()}
              disabled={!available || busy !== null}
            >
              {busy === 'backup' ? t('Backing up…') : t('Back up now')}
            </button>
          </>
        }
      >
        {!available ? (
          <p className="field__hint">
            {t('Automatic snapshots are part of the desktop app. In the browser/PWA, use Export full backup in the Data dialog to save one manually.')}
          </p>
        ) : (
          <>
            <p className="field__hint">
              {t('The desktop app keeps the last 7 daily snapshots — subscriptions, read state, preferences and cached articles. They stay on this device.')}
            </p>
            {list.directory && (
              <p className="backup-path">
                Folder: <code>{list.directory}</code>
              </p>
            )}

            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}

            {loading ? (
              <p className="backup-empty">{t('Loading backups…')}</p>
            ) : list.items.length === 0 ? (
              <p className="backup-empty">{t('No snapshots yet.')}</p>
            ) : (
              <ul className="backup-list">
                {list.items.map((item) => (
                  <li className="backup-row" key={item.name}>
                    <div className="backup-row__meta">
                      <strong>{formatDate(item.createdAt)}</strong>
                      <span>{formatBytes(item.bytes)}</span>
                    </div>
                    <div className="backup-row__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setConfirm({ kind: 'restore', item })}
                        disabled={busy !== null}
                      >
                        {t('Restore')}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--danger-text"
                        onClick={() => setConfirm({ kind: 'delete', item })}
                        disabled={busy !== null}
                        aria-label={`Delete backup from ${formatDate(item.createdAt)}`}
                      >
                        {t('Delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm !== null && confirmCopy !== null}
        title={confirmCopy?.title ?? ''}
        message={confirmCopy?.message ?? ''}
        confirmLabel={confirmCopy?.label}
        onConfirm={() => void applyConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
