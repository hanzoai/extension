# Hanzo AI for Figma

A Figma & FigJam plugin that puts Hanzo AI next to your canvas. Select layers or
a frame and:

- **Improve copy** — tighten and clarify the selected text layers.
- **Translate** — localize every text layer in the selection to a target
  language (placeholders like `{name}` / `%s` preserved).
- **Fill content** — replace lorem/placeholder text with realistic, on-brand copy.
- **Rename layers** — give the selected layers sensible, consistent names.
- **Critique + a11y** — a plain-language design critique plus an accessibility
  review (color-contrast risks from the actual layer colors, WCAG AA notes).
- **Variants** — generate options, e.g. "3 headline options" or "dark-mode copy",
  and insert any of them onto the canvas.

The AI runs on the [api.hanzo.ai](https://api.hanzo.ai) gateway through the
published [`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai) headless client.
Your Hanzo API key (`hk-…`) is pasted once, validated against `/v1/models`, and
stored only inside the plugin (`figma.clientStorage`). Nothing is sent anywhere
but `api.hanzo.ai`.

## How it works (two threads)

A Figma plugin is a **main thread** (`code.js` — full `figma.*` document access,
no DOM, no network) plus an **iframe UI** (`ui.html` — DOM and network, no
document access). They talk over `postMessage`.

```
 selection  ┌───────────── main thread (code.ts) ─────────────┐
 change ───▶│ serialize selection → SelectionSnapshot (data)   │
            └───────────────────────┬─────────────────────────┘
                                    │ postMessage: { selection }
                                    ▼
            ┌───────────── iframe UI (ui.ts) ─────────────────┐
 chip ─────▶│ design-core.stream(action, snapshot, note)       │
 click      │   → @hanzo/ai → live tokens                      │
            │ design-core.parseResult(action, snapshot, text)  │
            └───────┬───────────────────┬─────────────────────┘
                    │ apply-edits        │ insert-text (variants)
                    ▼                    ▼
            ┌───────────── main thread (code.ts) ─────────────┐
            │ load fonts → setCharacters / rename / createText │
            └─────────────────────────────────────────────────┘
```

The **AI call happens only in the iframe** (the main thread has no `fetch`). The
main thread only reads the selection and writes results back onto nodes. All the
pure logic — the action catalog, prompt building, selection→context assembly and
truncation, and response parsing — lives in `design-core.ts` and is unit-tested.

## Develop locally

Prerequisites: Node ≥ 18, `pnpm`, and the Figma desktop app.

```bash
pnpm install                      # from the repo root
pnpm --filter @hanzo/figma build  # → packages/figma/dist/{code.js, ui.html, manifest.json}
# or, from packages/figma:
pnpm build      # one-shot
pnpm watch      # rebuild on change
pnpm test       # vitest (design-core + messaging)
pnpm typecheck  # tsc --noEmit
```

Import into Figma:

1. Open the **Figma desktop app** (browser Figma cannot load a local plugin).
2. **Menu → Plugins → Development → Import plugin from manifest…**
3. Select `packages/figma/dist/manifest.json`.
4. Run it from **Plugins → Development → Hanzo AI** on any file (or a FigJam
   board). Paste your `hk-` key on first run.

With `pnpm watch` running, re-run the plugin after a change to pick up the new
build (Figma reloads the manifest's `code.js`/`ui.html` each launch).

## Publish to the Figma Community

1. `pnpm --filter @hanzo/figma build`.
2. In the Figma desktop app, right-click the plugin under **Plugins →
   Development** → **Publish…** (or **Manage plugins in development**).
3. Fill in the name, description, icon, and cover art, then submit for review.
   The `manifest.json` already declares `editorType: ["figma", "figjam"]` and
   `networkAccess.allowedDomains: ["https://api.hanzo.ai"]` with a reason, which
   the Community review requires.

## Layout

```
packages/figma/
├── manifest.json          Figma plugin manifest (main → code.js, ui → ui.html)
├── build.js               esbuild: code.js (IIFE) + ui.html (JS+CSS inlined)
├── src/
│   ├── code.ts            MAIN thread: serialize selection, write back nodes
│   ├── ui.ts              IFRAME: the panel; the only place @hanzo/ai is called
│   ├── ui.html / ui.css   the panel shell (single inlined file at build time)
│   ├── design-core.ts     PURE: action catalog, prompts, context, parsing, run
│   ├── messaging.ts       typed postMessage protocol (main ↔ iframe)
│   └── config.ts          gateway base, default model, storage keys, budget
└── tests/                 vitest over design-core + messaging
```

## Notes

- **Context budget.** A big frame won't fit a model window, so the selection is
  serialized (text layers first, then structure, with ids and colors) and
  truncated to a character budget — with an honest note in the prompt and the
  panel when anything was dropped.
- **Write-back safety.** Rewrite/translate/fill/rename ask the model for a strict
  JSON `id → value` map; only ids that are actually in the current selection are
  applied, so the model cannot mutate nodes it wasn't shown.
- **Fonts.** Setting text requires the node's fonts to be loaded first; the main
  thread loads every font range before writing.
- **Theme.** The panel uses Figma's injected theme variables, so it matches the
  editor's light/dark mode with no toggle.

MIT © Hanzo AI
