import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { store } from '../store/store';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useStore } from '../hooks/useStore';
import { useVisibleArticles } from '../hooks/useVisibleArticles';
import { leaveArticle } from '../lib/viewHistory';
import { flushPositions, positionFor, rememberPosition, clampPosition } from '../lib/readingPosition';
import { ArticleDetail } from './ArticleDetail';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../lib/i18n';
import { cleanTitle } from '../lib/format';

/** Reader overlay: blurred backdrop over the news column, previous/next arrows and close. */
type BackdropFrame = { left: number; top: number; width: number; height: number };

/** Box of the news column: the reader neither covers nor blurs the sidebar. */
function readContentFrame(): BackdropFrame | null {
  const element = document.querySelector('.content-area');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function ArticleOverlay() {
  const state = useStore();

  /**
   * On narrow layouts the sidebar is an off-canvas drawer, so the reader keeps
   * the modal behaviour (trap, aria-modal, everything locked). On desktop it is
   * non-modal: the sidebar and the top bar stay crisp, reachable and usable.
   */
  const modal = useMediaQuery('(max-width: 68.75rem)');

  const [frame, setFrame] = useState<BackdropFrame | null>(() => readContentFrame());

  useLayoutEffect(() => {
    if (modal) return;
    const sync = () => setFrame(readContentFrame());
    sync();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    const content = document.querySelector('.content-area');
    const sidebar = document.querySelector('.sidebar');
    if (observer) {
      if (content) observer.observe(content);
      if (sidebar) observer.observe(sidebar);
    }
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
      observer?.disconnect();
    };
  }, [modal]);

  const backdropStyle: CSSProperties | undefined =
    !modal && frame
      ? {
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          right: 'auto',
          bottom: 'auto',
        }
      : undefined;

  /**
   * The blurred grid behind the reader is decoration, not a second page: it
   * must leave the tab order and the accessibility tree. `.content-area` is a
   * stable node (the list inside it may re-render), and the reader itself is
   * rendered at the app root, so the sidebar and top bar stay usable.
   */
  useEffect(() => {
    const content = document.querySelector<HTMLElement>('.content-area');
    if (!content) return;
    content.inert = true;
    return () => {
      content.inert = false;
    };
  }, []);

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
      modal={modal}
      ariaLabelledBy="article-reader-title"
      size="lg"
      className="article-overlay__dialog"
      backdropClassName="article-overlay__backdrop"
      backdropStyle={backdropStyle}
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
