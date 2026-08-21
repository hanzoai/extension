import React from 'react';
import type { SearchMode } from '@hanzo/ai';
import { Button, XStack } from '@hanzo/ui';

/**
 * What the composer's toolbar slot holds on this surface: how to ask (mode) and
 * where to look (sources).
 *
 * The composer itself is `@hanzo/ui/chat`. It owns the field, the Enter rule and
 * the send/stop control — the parts every Hanzo surface shares — and hands back
 * one slot for the affordances that are only true here. Modes and sources are
 * exactly that, so this is what is left after the shell took the rest.
 *
 * Presentational: the selection and both effects arrive as props.
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

export interface ToolbarProps {
  mode: Mode;
  setMode: (mode: Mode) => void;
  sources: Set<string>;
  toggleSource: (source: string) => void;
}

export function Toolbar({ mode, setMode, sources, toggleSource }: ToolbarProps) {
  return (
    // Wraps rather than overflows: ten controls do not fit one row beside the
    // picker and the send control at a reading measure, and the composer's
    // toolbar row does not wrap for its children.
    <XStack shrink={1} minW={0} items="center" gap="$2" flexWrap="wrap">
      <XStack data-slot="modes" items="center" gap="$1">
        {MODES.map((m) => (
          <Button
            key={m.id}
            data-mode={m.id}
            data-on={mode === m.id ? 'true' : undefined}
            size="sm"
            variant={mode === m.id ? 'secondary' : 'ghost'}
            title={m.hint}
            onPress={() => setMode(m.id)}
          >
            {m.label}
          </Button>
        ))}
      </XStack>
      {/* The container stays in the row whatever the mode: dropping it would
          slide the rest of the toolbar left as soon as Chat is picked. Chat is
          ungrounded, so it offers no sources to pick. */}
      <XStack data-slot="sources" items="center" gap="$1">
        {mode !== 'chat' &&
          SOURCES.map((s) => (
            <Button
              key={s}
              data-source={s}
              data-on={sources.has(s) ? 'true' : undefined}
              size="sm"
              variant={sources.has(s) ? 'secondary' : 'ghost'}
              title={`@${s}`}
              onPress={() => toggleSource(s)}
            >
              @{s}
            </Button>
          ))}
      </XStack>
    </XStack>
  );
}
