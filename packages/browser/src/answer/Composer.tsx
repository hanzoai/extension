import React, { useEffect, useRef } from 'react';
import type { SearchMode } from '@hanzo/ai';
import { Models } from './Models.js';
import type { ChatModel, ModelGroup } from './model-catalog.js';

/**
 * The composer: an auto-growing field over one toolbar row — source pills on the
 * left, mode tabs + model picker + a single send control on the right.
 *
 * Enter sends; Shift+Enter writes a newline. The send control is also the busy
 * indicator, so there is exactly one control for "go" and one signal for "running".
 *
 * Presentational: every value and every effect is injected. It owns no query
 * state and never calls a backend — mount it wherever the answer surface lives.
 */

export const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: 'search', label: 'Search', hint: 'Fast grounded answer' },
  { id: 'news', label: 'News', hint: 'Recency-biased' },
  { id: 'research', label: 'Research', hint: 'Multi-source synthesis' },
  { id: 'deep', label: 'Deep', hint: 'Plan + wide research' },
];

export const SOURCES = ['web', 'news', 'academic', 'github', 'reddit', 'x'];

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  mode: SearchMode;
  setMode: (mode: SearchMode) => void;
  sources: Set<string>;
  toggleSource: (source: string) => void;
  models: ModelGroup[];
  model: ChatModel;
  setModel: (model: ChatModel) => void;
  busy: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  mode,
  setMode,
  sources,
  toggleSource,
  models,
  model,
  setModel,
  busy,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = field.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  return (
    <div className="ae-card">
      <textarea
        ref={field}
        className="ae-input"
        placeholder="Type @ for sources or / for modes"
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="ae-card-row">
        <div className="ae-chips">
          {SOURCES.map((s) => (
            <button
              key={s}
              className={'ae-chip' + (sources.has(s) ? ' on' : '')}
              onClick={() => toggleSource(s)}
              title={`@${s}`}
            >
              @{s}
            </button>
          ))}
        </div>
        <div className="ae-card-right">
          <div className="ae-modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={'ae-mode' + (mode === m.id ? ' on' : '')}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Models groups={models} current={model} onPick={setModel} />
          <button className="ae-send" onClick={onSubmit} disabled={busy || !value.trim()} title="Search (Enter)">
            {busy ? (
              <span className="ae-spinner" />
            ) : (
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M3 13V3l10 5-10 5z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
