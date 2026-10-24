import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store } from '../store/store';
import type { AppState } from '../types';

/** Subscribe React to the external store. */
export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Windowed list rendering: renders `pageSize` rows at a time and grows whenever
 * the sentinel element scrolls into view (infinite scroll, with a fallback to a
 * "load more" button when IntersectionObserver is unavailable).
 */
export function useInfiniteList(length: number, pageSize = 30): {
  visible: number;
  sentinelRef: (node: HTMLElement | null) => void;
  loadMore: () => void;
} {
  const [visible, setVisible] = useState(pageSize);
  const sentinel = useRef<HTMLElement | null>(null);

  // Shrink back when the underlying list shrinks (filter/sort/feed change).
  useEffect(() => {
    setVisible((current) => Math.max(pageSize, Math.min(current, length)));
  }, [length, pageSize]);

  const observer = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinel.current = node;
    observer.current?.disconnect();
    if (!node || typeof IntersectionObserver === 'undefined') return;

    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible((current) => current + pageSize);
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.current.observe(node);
  }, [pageSize]);

  useEffect(() => () => observer.current?.disconnect(), []);

  const loadMore = useCallback(() => setVisible((current) => current + pageSize), [pageSize]);

  return { visible: Math.min(visible, Math.max(length, 0)), sentinelRef, loadMore };
}

/** Focus an element once on mount — used for dialog initial focus. */
export function useAutoFocus<T extends HTMLElement>(enabled = true): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return ref;
}

/** Debounce a rapidly-changing value (search box). */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
