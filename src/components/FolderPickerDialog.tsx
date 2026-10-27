import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { store } from '../store/store';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

interface FolderPickerDialogProps {
  open: boolean;
  title: string;
  /** Every folder that exists, in any order (sorted here, A–Z). */
  folders: string[];
  /** The feed's/folders' current folder, marked with a check. */
  current?: string;
  /** Destinations that cannot be chosen (e.g. the folders being merged). */
  exclude?: string[];
  /** Offer “No folder” (ungroup) as a destination. */
  allowNone?: boolean;
  onClose: () => void;
  onPick: (folder: string | undefined) => void;
}

/** Accent- and case-insensitive matching, so “Tec” finds “Técnico”. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

type Option = { value: string | undefined; label: string };

/**
 * The “move to folder” dropdown: a modal with a search field and a filtered,
 * keyboard-navigable list, instead of a context menu that grows one row per
 * folder. “New folder…” creates the folder and moves straight into it.
 */
export function FolderPickerDialog({
  open,
  title,
  folders,
  current,
  exclude,
  allowNone = true,
  onClose,
  onPick,
}: FolderPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const listBaseId = useId();

  // A fresh search every time: the previous query must not leak into a new move.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setCreating(false);
    setNewName('');
    setError(null);
  }, [open]);

  const excluded = useMemo(() => new Set(exclude ?? []), [exclude]);

  const options = useMemo<Option[]>(() => {
    const needle = fold(query.trim());
    const matches = folders
      .filter((name) => !excluded.has(name))
      .filter((name) => !needle || fold(name).includes(needle))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const list: Option[] = [];
    if (allowNone && (!needle || fold('No folder').includes(needle))) {
      list.push({ value: undefined, label: 'No folder' });
    }
    for (const name of matches) list.push({ value: name, label: name });
    return list;
  }, [folders, excluded, query, allowNone]);

  // Keep the highlight in range as the filter shrinks the list.
  useEffect(() => {
    setActive((prev) => (prev >= options.length ? Math.max(0, options.length - 1) : prev));
  }, [options.length]);

  const choose = (option: Option) => onPick(option.value);

  const createFolder = () => {
    const name = newName.trim();
    if (!name) {
      setError('Enter a folder name.');
      return;
    }
    const result = store.createFolder(name);
    if (!result.ok) {
      setError(result.message ?? 'Could not create that folder.');
      return;
    }
    onPick(name);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (!options.length) return;
      event.preventDefault();
      setActive((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, options.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    }
  };

  // Portalled to <body>: the picker can be opened from inside the mobile
  // drawer, which is `transform`ed, and a fixed-position dialog inside it
  // would otherwise be clipped to the drawer instead of the viewport.
  return createPortal(
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <button type="button" className="button button--ghost" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="folder-picker">
        {creating ? (
          <form
            className="folder-picker__create"
            onSubmit={(event) => {
              event.preventDefault();
              createFolder();
            }}
          >
            <label className="field">
              <span className="field__label">New folder name</span>
              <input
                ref={newRef}
                className="input"
                value={newName}
                autoFocus
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setError(null);
                }}
              />
            </label>
            {error ? <p className="field__error">{error}</p> : null}
            <div className="folder-picker__create-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Back
              </button>
              <button type="submit" className="button button--primary" disabled={!newName.trim()}>
                Create and move
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="folder-picker__search">
              <Icon name="search" size={15} />
              <input
                ref={inputRef}
                className="input"
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${listBaseId}-list`}
                aria-autocomplete="list"
                aria-activedescendant={
                  options[active] ? `${listBaseId}-${active}` : undefined
                }
                placeholder="Search folders…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
              />
            </div>

            <ul
              id={`${listBaseId}-list`}
              className="folder-picker__list"
              role="listbox"
              aria-label="Folders"
            >
              {options.map((option, index) => (
                <li
                  key={option.value ?? '__none__'}
                  id={`${listBaseId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={[
                    'folder-picker__option',
                    index === active ? 'is-active' : '',
                    current === option.value ? 'is-current' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <Icon name={option.value === undefined ? 'inbox' : 'folder'} size={15} />
                  <span className="folder-picker__label">{option.label}</span>
                  {current === option.value ? (
                    <Icon name="check" size={15} className="folder-picker__check" />
                  ) : null}
                </li>
              ))}
              {options.length === 0 ? (
                <li className="folder-picker__empty">No folders match “{query.trim()}”.</li>
              ) : null}
            </ul>

            <button
              type="button"
              className="folder-picker__new"
              onClick={() => setCreating(true)}
            >
              <Icon name="folderPlus" size={15} />
              <span>New folder…</span>
            </button>
          </>
        )}
      </div>
    </Dialog>,
    document.body
  );
}
