import React from 'react';
import type { NewsItem } from './news.js';

/**
 * Top stories — the idle state of the answer surface. Renders nothing at all
 * when the feed is empty, so a failed fetch leaves a clean page rather than an
 * empty frame.
 */
export function Stories({ items, limit = 6 }: { items: NewsItem[]; limit?: number }) {
  if (!items.length) return null;
  return (
    <div className="ae-news">
      <div className="ae-news-head">Top stories</div>
      <div className="ae-news-grid">
        {items.slice(0, limit).map((n) => (
          <a key={n.url} className="ae-news-item" href={n.url} target="_blank" rel="noreferrer">
            <span className="ae-news-title">{n.title}</span>
            <span className="ae-news-meta">
              {n.source}
              {typeof n.points === 'number' ? ` · ${n.points} pts` : ''}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
