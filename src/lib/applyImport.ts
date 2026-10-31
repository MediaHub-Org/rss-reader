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
import { plural, t } from './i18n';

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
  if (added)
    parts.push(
      t(replace ? 'Restored {label}' : 'Imported {label}', {
        label: plural(added, '{count} feed', '{count} feeds'),
      })
    );
  if (updated) parts.push(t(added ? 'updated {count}' : 'Updated {count}', { count: updated }));
  if (removed)
    parts.push(t('removed {label}', { label: plural(removed, '{count} feed', '{count} feeds') }));
  if (addedFolders.length) {
    parts.push(
      t('added {label}', {
        label: plural(addedFolders.length, '{count} folder', '{count} folders'),
      })
    );
  }
  if (skipped) parts.push(t('skipped {count}', { count: skipped }));

  const restored: string[] = [];
  if (readCount)
    restored.push(plural(readCount, '{count} read entry', '{count} read entries'));
  if (starredCount)
    restored.push(plural(starredCount, '{count} starred article', '{count} starred articles'));
  if (ruleCount) restored.push(plural(ruleCount, '{count} rule', '{count} rules'));
  if (articleCount)
    restored.push(plural(articleCount, '{count} cached article', '{count} cached articles'));
  if (pending.preferences) restored.push(t('preferences'));

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
    message = t('{parts} · restored {restored}', {
      parts: parts.join(', '),
      restored: restored.join(', '),
    });
  } else if (parts.length) {
    message = parts.join(', ');
  } else if (restored.length) {
    message = t('Restored {restored}', { restored: restored.join(', ') });
  } else {
    message = t('Nothing to import — {label} skipped', {
      label: plural(skipped, '{count} duplicate', '{count} duplicates'),
    });
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
