import { useEffect, useMemo, useState } from 'react';
import type { Feed } from '../../types';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { byName } from '../../lib/portability';
import { FolderPickerDialog } from '../FolderPickerDialog';
import { FeedIcon } from '../FeedIcon';
import { Icon } from '../Icon';

interface ManagerProps {
  /** DOM id prefix, so the dialog and Settings can keep stable test ids. */
  idPrefix?: string;
}

type FolderGroup = { name: string; feeds: Feed[] };

function groupFeeds(feeds: Feed[], folders: string[]): { folders: FolderGroup[]; ungrouped: Feed[] } {
  const byTitle = (a: Feed, b: Feed) => byName(a.title ?? '', b.title ?? '');
  const grouped = new Map<string, Feed[]>();
  const loose: Feed[] = [];

  for (const name of folders) grouped.set(name, grouped.get(name) ?? []);
  for (const feed of feeds) {
    const folder = feed.folder?.trim();
    if (!folder) {
      loose.push(feed);
      continue;
    }
    grouped.set(folder, [...(grouped.get(folder) ?? []), feed]);
  }

  return {
    folders: [...grouped.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, list]) => ({ name, feeds: list.sort(byTitle) })),
    ungrouped: loose.sort(byTitle),
  };
}

/** Multi-select source list: bulk move to a group, bulk delete. */
export function SourcesManager({ idPrefix = 'manage' }: ManagerProps) {
  const state = useStore();
  const { folders, ungrouped } = useMemo(
    () => groupFeeds(state.feeds, state.folders),
    [state.feeds, state.folders]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);

  useEffect(() => {
    const valid = new Set(state.feeds.map((feed) => feed.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [state.feeds]);

  const toggleFeed = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolder = (feeds: Feed[]) => {
    const ids = feeds.map((feed) => feed.id);
    const all = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(state.feeds.map((feed) => feed.id)));
  const selectNone = () => setSelected(new Set());

  const confirmDelete = () => {
    if (!pendingDelete) return;
    store.removeFeeds(pendingDelete);
    setPendingDelete(null);
  };

  const moveSelected = (folder: string | undefined) => {
    setPickerOpen(false);
    const moved = store.moveFeedsToFolder([...selected], folder);
    store.notify(
      'success',
      moved
        ? `Moved ${moved} source${moved === 1 ? '' : 's'} ${
            folder ? `to “${folder}”` : 'to Ungrouped'
          }`
        : 'Those sources are already in that group.'
    );
  };

  return (
    <div id={`${idPrefix}-feeds`} className="manage-subpanel" role="region" aria-label="Source selection">
      {pendingDelete && (
        <div className="manage-confirm" role="alertdialog" aria-label="Confirm deletion">
          <p className="manage-confirm__text">
            Remove {pendingDelete.length} selected source
            {pendingDelete.length === 1 ? '' : 's'}? Their cached articles and starred state will be
            deleted too.
          </p>
          <div className="manage-confirm__actions">
            <button type="button" className="button button--ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button type="button" className="button button--danger" autoFocus onClick={confirmDelete}>
              Delete sources
            </button>
          </div>
        </div>
      )}

      <div className="manage-toolbar">
        <div className="manage-toolbar__select">
          <button
            type="button"
            className="button button--ghost"
            onClick={selectAll}
            disabled={selected.size === state.feeds.length}
          >
            Select all ({state.feeds.length})
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={selectNone}
            disabled={selected.size === 0}
          >
            Select none
          </button>
          <span className="manage-toolbar__count">{selected.size} selected</span>
        </div>

        <div className="manage-toolbar__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setPickerOpen(true)}
            disabled={selected.size === 0}
          >
            <Icon name="folder" size={15} />
            <span>Move selected ({selected.size})…</span>
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setPendingDelete([...selected])}
            disabled={selected.size === 0}
          >
            <Icon name="trash" size={15} />
            <span>Delete selected ({selected.size})</span>
          </button>
        </div>
      </div>

      <div className="manage-list" role="region" aria-label="Source selection">
        {!folders.length && !ungrouped.length && (
          <p className="settings-empty">
            No sources yet. Add a feed from the sidebar to manage it here.
          </p>
        )}

        {folders.map((folder) => {
          const allInFolder =
            folder.feeds.length > 0 && folder.feeds.every((feed) => selected.has(feed.id));
          const someInFolder =
            !allInFolder && folder.feeds.some((feed) => selected.has(feed.id));
          return (
            <div className="manage-folder" key={`source-folder:${folder.name}`}>
              <div className="manage-folder__header">
                <label className="manage-check">
                  <input
                    type="checkbox"
                    checked={allInFolder}
                    disabled={!folder.feeds.length}
                    ref={(el) => {
                      if (el) el.indeterminate = someInFolder;
                    }}
                    onChange={() => toggleFolder(folder.feeds)}
                    aria-label={`Select sources in ${folder.name}`}
                  />
                  <Icon name="folder" size={15} className="folder-row__icon" />
                  <span className="manage-folder__name">{folder.name}</span>
                  <span className="badge">{folder.feeds.length}</span>
                </label>
              </div>

              {folder.feeds.length === 0 ? (
                <p className="manage-folder__empty">Empty group</p>
              ) : (
                <ul className="manage-folder__feeds">
                  {folder.feeds.map((feed) => (
                    <SourceRow
                      key={feed.id}
                      feed={feed}
                      checked={selected.has(feed.id)}
                      onToggle={() => toggleFeed(feed.id)}
                      onDelete={() => setPendingDelete([feed.id])}
                    />
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
                <SourceRow
                  key={feed.id}
                  feed={feed}
                  checked={selected.has(feed.id)}
                  onToggle={() => toggleFeed(feed.id)}
                  onDelete={() => setPendingDelete([feed.id])}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <FolderPickerDialog
        open={pickerOpen}
        title={`Move ${selected.size} source${selected.size === 1 ? '' : 's'} to…`}
        folders={folders.map((folder) => folder.name)}
        onClose={() => setPickerOpen(false)}
        onPick={moveSelected}
      />
    </div>
  );
}

function SourceRow({
  feed,
  checked,
  onToggle,
  onDelete,
}: {
  feed: Feed;
  checked: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="manage-item">
      <label className="manage-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${feed.title || feed.url}`}
        />
        <FeedIcon feed={feed} />
        <span className="manage-item__text">
          <span className="manage-item__title">{feed.title || feed.url}</span>
          <span className="manage-item__url">{feed.url}</span>
        </span>
      </label>
      <button
        type="button"
        className="icon-button"
        onClick={onDelete}
        aria-label={`Remove ${feed.title || feed.url}`}
        title="Remove source"
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}

/** Multi-select group list: create, merge selected groups, delete. */
export function GroupsManager({ idPrefix = 'manage' }: ManagerProps) {
  const state = useStore();
  const { folders } = useMemo(
    () => groupFeeds(state.feeds, state.folders),
    [state.feeds, state.folders]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    names: string[];
    feedCount: number;
  } | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const valid = new Set(folders.map((folder) => folder.name));
    setSelected((prev) => {
      const next = new Set([...prev].filter((name) => valid.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [folders]);

  const toggleGroup = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createGroup = () => {
    const result = store.createFolder(newName);
    if (!result.ok) {
      store.notify('error', result.message ?? 'Could not create that group.');
      return;
    }
    store.notify('success', `Created group “${newName.trim()}”`);
    setNewName('');
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    store.removeFolders(pendingDelete.names);
    setPendingDelete(null);
    setSelected(new Set());
  };

  const mergeSelected = (target: string | undefined) => {
    setPickerOpen(false);
    const result = store.mergeFolders([...selected], target);
    if (!result.feeds && !result.folders) {
      store.notify('info', 'Those groups are already merged.');
      return;
    }
    setSelected(new Set());
  };

  return (
    <div id={`${idPrefix}-folders`} className="manage-subpanel" role="region" aria-label="Group selection">
      {pendingDelete && (
        <div className="manage-confirm" role="alertdialog" aria-label="Confirm deletion">
          <p className="manage-confirm__text">
            Delete{' '}
            {pendingDelete.names.length === 1
              ? `group “${pendingDelete.names[0]}”`
              : `${pendingDelete.names.length} groups`}
            {pendingDelete.feedCount
              ? ` and ${
                  pendingDelete.names.length === 1 ? 'its' : 'their'
                } ${pendingDelete.feedCount} source${pendingDelete.feedCount === 1 ? '' : 's'}`
              : ''}
            ? This cannot be undone.
          </p>
          <div className="manage-confirm__actions">
            <button type="button" className="button button--ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button type="button" className="button button--danger" autoFocus onClick={confirmDelete}>
              {pendingDelete.names.length === 1 ? 'Delete group' : 'Delete groups'}
            </button>
          </div>
        </div>
      )}

      <div className="manage-toolbar">
        <div className="manage-toolbar__select">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setSelected(new Set(folders.map((folder) => folder.name)))}
            disabled={!folders.length || selected.size === folders.length}
          >
            Select all ({folders.length})
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
          >
            Select none
          </button>
          <span className="manage-toolbar__count">{selected.size} selected</span>
        </div>

        <div className="manage-toolbar__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setPickerOpen(true)}
            disabled={selected.size === 0}
          >
            <Icon name="folder" size={15} />
            <span>Merge selected ({selected.size})…</span>
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              const names = [...selected];
              const feedCount = state.feeds.filter((feed) =>
                names.includes(feed.folder?.trim() ?? '')
              ).length;
              setPendingDelete({ names, feedCount });
            }}
            disabled={selected.size === 0}
          >
            <Icon name="trash" size={15} />
            <span>Delete selected ({selected.size})</span>
          </button>
        </div>
      </div>

      <form
        className="manage-new-group"
        onSubmit={(event) => {
          event.preventDefault();
          createGroup();
        }}
      >
        <input
          className="input"
          placeholder="New group name"
          aria-label="New group name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" className="button button--ghost" disabled={!newName.trim()}>
          <Icon name="plus" size={15} />
          <span>Create group</span>
        </button>
      </form>

      <div className="manage-list" role="region" aria-label="Group selection">
        {folders.map((folder) => (
          <div className="manage-folder-row" key={`group-row:${folder.name}`}>
            <label className="manage-check">
              <input
                type="checkbox"
                checked={selected.has(folder.name)}
                onChange={() => toggleGroup(folder.name)}
                aria-label={`Select group ${folder.name}`}
              />
              <Icon name="folder" size={15} className="folder-row__icon" />
              <span className="manage-folder__name">{folder.name}</span>
              <span className="badge">{folder.feeds.length}</span>
            </label>
            <button
              type="button"
              className="ghost-button manage-folder__delete"
              onClick={() =>
                setPendingDelete({ names: [folder.name], feedCount: folder.feeds.length })
              }
              aria-label={`Delete group ${folder.name}`}
              title={`Delete group “${folder.name}”${
                folder.feeds.length ? ' and its sources' : ''
              }`}
            >
              <Icon name="trash" size={14} />
              <span>Delete group</span>
            </button>
          </div>
        ))}

        {!folders.length && (
          <p className="field__hint">
            No groups yet. Create one above, or select sources in the Sources section and move
            them to a new group.
          </p>
        )}
      </div>

      <FolderPickerDialog
        open={pickerOpen}
        title={`Merge ${selected.size} group${selected.size === 1 ? '' : 's'} into…`}
        folders={folders.map((folder) => folder.name)}
        exclude={[...selected]}
        onClose={() => setPickerOpen(false)}
        onPick={mergeSelected}
      />
    </div>
  );
}
