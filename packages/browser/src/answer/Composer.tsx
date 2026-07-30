import React from 'react';
import type { SearchMode } from '@hanzo/ai';
import { Button, Textarea } from '@hanzo/ui';
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

/** What the composer sends. `chat` goes straight to the model; the rest ground
 *  the question on the live web (`SearchMode` is the wire's own vocabulary).
 *
 *  `deep` is EXCLUDED rather than absent. The wire still names it — dropping it
 *  from `MODES` only stopped it being offered, it stayed a legal `Mode`, so any
 *  call site could still hold one and put the retired name back on the surface.
 *  Excluding it makes the collapse structural. Derived from `SearchMode` and not
 *  restated, so a mode this surface invents is still a type error, and the day
 *  the wire drops `deep` this narrows to nothing on its own. */
export type Mode = Exclude<SearchMode, 'deep'> | 'chat';

/** The modes, in the order they read as escalating effort. */
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'chat', label: 'Chat', hint: 'Straight to the model' },
  { id: 'search', label: 'Search', hint: 'Fast grounded answer' },
  { id: 'news', label: 'News', hint: 'Recency-biased' },
  // No 'deep'. It was research with the dials up — same system prompt, same
  // models, same gate — so two names offered a choice that was really an
  // intensity, and hid a 2x price behind an adjective. Cloud folded them into
  // one research mode (apps/answer/mode.go) that always does the deeper pass;
  // 'deep' still RESOLVES there, so a client that has not shipped this does not
  // 400 — which is why dropping the tab is safe on its own.
  { id: 'research', label: 'Research', hint: 'Plans, reads sources, synthesizes' },
];

export const SOURCES = ['web', 'news', 'academic', 'github', 'reddit', 'x'];

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
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
  return (
    <div className="ae-card">
      {/* @hanzo/ui field — auto-grows by line count (rows is the floor), so the
          DOM-measured resize effect the raw <textarea> needed is gone. Blends
          into .ae-card with transparent bg / no border, matching .ae-input. */}
      <Textarea
        placeholder={mode === 'chat' ? 'Ask anything' : 'Type @ for sources or / for modes'}
        value={value}
        rows={1}
        maxH={200}
        bg="transparent"
        borderWidth={0}
        px={18}
        fontSize={15}
        onChangeText={onChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="ae-card-row">
        {/* The container stays in the row whatever the mode: it is the left half
            of a space-between, so dropping it would slide the toolbar left.
            Chat is ungrounded, so it offers no sources to pick. */}
        <div className="ae-chips">
          {mode !== 'chat' &&
            SOURCES.map((s) => (
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
          {/* @hanzo/ui send control — `isLoading` is the built-in busy signal,
              so the hand-rolled .ae-spinner is gone with the raw <button>. */}
          <Button
            size="icon"
            rounded={999}
            width={34}
            height={34}
            onPress={onSubmit}
            disabled={busy || !value.trim()}
            isLoading={busy}
            aria-label="Search (Enter)"
          >
            {busy ? null : (
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M3 13V3l10 5-10 5z" fill="currentColor" />
              </svg>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
