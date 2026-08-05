import React from 'react';
import type { SearchSource } from '@hanzo/ai';

/**
 * One cited source, numbered to match its marker in the answer body.
 * Falls back to the raw URL when the host will not parse, and to a dot when the
 * site serves no favicon — a citation always renders.
 */
export function Source({ source, index }: { source: SearchSource; index: number }) {
  let host: string;
  try {
    host = new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    host = source.url;
  }
  return (
    <a className="ae-source" href={source.url} target="_blank" rel="noreferrer" title={source.title}>
      <span className="ae-source-head">
        <span className="ae-source-idx">{index + 1}</span>
        {source.favicon ? <img src={source.favicon} alt="" width="14" height="14" /> : <span className="ae-dot" />}
        <span className="ae-source-host">{host}</span>
      </span>
      <span className="ae-source-title">{source.title}</span>
    </a>
  );
}
