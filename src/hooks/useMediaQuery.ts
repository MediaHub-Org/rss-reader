import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. The reader uses it to stay a modal full-screen
 * dialog on narrow layouts (where the sidebar is an off-canvas drawer) and a
 * non-modal overlay over the news column on desktop.
 */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported) return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query, supported]);

  return matches;
}
