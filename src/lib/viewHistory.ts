/**
 * Browser-history bridge.
 *
 * The reader has no router: a view is just `(feedId, articleId)` in the store.
 * Recording one history entry per view change lets the mouse's back/forward
 * buttons (and Alt+←, the browser gesture, the system back swipe on Android…)
 * walk through the reader instead of leaving the page.
 *
 * Everything goes through the same stack: the in-app “Back” button and Escape
 * call `leaveArticle()`, which uses `history.back()` when there is a previous
 * entry of ours, so both directions agree and no duplicate entries pile up.
 */
import { store } from '../store/store';

interface ViewEntry {
  rss: true;
  feedId: string;
  articleId: string | null;
  /** Position among our entries; 0 means “back” would leave the app. */
  index: number;
}

/** Position of the entry we are on, within this page load. */
let index = 0;
/** The view the browser is currently sitting on; null until the first sync. */
let current: { feedId: string; articleId: string | null } | null = null;
/** A history.back() is in flight; ignore extra clicks until popstate lands. */
let backPending = false;
let listening = false;

function entryFor(feedId: string, articleId: string | null, at: number): ViewEntry {
  return { rss: true, feedId, articleId, index: at };
}

/** Start listening once (mounting is idempotent; StrictMode runs effects twice). */
export function startViewHistory(): void {
  if (listening) return;
  listening = true;

  window.addEventListener('popstate', (event) => {
    backPending = false;
    const entry = event.state as ViewEntry | null;
    // An entry we did not create (e.g. the page the user arrived from). Let the
    // browser deal with it: the app is about to unload.
    if (!entry || entry.rss !== true) return;

    index = typeof entry.index === 'number' ? entry.index : 0;
    // Update before the render that applyView triggers: syncView then sees the
    // view already recorded and does not push a duplicate entry.
    current = { feedId: entry.feedId, articleId: entry.articleId };
    store.applyView(entry.feedId, entry.articleId);
  });
}

/** Record a view change. Called from an effect after every navigation render. */
export function syncView(feedId: string, articleId: string | null): void {
  if (!current) {
    // First render: point the current entry at the view the app booted into
    // instead of adding one, so “back” still leaves the app.
    current = { feedId, articleId };
    index = 0;
    history.replaceState(entryFor(feedId, articleId, 0), '');
    return;
  }
  if (current.feedId === feedId && current.articleId === articleId) return;

  const previous = current;
  current = { feedId, articleId };

  // Article → next article (j/k, or any other “next”) updates the entry in
  // place: Back should still mean “back to the list”, not “previous article”.
  if (previous.articleId !== null && previous.feedId === feedId) {
    history.replaceState(entryFor(feedId, articleId, index), '');
    return;
  }

  index += 1;
  history.pushState(entryFor(feedId, articleId, index), '');
}

/**
 * Close the open article the way the browser would: step back to the previous
 * view when there is one, otherwise just clear the article.
 */
export function leaveArticle(): void {
  if (backPending) return;
  if (index > 0) {
    backPending = true;
    history.back();
    return;
  }
  store.setActiveArticle(null);
}
