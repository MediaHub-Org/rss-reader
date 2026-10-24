import { useEffect, useRef, useState } from 'react';
import type { ImportResult } from '../lib/opml';
import { exportJson, exportOpml, importSubscriptions, downloadFile, ImportError } from '../lib/opml';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Dialog } from './Dialog';

export type DataTab = 'import' | 'export';

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
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-open on the tab the user asked for (Import vs Export sidebar buttons).
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const close = () => {
    setPending(null);
    setError(null);
    onClose();
  };

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
    const { added, skipped } = store.importFeeds(pending.feeds);
    let readNote = '';
    if (pending.readIds && Object.keys(pending.readIds).length) {
      store.mergeReadIds(pending.readIds);
      readNote = ` and restored ${Object.keys(pending.readIds).length} read articles`;
    }
    store.notify(
      added ? 'success' : 'info',
      added
        ? `Imported ${added} feed${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}${readNote}`
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

  return (
    <Dialog open={open} onClose={close} title="Import & export" size="md">
      <div className="tabs" role="tablist" aria-label="Import or export">
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
      </div>

      {tab === 'import' ? (
        <div id="panel-import" role="tabpanel" aria-labelledby="tab-import" className="tab-panel">
          <p className="field__hint">
            Choose an <strong>OPML</strong> file from another reader, or a <strong>JSON</strong> backup
            exported from this app. Duplicates are skipped automatically.
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
                {pending.readIds ? ` · ${Object.keys(pending.readIds).length} read entries` : ''}.
              </p>

              <ul className="import-preview__list">
                {pending.feeds.slice(0, 8).map((feed) => (
                  <li key={feed.url}>{feed.title || feed.url}</li>
                ))}
                {pending.feeds.length > 8 && <li className="is-more">
                  +{pending.feeds.length - 8} more
                </li>}
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
      ) : (
        <div id="panel-export" role="tabpanel" aria-labelledby="tab-export" className="tab-panel">
          <p className="field__hint">
            <strong>OPML</strong> is the standard format every reader understands — subscriptions only.
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
              Export JSON backup
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
