import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feed } from '../types';
import type { ImportResult } from '../lib/opml';
import {
  byName,
  exportJson,
  exportOpml,
  importSubscriptions,
  downloadFile,
  ImportError,
} from '../lib/opml';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Dialog } from './Dialog';
import { FeedIcon } from './FeedIcon';
import { Icon } from './Icon';

export type DataTab = 'import' | 'export' | 'manage' | 'xml';

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [xmlText, setXmlText] = useState('');
  const [xmlError, setXmlError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-open on the tab the user asked for (Import / Export / Manage buttons).
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setSelectedIds(new Set());
      setXmlText(exportOpml(state.feeds));
      setXmlError(null);
    }
  }, [open, initialTab]);

  // Refresh the XML buffer when switching to the OPML XML tab.
  useEffect(() => {
    if (open && tab === 'xml') {
      setXmlText(exportOpml(state.feeds));
      setXmlError(null);
    }
  }, [open, tab, state.feeds]);

  // Prune selection if feeds were removed externally.
  useEffect(() => {
    const valid = new Set(state.feeds.map((f) => f.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [state.feeds]);

  const close = () => {
    setPending(null);
    setError(null);
    setXmlError(null);
    setSelectedIds(new Set());
    onClose();
  };

  /** Folders A–Z with feeds A–Z inside, then ungrouped feeds A–Z. */
  const { folders, ungrouped } = useMemo(() => {
    const byTitle = (a: Feed, b: Feed) => byName(a.title, b.title);
    const grouped = new Map<string, Feed[]>();
    const loose: Feed[] = [];

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
  }, [state.feeds]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPending(null);
    setError(null);

    if (file.size > 5 * 1024 * 1024) {
      setError('That file is larger than 5 MB — it is probably not an OPML file.');
      return;
    }

    try {
      const text = await file.text();
      setPending(importSubscriptions(text));
    } catch (err) {
      setError(err instanceof ImportError ? err.message : 'Could not read that file.');
    }
  };

  const confirmImport = () => {
    if (!pending) return;
    const { added, updated, skipped } = store.importFeeds(pending.feeds);
    let readNote = '';
    if (pending.readIds && Object.keys(pending.readIds).length) {
      store.mergeReadIds(pending.readIds);
      readNote = ` and restored ${Object.keys(pending.readIds).length} read articles`;
    }
    const parts: string[] = [];
    if (added) parts.push(`Imported ${added} feed${added === 1 ? '' : 's'}`);
    if (updated) parts.push(`${added ? 'updated' : 'Updated'} ${updated}`);
    if (skipped) parts.push(`skipped ${skipped}`);

    store.notify(
      added || updated ? 'success' : 'info',
      added || updated
        ? `${parts.join(', ')}${readNote}`
        : `Nothing to import — ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped`
    );
    close();
  };

  const doExport = (kind: 'opml' | 'json') => {
    try {
      if (kind === 'opml') {
        downloadFile('rss-reader-subscriptions.opml', exportOpml(state.feeds), 'text/x-opml+xml');
      } else {
        downloadFile(
          'rss-reader-backup.json',
          exportJson(state.feeds, state.readIds),
          'application/json'
        );
      }
      store.notify('success', kind === 'opml' ? 'OPML exported' : 'Backup exported');
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

  const deleteSelected = () => {
    if (!selectedIds.size) return;
    store.removeFeeds([...selectedIds]);
    setSelectedIds(new Set());
  };

  /* --------------------------- OPML XML sync ---------------------------- */

  const applyXml = () => {
    setXmlError(null);
    try {
      const parsed = importSubscriptions(xmlText);
      const { added, updated, removed } = store.importFeeds(parsed.feeds, { replace: true });
      const summary =
        [
          added ? `${added} added` : '',
          updated ? `${updated} updated` : '',
          removed ? `${removed} removed` : '',
        ]
          .filter(Boolean)
          .join(', ') || 'No changes';
      store.notify('success', `OPML applied (${summary})`);
      close();
    } catch (err) {
      setXmlError(err instanceof ImportError ? err.message : 'Invalid OPML XML.');
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Subscriptions & OPML" size="md">
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
                <strong>{pending.feeds.length}</strong> feed{pending.feeds.length === 1 ? '' : 's'} found in
                a {pending.format.toUpperCase()} file
                {pending.folders.length
                  ? ` across ${pending.folders.length} folder${pending.folders.length === 1 ? '' : 's'}`
                  : ''}
                {pending.readIds ? ` · ${Object.keys(pending.readIds).length} read entries` : ''}.
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
                <button type="button" className="button button--primary" onClick={confirmImport}>
                  Import {pending.feeds.length} feed{pending.feeds.length === 1 ? '' : 's'}
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
            folders (sorted A–Z).
            <br />
            <strong>JSON backup</strong> includes read status so you can restore this device exactly.
          </p>

          <div className="export-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => doExport('opml')}
              disabled={!state.feeds.length}
            >
              Export OPML ({state.feeds.length} feed{state.feeds.length === 1 ? '' : 's'})
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => doExport('json')}
              disabled={!state.feeds.length}
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
          onKeyDown={(event) => {
            if (event.key === 'Enter' && selectedIds.size > 0) {
              const target = event.target as HTMLElement | null;
              if (target?.tagName === 'BUTTON' && target !== event.currentTarget) return;
              event.preventDefault();
              deleteSelected();
            }
          }}
        >
          {!state.feeds.length ? (
            <p className="field__hint">No feeds subscribed yet.</p>
          ) : (
            <>
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

              <div className="manage-list" role="region" aria-label="Feed selection">
                {folders.map((folder) => {
                  const allInFolder = folder.feeds.every((f) => selectedIds.has(f.id));
                  const someInFolder =
                    !allInFolder && folder.feeds.some((f) => selectedIds.has(f.id));
                  return (
                    <div className="manage-folder" key={`manage-folder:${folder.name}`}>
                      <div className="manage-folder__header">
                        <label className="manage-check">
                          <input
                            type="checkbox"
                            checked={allInFolder}
                            ref={(el) => {
                              if (el) el.indeterminate = someInFolder;
                            }}
                            onChange={() => toggleFolderSelection(folder.feeds)}
                            aria-label={`Select folder ${folder.name}`}
                          />
                          <Icon name="folder" size={15} className="folder-row__icon" />
                          <span className="manage-folder__name">{folder.name}</span>
                          <span className="badge">{folder.feeds.length}</span>
                        </label>

                        <button
                          type="button"
                          className="ghost-button manage-folder__delete"
                          onClick={() => store.removeFolder(folder.name)}
                          aria-label={`Delete folder ${folder.name}`}
                          title={`Delete folder “${folder.name}” and its feeds`}
                        >
                          <Icon name="trash" size={14} />
                          <span>Delete folder</span>
                        </button>
                      </div>

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
                              onClick={() => store.removeFeed(feed.id)}
                              aria-label={`Remove ${feed.title}`}
                              title="Remove feed"
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
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
                            onClick={() => store.removeFeed(feed.id)}
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
            </>
          )}
        </div>
      )}

      {tab === 'xml' && (
        <div id="panel-xml" role="tabpanel" aria-labelledby="tab-xml" className="tab-panel">
          <p className="field__hint">
            Edit feed titles (<code>text</code> / <code>title</code>), URLs (<code>xmlUrl</code>), or
            folder <code>&lt;outline&gt;</code> groups directly in OPML XML, then apply.
          </p>

          <textarea
            className="input opml-editor"
            aria-label="OPML XML editor"
            value={xmlText}
            onChange={(event) => {
              setXmlText(event.target.value);
              setXmlError(null);
            }}
            spellCheck={false}
            rows={12}
          />

          {xmlError && (
            <p className="field__error" role="alert">
              {xmlError}
            </p>
          )}

          <div className="import-preview__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setXmlText(exportOpml(state.feeds));
                setXmlError(null);
              }}
            >
              Reset
            </button>
            <button type="button" className="button button--primary" onClick={applyXml}>
              Apply OPML XML
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
