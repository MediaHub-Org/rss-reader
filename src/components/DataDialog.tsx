import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feed } from '../types';
import {
  byName,
  downloadBinaryFile,
  downloadFile,
  exportFullBackup,
  exportOpml,
  importSubscriptions,
  ImportError,
  type ImportResult,
  type SaveOutcome,
} from '../lib/portability';
import { loadAllArticles } from '../lib/storage';
import { applyImport } from '../lib/applyImport';
import { createBackupArchive, looksLikeZip, readBackupArchive } from '../lib/backupArchive';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Dialog } from './Dialog';
import { plural, t } from '../lib/i18n';
import { SourcesManager, GroupsManager } from './settings/CollectionManagers';

export type DataTab = 'import' | 'export' | 'manage';

interface DataDialogProps {
  open: boolean;
  initialTab?: DataTab;
  onClose: () => void;
}

export function DataDialog({ open, initialTab = 'import', onClose }: DataDialogProps) {
  const state = useStore();
  const [tab, setTab] = useState<DataTab>(initialTab);
  const [pending, setPending] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manageTab, setManageTab] = useState<'feeds' | 'folders'>('feeds');
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-open on the tab the user asked for (Import / Export / Manage buttons).
  // Deliberately does not depend on state.feeds: a background refresh replaces
  // that array, and re-running here would wipe whatever is being edited.
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setManageTab('feeds');
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  const close = () => {
    setPending(null);
    setError(null);
    onClose();
  };

  /** Folders A–Z (including empty ones) with feeds A–Z, then ungrouped feeds. */
  const { folders } = useMemo(() => {
    const byTitle = (a: Feed, b: Feed) => byName(a.title, b.title);
    const grouped = new Map<string, Feed[]>();
    const loose: Feed[] = [];

    for (const name of state.folders) grouped.set(name, grouped.get(name) ?? []);
    for (const feed of state.feeds) {
      const folder = feed.folder?.trim();
      if (!folder) {
        loose.push(feed);
        continue;
      }
      grouped.set(folder, [...(grouped.get(folder) ?? []), feed]);
    }

    const folderList = [...grouped.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, feeds]) => ({ name, feeds: feeds.sort(byTitle) }));

    return { folders: folderList, ungrouped: loose.sort(byTitle) };
  }, [state.feeds, state.folders]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPending(null);
    setError(null);

    const looksLikeBackup = /\.(json|zip)$/i.test(file.name);
    if (file.size > 5 * 1024 * 1024) {
      if (!looksLikeBackup || file.size > 250 * 1024 * 1024) {
        setError(
          looksLikeBackup
            ? t('That backup is larger than 250 MB — it cannot be restored in one piece.')
            : t('That file is larger than 5 MB — it is probably not an OPML file.')
        );
        return;
      }
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = looksLikeZip(bytes)
        ? readBackupArchive(bytes)
        : new TextDecoder().decode(bytes);
      setPending(importSubscriptions(text));
    } catch (err) {
      setError(
        err instanceof ImportError
          ? err.message
          : t('That ZIP is not a valid RSS Reader backup.')
      );
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    try {
      const result = await applyImport(pending);
      store.notify(result.changed ? 'success' : 'info', result.message);
      close();
    } catch {
      store.notify('error', t('Could not apply that backup.'));
    }
  };

  const doExport = async (kind: 'opml' | 'json') => {
    try {
      let outcome: SaveOutcome;
      if (kind === 'opml') {
        outcome = await downloadFile(
          'rss-reader-subscriptions.opml',
          exportOpml(state.feeds, state.folders),
          'text/x-opml+xml'
        );
      } else {
        store.notify('info', t('Preparing full backup…'));
        const articles = await loadAllArticles();
        const json = exportFullBackup(
          state.feeds,
          state.readIds,
          state.folders,
          state.prefs,
          articles,
          state.starredIds,
          state.rules
        );
        outcome = await downloadBinaryFile(
          'rss-reader-backup.zip',
          createBackupArchive(json),
          'application/zip'
        );
      }
      if (outcome === 'cancelled') {
        store.notify('info', t('Export cancelled'));
        return;
      }
      if (outcome === 'error') {
        store.notify('error', t('Could not save the export file.'));
        return;
      }
      store.notify('success', t(kind === 'opml' ? 'OPML exported' : 'Full backup exported'));
    } catch {
      store.notify('error', t('Export failed.'));
    }
  };

  const totalFolderCount = folders.length;
  const hasAnything = state.feeds.length > 0 || totalFolderCount > 0;
  const pendingArticleCount = pending
    ? Object.values(pending.articles ?? {}).reduce((sum, list) => sum + list.length, 0)
    : 0;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('Subscriptions & data')}
      size="md"
    >
      <div className="tabs" role="tablist" aria-label={t('Subscriptions and OPML')}>
        <button
          type="button"
          role="tab"
          id="tab-import"
          aria-selected={tab === 'import'}
          aria-controls="panel-import"
          className={`tab ${tab === 'import' ? 'is-active' : ''}`}
          onClick={() => setTab('import')}
        >
          {t('Import')}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-export"
          aria-selected={tab === 'export'}
          aria-controls="panel-export"
          className={`tab ${tab === 'export' ? 'is-active' : ''}`}
          onClick={() => setTab('export')}
        >
          {t('Export')}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-manage"
          aria-selected={tab === 'manage'}
          aria-controls="panel-manage"
          className={`tab ${tab === 'manage' ? 'is-active' : ''}`}
          onClick={() => setTab('manage')}
        >
          {t('Manage ({count})', { count: state.feeds.length })}
        </button>
      </div>

      {tab === 'import' && (
        <div id="panel-import" role="tabpanel" aria-labelledby="tab-import" className="tab-panel">
          <p className="field__hint">
            {t('Choose an OPML file from another reader, or a JSON/ZIP backup exported from this app. Folders and links are sorted A–Z, and edited titles/folders update existing feeds automatically.')}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".opml,.xml,.json,.zip,application/xml,text/xml,application/json,application/zip"
            className="file-input"
            aria-label={t('Choose OPML or JSON file')}
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />

          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}

          {pending && (
            <div className="import-preview">
              <p className="import-preview__summary">
                <strong>{pending.feeds.length}</strong>{' '}
                {t(
                  pending.feeds.length === 1
                    ? 'feed found in a {format} file'
                    : 'feeds found in a {format} file',
                  { format: pending.format.toUpperCase() }
                )}
                {pending.folders.length
                  ? ` ${t('across {label}', {
                      label: plural(pending.folders.length, '{count} folder', '{count} folders'),
                    })}`
                  : ''}
                {pending.readIds
                  ? ` · ${plural(Object.keys(pending.readIds).length, '{count} read entry', '{count} read entries')}`
                  : ''}
                {pendingArticleCount
                  ? ` · ${plural(pendingArticleCount, '{count} cached article', '{count} cached articles')}`
                  : ''}
                {pending.preferences ? ` · ${t('preferences')}` : ''}.
              </p>

              <ul className="import-preview__list">
                {pending.feeds.slice(0, 8).map((feed) => (
                  <li key={feed.url}>
                    {feed.folder ? `${feed.folder} › ` : ''}
                    {feed.title || feed.url}
                  </li>
                ))}
                {pending.feeds.length > 8 && (
                  <li className="is-more">{t('+{count} more', { count: pending.feeds.length - 8 })}</li>
                )}
                {!pending.feeds.length &&
                  pending.folders.slice(0, 8).map((folder) => (
                    <li key={`folder:${folder}`}>{folder} {t('(empty folder)')}</li>
                  ))}
              </ul>

              {pending.warnings.length > 0 && (
                <ul className="import-preview__warnings">
                  {pending.warnings.slice(0, 5).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <div className="import-preview__actions">
                <button type="button" className="button button--ghost" onClick={() => setPending(null)}>
                  {t('Cancel')}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void confirmImport()}
                  disabled={!pending.feeds.length && !pending.folders.length}
                >
                  {t('Import {label}', {
                    label: pending.feeds.length
                      ? plural(pending.feeds.length, '{count} feed', '{count} feeds')
                      : plural(pending.folders.length, '{count} folder', '{count} folders'),
                  })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div id="panel-export" role="tabpanel" aria-labelledby="tab-export" className="tab-panel">
          <p className="field__hint">
            {t('OPML is the standard format every reader understands — subscriptions and folders (sorted A–Z, including empty folders).')}
            <br />
            {t('ZIP backup also carries read/starred status, rules, preferences and every cached article, so this device can be rebuilt elsewhere (the YouTube API key is not included).')}
          </p>

          <div className="export-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => doExport('opml')}
              disabled={!hasAnything}
            >
              {t('Export OPML')}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void doExport('json')}
              disabled={!hasAnything}
            >
              {t('Export full backup (ZIP)')}
            </button>
          </div>
        </div>
      )}

      {tab === 'manage' && (
        <div
          id="panel-manage"
          role="tabpanel"
          aria-labelledby="tab-manage"
          className="tab-panel"
        >
          {!hasAnything ? (
            <p className="field__hint">{t('No feeds subscribed yet.')}</p>
          ) : (
            <>
              <div className="manage-subtabs" role="tablist" aria-label={t('Manage subscriptions')}>
                <button
                  type="button"
                  role="tab"
                  id="manage-tab-feeds"
                  aria-selected={manageTab === 'feeds'}
                  aria-controls="manage-feeds"
                  className={`manage-subtab ${manageTab === 'feeds' ? 'is-active' : ''}`}
                  onClick={() => setManageTab('feeds')}
                >
                  {t('Sources ({count})', { count: state.feeds.length })}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="manage-tab-folders"
                  aria-selected={manageTab === 'folders'}
                  aria-controls="manage-folders"
                  className={`manage-subtab ${manageTab === 'folders' ? 'is-active' : ''}`}
                  onClick={() => setManageTab('folders')}
                >
                  {t('Groups ({count})', { count: totalFolderCount })}
                </button>
              </div>

              {manageTab === 'feeds' ? (
                <SourcesManager idPrefix="manage" />
              ) : (
                <GroupsManager idPrefix="manage" />
              )}
            </>
          )}
        </div>
      )}

    </Dialog>
  );
}
