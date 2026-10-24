import { useMemo } from 'react';
import type { Article } from '../types';
import { ALL_FEEDS } from '../types';
import { store, selectArticles } from '../store/store';
import { useStore, useInfiniteList } from '../hooks/useStore';
import { formatRelativeTime } from '../lib/format';
import { Icon } from './Icon';

const PAGE_SIZE = 30;

interface ArticleListProps {
  onAddFeed: () => void;
  onImport: () => void;
}

export function ArticleList({ onAddFeed, onImport }: ArticleListProps) {
  const state = useStore();

  const articles = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        hideRead: state.prefs.hideRead,
      }),
    [state]
  );

  const { visible, sentinelRef, loadMore } = useInfiniteList(articles.length, PAGE_SIZE);
  const slice = articles.slice(0, visible);

  const feedTitle = (id: string) => state.feeds.find((f) => f.id === id)?.title ?? 'Unknown feed';
  const showFeedName = state.ui.activeFeedId === ALL_FEEDS;

  const feedErrors = Object.entries(state.feedState)
    .filter(([, value]) => value.status === 'error')
    .map(([feedId, value]) => ({ feedId, message: value.message ?? 'Failed to load.' }));

  if (!state.hydrated) {
    return (
      <div className="list list--loading" aria-busy="true" aria-live="polite">
        <p className="sr-only">Loading feeds</p>
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton-row" key={index} />
        ))}
      </div>
    );
  }

  if (!state.feeds.length) {
    return (
      <div className="empty-state">
        <Icon name="rss" size={40} />
        <h2>Welcome</h2>
        <p>Add an RSS or Atom feed URL to start reading. You can also import an OPML file.</p>
        <div className="empty-state__actions">
          <button type="button" className="button button--primary" onClick={onAddFeed}>
            Add feed
          </button>
          <button type="button" className="button button--ghost" onClick={onImport}>
            Import OPML
          </button>
        </div>
      </div>
    );
  }

  if (!articles.length) {
    const searching = state.ui.query.trim().length > 0;
    return (
      <div className="list">
        {feedErrors.map((error) => (
          <div className="banner banner--error" role="alert" key={error.feedId}>
            <span>{error.message}</span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void store.refreshFeed(error.feedId)}
            >
              <Icon name="refresh" size={14} />
              Retry
            </button>
          </div>
        ))}
        <div className="empty-state">
          <Icon name={searching ? 'search' : 'inbox'} size={38} />
          <h2>{searching ? 'No matches' : 'Nothing here yet'}</h2>
          <p>
            {searching
              ? 'No articles match your search in this view.'
              : 'Refresh your feeds, or check back later for new articles.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="list" role="feed" aria-label="Articles">
      {feedErrors.map((error) => (
        <div className="banner banner--error" role="alert" key={error.feedId}>
          <span>{error.message}</span>
          <button type="button" className="ghost-button" onClick={() => void store.refreshFeed(error.feedId)}>
            <Icon name="refresh" size={14} />
            Retry
          </button>
        </div>
      ))}

      <ul className="article-list">
        {slice.map((article) => (
          <ArticleRow
            key={article.id}
            article={article}
            read={Boolean(state.readIds[article.id])}
            active={state.ui.activeArticleId === article.id}
            feedName={showFeedName ? feedTitle(article.feedId) : undefined}
          />
        ))}
      </ul>

      {visible < articles.length ? (
        <div className="list__more" ref={sentinelRef}>
          <button type="button" className="button button--ghost" onClick={loadMore}>
            Load more ({articles.length - visible} remaining)
          </button>
        </div>
      ) : (
        <p className="list__end">End of list · {articles.length} articles</p>
      )}
    </div>
  );
}

interface ArticleRowProps {
  article: Article;
  read: boolean;
  active: boolean;
  feedName?: string;
}

function ArticleRow({ article, read, active, feedName }: ArticleRowProps) {
  const time = formatRelativeTime(article.publishedAt);

  const open = () => {
    if (!read) store.toggleRead(article.id);
    store.setActiveArticle(article.id);
  };

  return (
    <li className="article-list__item">
      <article
        className={`article-row ${read ? 'is-read' : ''} ${active ? 'is-active' : ''}`}
        data-article-id={article.id}
        tabIndex={0}
        role="link"
        aria-label={`${article.title}${read ? ' (read)' : ' (unread)'}`}
        aria-current={active ? 'true' : undefined}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
      >
        <span className={`unread-dot ${read ? 'is-read' : ''}`} aria-hidden="true" />

        <div className="article-row__body">
          <div className="article-row__meta">
            {feedName && <span className="article-row__feed">{feedName}</span>}
            <time dateTime={new Date(article.publishedAt).toISOString()}>{time}</time>
            {article.youtubeId && (
              <span className="chip chip--video" title="References a YouTube video">
                <Icon name="play" size={11} /> Video
              </span>
            )}
          </div>

          <h3 className="article-row__title">{article.title}</h3>
          {article.summary && <p className="article-row__excerpt">{article.summary}</p>}
        </div>

        <button
          type="button"
          className="icon-button article-row__toggle"
          onClick={(event) => {
            event.stopPropagation();
            store.toggleRead(article.id);
          }}
          aria-label={read ? 'Mark as unread' : 'Mark as read'}
          title={read ? 'Mark as unread' : 'Mark as read'}
        >
          <Icon name={read ? 'eyeOff' : 'eye'} size={16} />
        </button>
      </article>
    </li>
  );
}
