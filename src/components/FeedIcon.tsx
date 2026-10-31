import { useState } from 'react';
import type { Feed } from '../types';
import { faviconUrl } from '../lib/url';

interface FeedIconProps {
  feed: Feed;
  className?: string;
  /** Skip remote favicons (long settings lists) and use the letter badge. */
  lettersOnly?: boolean;
}

/** Favicon with a letter-avatar fallback when the icon is missing or fails. */
export function FeedIcon({ feed, className = '', lettersOnly = false }: FeedIconProps) {
  const [failed, setFailed] = useState(false);
  const src = lettersOnly || failed ? null : feed.iconUrl || faviconUrl(feed);
  const letter = (feed.title || '?').trim().charAt(0).toUpperCase();

  if (!src) {
    return (
      <span className={`feed-icon feed-icon--letter ${className}`} aria-hidden="true">
        {letter}
      </span>
    );
  }
  return (
    <img
      className={`feed-icon ${className}`}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
