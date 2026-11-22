import { useEffect, useMemo, useRef } from 'react';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { useVisibleArticles } from '../hooks/useVisibleArticles';
import { leaveArticle } from '../lib/viewHistory';
import { flushPositions, positionFor, rememberPosition, clampPosition } from '../lib/readingPosition';
import { ArticleDetail } from './ArticleDetail';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../lib/i18n';
import { cleanTitle } from '../lib/format';

/** Reader overlay: blurred backdrop, previous/next arrows and close. */
export function ArticleOverlay() {
  const state = useStore();

  const articles = useVisibleArticles(state);

  const article = useMemo(
    () =>
      Object.values(state.articles)
        .flat()
        .find((item) => item.id === state.ui.activeArticleId),
    [state.articles, state.ui.activeArticleId]
  );

  /**
   * The reader keeps its own scroll container (the dialog). Remember where the
   * article was left and restore it on open; the dashboard behind the backdrop
   * keeps its own position untouched.
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const articleId = article?.id ?? null;
  useEffect(() => {
    if (!articleId) return;
    const scroller = contentRef.current?.closest<HTMLElement>('.article-overlay__dialog');
    if (!scroller) return;

    const target = positionFor(articleId);
    const frame = requestAnimationFrame(() => {
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = clampPosition(target, max);
    });
    const onScroll = () => rememberPosition(articleId, scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      flushPositions();
    };
  }, [articleId]);

  if (!article) return null;

  const index = articles.findIndex((item) => item.id === article.id);
  const previous = index > 0 ? articles[index - 1] : null;
  const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : null;
  const position = index >= 0 ? index + 1 : 0;

  const open = (id: string) => {
    if (!state.readIds[id]) store.toggleRead(id);
    store.setActiveArticle(id);
  };

  return (
    <Dialog
      open
      onClose={leaveArticle}
      title=""
      bare
      ariaLabel={cleanTitle(article.title)}
      size="lg"
      className="article-overlay__dialog"
      backdropClassName="article-overlay__backdrop"
      backdropChildren={
        <>
          <button
            type="button"
            className="article-overlay__nav article-overlay__nav--prev"
            onClick={() => previous && open(previous.id)}
            disabled={!previous}
            aria-label={t('Previous article')}
            aria-keyshortcuts="ArrowLeft"
            title={t('Previous article')}
          >
            <Icon name="back" size={20} />
          </button>
          <button
            type="button"
            className="article-overlay__nav article-overlay__nav--next"
            onClick={() => next && open(next.id)}
            disabled={!next}
            aria-label={t('Next article')}
            aria-keyshortcuts="ArrowRight"
            title={t('Next article')}
          >
            <Icon name="chevronRight" size={20} />
          </button>
        </>
      }
    >
      <p className="sr-only" role="status" aria-live="polite">
        {t('Article {index} of {total}: {title}', {
          index: position,
          total: articles.length,
          title: cleanTitle(article.title),
        })}
      </p>
      <div ref={contentRef}>
        <ArticleDetail />
      </div>
    </Dialog>
  );
}
