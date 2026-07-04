// The thin adapter over @canva/design — the only place the Canva Apps SDK is
// touched. It turns Canva's event-driven, draft-based design model into the two
// operations the panel needs: OBSERVE the current selection (its plaintext + a
// mutable handle to overwrite it) and INSERT AI output onto the canvas (add a new
// text element, or replace the selected text in place). All the AI logic lives in
// design-core.ts (pure) and hanzo.ts (@hanzo/ai); this module carries no prompts
// and no model calls — it is pure design I/O.
//
// Canva's contract (@canva/design 2.x):
//   - `selection.registerOnChange({ scope: 'plaintext', onChange })` fires with a
//     `count` and a `read()` that yields a draft whose `contents[].text` are the
//     selected text runs; mutating them and `draft.save()` writes them back.
//   - `addElementAtCursor(textElement)` / `addNativeElement(textElement)` add a
//     new text element at the user's cursor / onto the current page.
//   - `getCurrentPageContext()` yields the page dimensions (used only to size a
//     from-scratch insert sensibly).

import {
  selection,
  addElementAtCursor,
  type TextElement,
} from '@canva/design';

// ---- Selection observation ------------------------------------------------

// SelectionSnapshot is what the panel needs to reason about the current
// selection without holding a Canva draft: how many text elements are selected
// and their combined plaintext (for context assembly and for showing the user
// what rewrite/translate will act on). A draft is short-lived and must be
// re-read at write time, so we never stash it — see replaceSelectedText.
export interface SelectionSnapshot {
  /** Number of selected plaintext elements. 0 means nothing text is selected. */
  count: number;
  /** The selected text runs joined with newlines — '' when count is 0. */
  text: string;
}

// onSelectionChange subscribes to plaintext selection changes and calls back with
// a SelectionSnapshot each time. It reads the draft only to extract the text (it
// never mutates or saves here) and returns the SDK's unsubscribe function so the
// panel can tear the listener down on unmount. This is the panel's single source
// of "what is selected right now".
export function onSelectionChange(cb: (snap: SelectionSnapshot) => void): () => void {
  return selection.registerOnChange({
    scope: 'plaintext',
    onChange: async (event) => {
      if (event.count === 0) {
        cb({ count: 0, text: '' });
        return;
      }
      const draft = await event.read();
      const text = draft.contents.map((c) => c.text).join('\n');
      cb({ count: event.count, text });
    },
  });
}

// ---- Writing output onto the canvas ---------------------------------------

// replaceSelectedText overwrites the currently-selected plaintext with `text`.
// Canva requires the write to happen inside a fresh draft read (the snapshot the
// panel holds may be stale), so we register a one-shot listener, read the current
// draft, write every selected run — the first run gets the full replacement and
// any further runs are cleared so N selected elements collapse to the one new
// value — save, and unsubscribe. Resolves once saved; rejects if nothing is
// selected when the write is attempted.
export function replaceSelectedText(text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const unsubscribe = selection.registerOnChange({
      scope: 'plaintext',
      onChange: async (event) => {
        if (done) return;
        done = true;
        try {
          if (event.count === 0) {
            reject(new Error('No text is selected to replace'));
            return;
          }
          const draft = await event.read();
          draft.contents.forEach((c, i) => {
            c.text = i === 0 ? text : '';
          });
          await draft.save();
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        } finally {
          unsubscribe();
        }
      },
    });
  });
}

// insertText adds a new text element carrying `text` at the user's cursor. Used
// for generate / ideas / translate-as-new — anything that adds copy rather than
// editing the selection. `fontSize` sizes it (a headline larger than a caption);
// Canva positions it at the cursor.
export function insertText(text: string, fontSize = 24): Promise<void> {
  const element: TextElement = {
    type: 'text',
    children: [text],
    fontSize,
  };
  return addElementAtCursor(element);
}
