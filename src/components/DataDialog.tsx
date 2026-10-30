import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feed } from '../types';
import {
  byName,
  downloadFile,
  exportFullBackup,
  exportOpml,
  importSubscriptions,
  ImportError,
  type ExportFeed,
  type ImportResult,
  type SaveOutcome,
} from '../lib/portability';
import { loadAllArticles } from '../lib/storage';
import { countLabel } from '../lib/format';
import { feedIdForUrl } from '../lib/feedParser';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Dialog } from './Dialog';
import { FeedIcon } from './FeedIcon';
import { FolderPickerDialog } from './FolderPickerDialog';
import { Icon } from './Icon';

export type DataTab = 'import' | 'export' | 'manage' | 'xml';

interface DataDialogProps {
  open: boolean;
  initialTab?: DataTab;
  onClose: () => void;
}

interface XmlPreview {
  parsed: ImportResult;
  added: ExportFeed[];
  updated: ExportFeed[];
  removed: Feed[];
  foldersAdded: string[];
  foldersRemoved: string[];
}

type DeleteTarget =
  | { kind: 'feeds'; ids: string[] }
  | { kind: 'folders'; names: string[]; feedCount: number };

/** What a folder-picker dialog was opened for. */
type PickerTarget =
  | { kind: 'feeds'; ids: string[] }
  | { kind: 'folders'; names: string[] };

const OPML_PLACEHOLDER = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My subscriptions</title>
  </head>
  <body>
    <outline text="Tech">
      <outline type="rss" text="The Verge"
        xmlUrl="https://www.theverge.com/rss/index.xml" />
    </outline>
    <!-- A folder with no feeds still round-trips. -->
    <outline text="Empty folder" />
  </body>
</opml>`;

function folderNamesOf(feeds: Feed[], folders: string[]): Set<string> {
  const names = new Set<string>(folders.map((name) => name.trim()).filter(Boolean));
  for (const feed of feeds) {
    const folder = feed.folder?.trim();
    if (folder) names.add(folder);
  }
  return names;
}

export function DataDialog({ open, initialTab = 'import', onClose }: DataDialogProps) {
  const state = useStore();
  const [tab, setTab] = useState<DataTab>(initialTab);
  const [pending, setPending] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [manageTab, setManageTab] = useState<'feeds' | 'folders'>('feeds');
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [xmlText, setXmlText] = useState('');
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [xmlPreview, setXmlPreview] = useState<XmlPreview | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-open on the tab the user asked for (Import / Export / Manage buttons).
  // Deliberately does not depend on state.feeds: a background refresh replaces
  // that array, and re-running here would wipe whatever is being edited.
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setSelectedIds(new Set());
    setSelectedFolders(new Set());
    setManageTab('feeds');
    setPicker(null);
    setPending(null);
    setPendingDelete(null);
    setXmlText(exportOpml(state.feeds, state.folders));
    setXmlError(null);
    setXmlPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  // Seed the XML buffer when switching to the OPML XML tab, not on every
  // feed refresh.
  useEffect(() => {
    if (!open || tab !== 'xml') return;
    setXmlText(exportOpml(state.feeds, state.folders));
    setXmlError(null);
    setXmlPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  // Prune selection if feeds were removed externally.
  useEffect(() => {
    const valid = new Set(state.feeds.map((f) => f.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [state.feeds]);

  /** Apply a confirmed deletion and drop it from the selection. */
  const applyDelete = (target: DeleteTarget) => {
    if (target.kind === 'feeds') {
      store.removeFeeds(target.ids);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of target.ids) next.delete(id);
        return next;
      });
    } else {
      store.removeFolders(target.names);
      setSelectedFolders((prev) => {
        const next = new Set(prev);
        for (const name of target.names) next.delete(name);
        return next;
      });
    }
    setPendingDelete(null);
  };

  // Enter confirms an inline deletion, as in the sidebar's dialog. Native
  // button activation is left alone, so Enter on Cancel still cancels.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      event.preventDefault();
      applyDelete(pendingDelete);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDelete]);

  const close = () => {
    setPending(null);
    setError(null);
    setXmlError(null);
    setXmlPreview(null);
    setPendingDelete(null);
    setSelectedIds(new Set());
    setSelectedFolders(new Set());
    setPicker(null);
    onClose();
  };

  /** Folders A–Z (including empty ones) with feeds A–Z, then ungrouped feeds. */
  const { folders, ungrouped } = useMemo(() => {
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

  // Drop selections for folders that were deleted or renamed elsewhere.
  useEffect(() => {
    const valid = new Set(folders.map((folder) => folder.name));
    setSelectedFolders((prev) => {
      const next = new Set([...prev].filter((name) => valid.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [folders]);

  const deleteSelected = () => {
    if (!selectedIds.size) return;
    setPendingDelete({ kind: 'feeds', ids: [...selectedIds] });
  };

  const deleteSelectedFolders = () => {
    if (!selectedFolders.size) return;
    const names = [...selectedFolders];
    const feedCount = state.feeds.filter((feed) =>
      names.includes(feed.folder?.trim() ?? '')
    ).length;
    setPendingDelete({ kind: 'folders', names, feedCount });
  };

  const confirmDelete = () => {
    if (pendingDelete) applyDelete(pendingDelete);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPending(null);
    setError(null);

    if (file.size > 5 * 1024 * 1024) {
      const looksLikeBackup = /\.json$/i.test(file.name);
      if (!looksLikeBackup || file.size > 250 * 1024 * 1024) {
        setError(
          looksLikeBackup
            ? 'That backup is larger than 250 MB — it cannot be restored in one piece.'
            : 'That file is larger than 5 MB — it is probably not an OPML file.'
        );
        return;
      }
    }

    try {
      const text = await file.text();
      setPending(importSubscriptions(text));
    } catch (err) {
      setError(err instanceof ImportError ? err.message : 'Could not read that file.');
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    const beforeFolders = folderNamesOf(state.feeds, state.folders);
    const addedFolders = pending.folders.filter((name) => !beforeFolders.has(name));
    // A full restore writes its own cached articles right after this; let it
    // win over the background refresh, which would replace them with the
    // (possibly empty) live feed.
    const { added, updated, skipped } = store.importFeeds(pending.feeds, {
      folders: pending.folders,
      skipRefresh: pending.full,
    });
    let readCount = 0;
    if (pending.readIds && Object.keys(pending.readIds).length) {
      store.mergeReadIds(pending.readIds);
      readCount = Object.keys(pending.readIds).length;
    }

    let articleCount = 0;
    if (pending.articles) {
      articleCount = await store.restoreArticles(pending.articles);
    }
    if (pending.preferences) {
      store.setPreferences(pending.preferences);
    }

    const parts: string[] = [];
    if (added) parts.push(`Imported ${countLabel(added, 'feed')}`);
    if (updated) parts.push(`${added ? 'updated' : 'Updated'} ${updated}`);
    if (addedFolders.length) {
      parts.push(`added ${countLabel(addedFolders.length, 'folder')}`);
    }
    if (skipped) parts.push(`skipped ${skipped}`);

    const restored: string[] = [];
    if (readCount) {
      restored.push(countLabel(readCount, 'read entry', 'read entries'));
    }
    if (articleCount) restored.push(countLabel(articleCount, 'cached article'));
    if (pending.preferences) restored.push('preferences');

    const changed = Boolean(added || updated || addedFolders.length || restored.length);
    let message: string;
    if (parts.length && restored.length) {
      message = `${parts.join(', ')} · restored ${restored.join(', ')}`;
    } else if (parts.length) {
      message = parts.join(', ');
    } else if (restored.length) {
      message = `Restored ${restored.join(', ')}`;
    } else {
      message = `Nothing to import — ${countLabel(skipped, 'duplicate')} skipped`;
    }

    store.notify(changed ? 'success' : 'info', message);
    close();
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
        store.notify('info', 'Preparing full backup…');
        const articles = await loadAllArticles();
        outcome = await downloadFile(
          'rss-reader-backup.json',
          exportFullBackup(state.feeds, state.readIds, state.folders, state.prefs, articles),
          'application/json'
        );
      }
      if (outcome === 'cancelled') {
        store.notify('info', 'Export cancelled');
        return;
      }
      if (outcome === 'error') {
        store.notify('error', 'Could not save the export file.');
        return;
      }
      store.notify('success', kind === 'opml' ? 'OPML exported' : 'Full backup exported');
    } catch {
      store.notify('error', 'Export failed.');
    }
  };

  /* ------------------------- Manage selection --------------------------- */

  const selectAll = () => {
    setSelectedIds(new Set(state.feeds.map((f) => f.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const toggleFeed = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolderSelection = (feeds: Feed[]) => {
    const ids = feeds.map((f) => f.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const selectAllFolders = () => {
    setSelectedFolders(new Set(folders.map((folder) => folder.name)));
  };

  const selectNoFolders = () => {
    setSelectedFolders(new Set());
  };

  const toggleFolder = (name: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /** Destination chosen in the folder picker: move feeds, or merge folders. */
  const pickDestination = (folder: string | undefined) => {
    const target = picker;
    setPicker(null);
    if (!target) return;

    if (target.kind === 'feeds') {
      const moved = store.moveFeedsToFolder(target.ids, folder);
      store.notify(
        'success',
        moved
          ? `Moved ${moved} feed${moved === 1 ? '' : 's'} ${
              folder ? `to “${folder}”` : 'to Ungrouped'
            }`
          : 'Those feeds are already in that folder.'
      );
      return;
    }

    store.mergeFolders(target.names, folder);
    setSelectedFolders(new Set());
  };

  /* --------------------------- OPML XML sync ---------------------------- */

  const previewXml = () => {
    setXmlError(null);
    setXmlPreview(null);

    let parsed: ImportResult;
    try {
      parsed = importSubscriptions(xmlText);
    } catch (err) {
      setXmlError(err instanceof ImportError ? err.message : 'Invalid OPML XML.');
      return;
    }

    const existing = new Map(state.feeds.map((feed) => [feed.id, feed]));
    const added: ExportFeed[] = [];
    const updated: ExportFeed[] = [];
    for (const entry of parsed.feeds) {
      const prev = existing.get(feedIdForUrl(entry.url));
      if (!prev) {
        added.push(entry);
        continue;
      }
      const title = entry.title?.trim() || prev.title;
      const folder = entry.folder?.trim() || undefined;
      const site = entry.siteUrl || prev.siteUrl;
      if (
        title !== prev.title ||
        (folder ?? '') !== (prev.folder?.trim() ?? '') ||
        site !== prev.siteUrl
      ) {
        updated.push(entry);
      }
    }

    const incoming = new Set(parsed.feeds.map((entry) => feedIdForUrl(entry.url)));
    const removed = state.feeds.filter((feed) => !incoming.has(feed.id));

    const currentFolders = folderNamesOf(state.feeds, state.folders);
    const nextFolders = new Set(parsed.folders);
    const foldersAdded = [...nextFolders].filter((name) => !currentFolders.has(name)).sort(byName);
    const foldersRemoved = [...currentFolders].filter((name) => !nextFolders.has(name)).sort(byName);

    setXmlPreview({ parsed, added, updated, removed, foldersAdded, foldersRemoved });
  };

  const applyXml = () => {
    if (!xmlPreview) return;
    const { parsed } = xmlPreview;
    const { added, updated, removed } = store.importFeeds(parsed.feeds, {
      replace: true,
      folders: parsed.folders,
    });
    if (parsed.readIds && Object.keys(parsed.readIds).length) {
      store.mergeReadIds(parsed.readIds);
    }
    const summary =
      [
        added ? `${added} added` : '',
        updated ? `${updated} updated` : '',
        removed ? `${removed} removed` : '',
        xmlPreview.foldersAdded.length ? `${xmlPreview.foldersAdded.length} folders added` : '',
        xmlPreview.foldersRemoved.length
          ? `${xmlPreview.foldersRemoved.length} folders removed`
          : '',
      ]
        .filter(Boolean)
        .join(', ') || 'No changes';
    store.notify('success', `OPML applied (${summary})`);
    close();
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
      title="Subscriptions & OPML"
      size="md"
      suspended={picker !== null}
    >
      <div className="tabs" role="tablist" aria-label="Subscriptions and OPML">
        <button
          type="button"
          role="tab"
          id="tab-import"
          aria-selected={tab === 'import'}
          aria-controls="panel-import"
          className={`tab ${tab === 'import' ? 'is-active' : ''}`}
          onClick={() => setTab('import')}
        >
          Import
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
          Export
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
          Manage ({state.feeds.length})
        </button>
        <button
          type="button"
          role="tab"
          id="tab-xml"
          aria-selected={tab === 'xml'}
          aria-controls="panel-xml"
          className={`tab ${tab === 'xml' ? 'is-active' : ''}`}
          onClick={() => setTab('xml')}
        >
          OPML XML
        </button>
      </div>

      {tab === 'import' && (
        <div id="panel-import" role="tabpanel" aria-labelledby="tab-import" className="tab-panel">
          <p className="field__hint">
            Choose an <strong>OPML</strong> file from another reader, or a <strong>JSON</strong> backup
            exported from this app. Folders and links are sorted A–Z, and edited titles/folders update
            existing feeds automatically.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".opml,.xml,.json,application/xml,text/xml,application/json"
            className="file-input"
            aria-label="Choose OPML or JSON file"
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
                <strong>{pending.feeds.length}</strong> {pending.feeds.length === 1 ? 'feed' : 'feeds'} found in
                a {pending.format.toUpperCase()} file
                {pending.folders.length
                  ? ` across ${countLabel(pending.folders.length, 'folder')}`
                  : ''}
                {pending.readIds
                  ? ` · ${countLabel(Object.keys(pending.readIds).length, 'read entry', 'read entries')}`
                  : ''}
                {pendingArticleCount ? ` · ${countLabel(pendingArticleCount, 'cached article')}` : ''}
                {pending.preferences ? ' · preferences' : ''}.
              </p>

              <ul className="import-preview__list">
                {pending.feeds.slice(0, 8).map((feed) => (
                  <li key={feed.url}>
                    {feed.folder ? `${feed.folder} › ` : ''}
                    {feed.title || feed.url}
                  </li>
                ))}
                {pending.feeds.length > 8 && (
                  <li className="is-more">+{pending.feeds.length - 8} more</li>
                )}
                {!pending.feeds.length &&
                  pending.folders.slice(0, 8).map((folder) => (
                    <li key={`folder:${folder}`}>{folder} (empty folder)</li>
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
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void confirmImport()}
                  disabled={!pending.feeds.length && !pending.folders.length}
                >
                  Import{' '}
                  {pending.feeds.length
                    ? countLabel(pending.feeds.length, 'feed')
                    : countLabel(pending.folders.length, 'folder')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div id="panel-export" role="tabpanel" aria-labelledby="tab-export" className="tab-panel">
          <p className="field__hint">
            <strong>OPML</strong> is the standard format every reader understands — subscriptions and
            folders (sorted A–Z, including empty folders).
            <br />
            <strong>JSON backup</strong> also carries read status, preferences and every cached
            article, so this device can be rebuilt elsewhere (the YouTube API key is not included).
          </p>

          <div className="export-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => doExport('opml')}
              disabled={!hasAnything}
            >
              Export OPML
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void doExport('json')}
              disabled={!hasAnything}
            >
              Export full backup (JSON)
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
            <p className="field__hint">No feeds subscribed yet.</p>
          ) : (
            <>
              <div className="manage-subtabs" role="tablist" aria-label="Manage subscriptions">
                <button
                  type="button"
                  role="tab"
                  id="manage-tab-feeds"
                  aria-selected={manageTab === 'feeds'}
                  aria-controls="manage-feeds"
                  className={`manage-subtab ${manageTab === 'feeds' ? 'is-active' : ''}`}
                  onClick={() => setManageTab('feeds')}
                >
                  Feeds ({state.feeds.length})
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
                  Folders ({folders.length})
                </button>
              </div>

              {pendingDelete && (
                <div className="manage-confirm" role="alertdialog" aria-label="Confirm deletion">
                  <p className="manage-confirm__text">
                    {pendingDelete.kind === 'feeds'
                      ? `Remove ${pendingDelete.ids.length} selected feed${
                          pendingDelete.ids.length === 1 ? '' : 's'
                        }? Their cached articles will be deleted too.`
                      : `Delete ${
                          pendingDelete.names.length === 1
                            ? `folder “${pendingDelete.names[0]}”`
                            : `${pendingDelete.names.length} folders`
                        }${
                          pendingDelete.feedCount
                            ? ` and ${
                                pendingDelete.names.length === 1 ? 'its' : 'their'
                              } ${pendingDelete.feedCount} feed${
                                pendingDelete.feedCount === 1 ? '' : 's'
                              }`
                            : ''
                        }? This cannot be undone.`}
                  </p>
                  <div className="manage-confirm__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setPendingDelete(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      autoFocus
                      onClick={confirmDelete}
                    >
                      {pendingDelete.kind === 'feeds'
                        ? 'Delete feeds'
                        : pendingDelete.names.length === 1
                          ? 'Delete folder'
                          : 'Delete folders'}
                    </button>
                  </div>
                </div>
              )}

              {manageTab === 'feeds' ? (
                <div
                  id="manage-feeds"
                  role="tabpanel"
                  aria-labelledby="manage-tab-feeds"
                  className="manage-subpanel"
                >
                  <div className="manage-toolbar">
                    <div className="manage-toolbar__select">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={selectAll}
                        disabled={selectedIds.size === state.feeds.length}
                      >
                        Select all ({state.feeds.length})
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={selectNone}
                        disabled={selectedIds.size === 0}
                      >
                        Select none
                      </button>
                      <span className="manage-toolbar__count">
                        {selectedIds.size} selected
                      </span>
                    </div>

                    <div className="manage-toolbar__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setPicker({ kind: 'feeds', ids: [...selectedIds] })}
                        disabled={selectedIds.size === 0}
                      >
                        <Icon name="folder" size={15} />
                        <span>Move selected ({selectedIds.size})…</span>
                      </button>
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={deleteSelected}
                        disabled={selectedIds.size === 0}
                      >
                        <Icon name="trash" size={15} />
                        <span>Delete selected ({selectedIds.size})</span>
                      </button>
                    </div>
                  </div>

                  <div className="manage-list" role="region" aria-label="Feed selection">
                    {folders.map((folder) => {
                      const allInFolder =
                        folder.feeds.length > 0 &&
                        folder.feeds.every((f) => selectedIds.has(f.id));
                      const someInFolder =
                        !allInFolder && folder.feeds.some((f) => selectedIds.has(f.id));
                      return (
                        <div className="manage-folder" key={`manage-folder:${folder.name}`}>
                          <div className="manage-folder__header">
                            <label className="manage-check">
                              <input
                                type="checkbox"
                                checked={allInFolder}
                                disabled={!folder.feeds.length}
                                ref={(el) => {
                                  if (el) el.indeterminate = someInFolder;
                                }}
                                onChange={() => toggleFolderSelection(folder.feeds)}
                                aria-label={`Select feeds in ${folder.name}`}
                              />
                              <Icon name="folder" size={15} className="folder-row__icon" />
                              <span className="manage-folder__name">{folder.name}</span>
                              <span className="badge">{folder.feeds.length}</span>
                            </label>
                          </div>

                          {folder.feeds.length === 0 ? (
                            <p className="manage-folder__empty">Empty folder</p>
                          ) : (
                            <ul className="manage-folder__feeds">
                              {folder.feeds.map((feed) => (
                                <li key={feed.id} className="manage-item">
                                  <label className="manage-check">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(feed.id)}
                                      onChange={() => toggleFeed(feed.id)}
                                      aria-label={`Select ${feed.title}`}
                                    />
                                    <FeedIcon feed={feed} />
                                    <span className="manage-item__text">
                                      <span className="manage-item__title">{feed.title}</span>
                                      <span className="manage-item__url">{feed.url}</span>
                                    </span>
                                  </label>
                                  <button
                                    type="button"
                                    className="icon-button"
                                    onClick={() =>
                                      setPendingDelete({ kind: 'feeds', ids: [feed.id] })
                                    }
                                    aria-label={`Remove ${feed.title}`}
                                    title="Remove feed"
                                  >
                                    <Icon name="trash" size={14} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}

                    {ungrouped.length > 0 && (
                      <div className="manage-folder">
                        {folders.length > 0 && (
                          <div className="manage-folder__header">
                            <span className="manage-folder__name">Ungrouped</span>
                            <span className="badge">{ungrouped.length}</span>
                          </div>
                        )}
                        <ul className="manage-folder__feeds">
                          {ungrouped.map((feed) => (
                            <li key={feed.id} className="manage-item">
                              <label className="manage-check">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(feed.id)}
                                  onChange={() => toggleFeed(feed.id)}
                                  aria-label={`Select ${feed.title}`}
                                />
                                <FeedIcon feed={feed} />
                                <span className="manage-item__text">
                                  <span className="manage-item__title">{feed.title}</span>
                                  <span className="manage-item__url">{feed.url}</span>
                                </span>
                              </label>
                              <button
                                type="button"
                                className="icon-button"
                                onClick={() =>
                                  setPendingDelete({ kind: 'feeds', ids: [feed.id] })
                                }
                                aria-label={`Remove ${feed.title}`}
                                title="Remove feed"
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  id="manage-folders"
                  role="tabpanel"
                  aria-labelledby="manage-tab-folders"
                  className="manage-subpanel"
                >
                  <div className="manage-toolbar">
                    <div className="manage-toolbar__select">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={selectAllFolders}
                        disabled={!folders.length || selectedFolders.size === folders.length}
                      >
                        Select all ({folders.length})
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={selectNoFolders}
                        disabled={selectedFolders.size === 0}
                      >
                        Select none
                      </button>
                      <span className="manage-toolbar__count">
                        {selectedFolders.size} selected
                      </span>
                    </div>

                    <div className="manage-toolbar__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() =>
                          setPicker({ kind: 'folders', names: [...selectedFolders] })
                        }
                        disabled={selectedFolders.size === 0}
                      >
                        <Icon name="folder" size={15} />
                        <span>Move selected ({selectedFolders.size})…</span>
                      </button>
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={deleteSelectedFolders}
                        disabled={selectedFolders.size === 0}
                      >
                        <Icon name="trash" size={15} />
                        <span>Delete selected ({selectedFolders.size})</span>
                      </button>
                    </div>
                  </div>

                  <div className="manage-list" role="region" aria-label="Folder selection">
                    {folders.map((folder) => (
                      <div className="manage-folder-row" key={`manage-folder-row:${folder.name}`}>
                        <label className="manage-check">
                          <input
                            type="checkbox"
                            checked={selectedFolders.has(folder.name)}
                            onChange={() => toggleFolder(folder.name)}
                            aria-label={`Select folder ${folder.name}`}
                          />
                          <Icon name="folder" size={15} className="folder-row__icon" />
                          <span className="manage-folder__name">{folder.name}</span>
                          <span className="badge">{folder.feeds.length}</span>
                        </label>
                        <button
                          type="button"
                          className="ghost-button manage-folder__delete"
                          onClick={() =>
                            setPendingDelete({
                              kind: 'folders',
                              names: [folder.name],
                              feedCount: folder.feeds.length,
                            })
                          }
                          aria-label={`Delete folder ${folder.name}`}
                          title={`Delete folder “${folder.name}”${
                            folder.feeds.length ? ' and its feeds' : ''
                          }`}
                        >
                          <Icon name="trash" size={14} />
                          <span>Delete folder</span>
                        </button>
                      </div>
                    ))}

                    {!folders.length && (
                      <p className="field__hint">
                        No folders yet. Create one from the sidebar, or move a feed “to a new
                        folder”.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'xml' && (
        <div id="panel-xml" role="tabpanel" aria-labelledby="tab-xml" className="tab-panel">
          <p className="field__hint">
            Edit feed titles (<code>text</code> / <code>title</code>), URLs (<code>xmlUrl</code>), or
            folder <code>&lt;outline&gt;</code> groups directly in OPML XML. Applying replaces the
            current subscriptions — you'll see a diff first.
          </p>

          <textarea
            className="input opml-editor"
            aria-label="OPML XML editor"
            placeholder={OPML_PLACEHOLDER}
            value={xmlText}
            onChange={(event) => {
              setXmlText(event.target.value);
              setXmlError(null);
              setXmlPreview(null);
            }}
            spellCheck={false}
            rows={12}
          />

          {xmlError && (
            <p className="field__error" role="alert">
              {xmlError}
            </p>
          )}

          {xmlPreview && (
            <div className="import-preview" role="status" aria-live="polite">
              <p className="import-preview__summary">
                <strong>{xmlPreview.added.length}</strong> added ·{' '}
                <strong>{xmlPreview.updated.length}</strong> updated ·{' '}
                <strong>{xmlPreview.removed.length}</strong> removed
                {(xmlPreview.foldersAdded.length > 0 || xmlPreview.foldersRemoved.length > 0) && (
                  <>
                    {' '}
                    · folders +{xmlPreview.foldersAdded.length} / −
                    {xmlPreview.foldersRemoved.length}
                  </>
                )}
              </p>

              {(xmlPreview.added.length > 0 ||
                xmlPreview.updated.length > 0 ||
                xmlPreview.removed.length > 0 ||
                xmlPreview.foldersAdded.length > 0 ||
                xmlPreview.foldersRemoved.length > 0) && (
                <ul className="import-preview__list">
                  {xmlPreview.added.slice(0, 5).map((feed) => (
                    <li key={`add:${feed.url}`} className="diff-added">
                      + {feed.title || feed.url}
                    </li>
                  ))}
                  {xmlPreview.updated.slice(0, 5).map((feed) => (
                    <li key={`upd:${feed.url}`} className="diff-updated">
                      ~ {feed.title || feed.url}
                    </li>
                  ))}
                  {xmlPreview.removed.slice(0, 5).map((feed) => (
                    <li key={`del:${feed.id}`} className="diff-removed">
                      − {feed.title}
                    </li>
                  ))}
                  {xmlPreview.foldersAdded.map((folder) => (
                    <li key={`folder-add:${folder}`} className="diff-added">
                      + folder: {folder}
                    </li>
                  ))}
                  {xmlPreview.foldersRemoved.map((folder) => (
                    <li key={`folder-del:${folder}`} className="diff-removed">
                      − folder: {folder}
                    </li>
                  ))}
                </ul>
              )}

              <div className="import-preview__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setXmlPreview(null)}
                >
                  Cancel
                </button>
                <button type="button" className="button button--primary" onClick={applyXml}>
                  Apply changes
                </button>
              </div>
            </div>
          )}

          <div className="import-preview__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setXmlText('');
                setXmlError(null);
                setXmlPreview(null);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setXmlText(exportOpml(state.feeds, state.folders));
                setXmlError(null);
                setXmlPreview(null);
              }}
            >
              Reset
            </button>
            <button type="button" className="button button--primary" onClick={previewXml}>
              Preview changes
            </button>
          </div>
        </div>
      )}

      {/* The picker is portalled to <body>, so being a child here has no
          layout effect; it only keeps it inside this dialog's subtree. */}
      <FolderPickerDialog
        open={picker !== null}
        title={
          picker?.kind === 'folders'
            ? `Move ${picker.names.length} folder${picker.names.length === 1 ? '' : 's'} to…`
            : `Move ${picker?.ids.length ?? 0} feed${
                (picker?.ids.length ?? 0) === 1 ? '' : 's'
              } to…`
        }
        folders={folders.map((folder) => folder.name)}
        exclude={picker?.kind === 'folders' ? picker.names : undefined}
        onClose={() => setPicker(null)}
        onPick={pickDestination}
      />
    </Dialog>
  );
}
