import type { SidebarSort } from '../../types';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { Dropdown, type DropdownOption } from '../Dropdown';
import { Icon } from '../Icon';

const SORT_OPTIONS: Array<DropdownOption<SidebarSort>> = [
  { value: 'name-asc', label: 'Name (A to Z)' },
  { value: 'name-desc', label: 'Name (Z to A)' },
  { value: 'modified-desc', label: 'Last updated (newest)' },
  { value: 'modified-asc', label: 'Last updated (oldest)' },
  { value: 'created-desc', label: 'Date added (newest)' },
  { value: 'created-asc', label: 'Date added (oldest)' },
];

interface SidebarToolbarProps {
  onNewFolder: () => void;
  onAddFeed: () => void;
  hasFolders: boolean;
  anyFolderOpen: boolean;
  onToggleFolders: () => void;
  onReveal: () => void;
}

/** New folder/feed, feed sort, collapse-all and reveal controls. */
export function SidebarToolbar({
  onNewFolder,
  onAddFeed,
  hasFolders,
  anyFolderOpen,
  onToggleFolders,
  onReveal,
}: SidebarToolbarProps) {
  const state = useStore();

  return (
    <div className="sidebar__toolbar">
      <button
        type="button"
        className="icon-button"
        onClick={onNewFolder}
        aria-label="New folder"
        title="New folder"
      >
        <Icon name="folderPlus" size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onAddFeed}
        aria-label="New feed"
        title="New feed"
      >
        <Icon name="plus" size={16} />
      </button>
      <span className="sidebar__toolbar-spacer" />
      <Dropdown<SidebarSort>
        value={state.prefs.sidebarSort}
        options={SORT_OPTIONS}
        onChange={(sidebarSort) => store.setPreferences({ sidebarSort })}
        label="Sort feeds"
        triggerTitle="Sort feeds"
        icon={<Icon name="sort" size={15} />}
        className="dropdown--icon"
      />
      {hasFolders && (
        <button
          type="button"
          className="icon-button"
          onClick={onToggleFolders}
          aria-label={anyFolderOpen ? 'Collapse all folders' : 'Expand all folders'}
          title={anyFolderOpen ? 'Collapse all folders' : 'Expand all folders'}
        >
          <Icon name={anyFolderOpen ? 'collapse' : 'expand'} size={15} />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        onClick={onReveal}
        aria-label="Reveal active feed"
        title="Reveal active feed"
      >
        <Icon name="locate" size={15} />
      </button>
    </div>
  );
}
