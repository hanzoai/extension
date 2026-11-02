import type { SearchMode } from '@hanzo/ai';
import type { Way } from '@hanzo/ui/chat';

/**
 * How to ask (the mode) and where to look (the sources) — this surface's two
 * lists, as data. The composer draws them: the mode is the word at the end of
 * the line under its frame, the sources are the quiet words at its start.
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

/** The modes, in the order they read as escalating effort. Each note is the
 *  line the mode's list shows under its name. */
export const MODES: readonly Way<Mode>[] = [
  { id: 'chat', label: 'Chat', note: 'Straight to the model' },
  { id: 'search', label: 'Search', note: 'Fast grounded answer' },
  { id: 'news', label: 'News', note: 'Recency-biased' },
  // No 'deep'. It was research with the dials up — same system prompt, same
  // models, same gate — so two names offered a choice that was really an
  // intensity, and hid a 2x price behind an adjective. Cloud folded them into
  // one research mode (apps/answer/mode.go) that always does the deeper pass;
  // 'deep' still RESOLVES there, so a client that has not shipped this does not
  // 400 — which is why dropping the tab is safe on its own.
  { id: 'research', label: 'Research', note: 'Plans, reads sources, synthesizes' },
];

/** Where a grounded answer may look. Chat is ungrounded and offers none. */
export const SOURCES = ['web', 'news', 'academic', 'github', 'reddit', 'x'];
