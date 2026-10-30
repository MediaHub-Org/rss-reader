/**
 * Apply a parsed import to the store.
 *
 * Shared by the normal Import tab (merge) and the Backups dialog (replace), so
 * both paths restore feeds, read state, preferences and cached articles in the
 * same order and report the same summary.
 */
import type { ImportResult } from './portability';
import { collectFolderNames } from './portability';
import { store } from '../store/store';
import { countLabel } from './format';

export interface AppliedImport {
  message: string;
  changed: boolean;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  readCount: number;
  starredCount: number;
  ruleCount: number;
  articleCount: number;
}

export async function applyImport(
  pending: ImportResult,
  options: { replace?: boolean } = {}
): Promise<AppliedImport> {
  const replace = Boolean(options.replace);
  const state = store.getSnapshot();
  const beforeFolders = new Set(collectFolderNames(state.feeds, state.folders));
  const addedFolders = pending.folders.filter((name) => !beforeFolders.has(name));

  const { added, updated, removed, skipped } = store.importFeeds(pending.feeds, {
    folders: pending.folders,
    // A full backup already carries its articles; a background refresh would
    // replace them with the live feed before the restore finishes.
    skipRefresh: pending.full,
    replace,
  });

  let readCount = 0;
  if (pending.readIds) {
    readCount = replace
      ? store.replaceReadIds(pending.readIds)
      : store.mergeReadIds(pending.readIds);
  }

  let starredCount = 0;
  if (pending.starredIds) {
    starredCount = replace
      ? store.replaceStarredIds(pending.starredIds)
      : store.mergeStarredIds(pending.starredIds);
  }

  let ruleCount = 0;
  if (pending.rules) {
    ruleCount = replace ? store.replaceRules(pending.rules) : store.mergeRules(pending.rules);
  }

  const articleCount = pending.articles
    ? await store.restoreArticles(pending.articles, {
        replace: replace && Boolean(pending.full),
      })
    : 0;

  if (pending.preferences) store.setPreferences(pending.preferences);

  const parts: string[] = [];
  if (added) parts.push(`${replace ? 'Restored' : 'Imported'} ${countLabel(added, 'feed')}`);
  if (updated) parts.push(`${added ? 'updated' : 'Updated'} ${updated}`);
  if (removed) parts.push(`removed ${countLabel(removed, 'feed')}`);
  if (addedFolders.length) {
    parts.push(`added ${countLabel(addedFolders.length, 'folder')}`);
  }
  if (skipped) parts.push(`skipped ${skipped}`);

  const restored: string[] = [];
  if (readCount) restored.push(countLabel(readCount, 'read entry', 'read entries'));
  if (starredCount) restored.push(countLabel(starredCount, 'starred article'));
  if (ruleCount) restored.push(countLabel(ruleCount, 'rule'));
  if (articleCount) restored.push(countLabel(articleCount, 'cached article'));
  if (pending.preferences) restored.push('preferences');

  const changed = Boolean(
    added ||
      updated ||
      removed ||
      addedFolders.length ||
      readCount ||
      starredCount ||
      ruleCount ||
      articleCount ||
      pending.preferences
  );

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

  return {
    message,
    changed,
    added,
    updated,
    removed,
    skipped,
    readCount,
    starredCount,
    ruleCount,
    articleCount,
  };
}
