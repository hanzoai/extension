# Hanzo AI for Sketch

`@hanzo/sketch` — a native Sketch plugin that puts Hanzo AI on your macOS design
canvas. Critique a selection, rewrite / translate / content-fill text layers, and
ask about your design, without leaving Sketch.

It is a **thin adapter over the shared Hanzo design-AI action catalog** — the same
prompt builders, context assembly, and response parsing that back
[`@hanzo/figma`](../) and `@hanzo/canva`, expressed once as the PURE
[`design-core.ts`](src/design-core.ts). Model calls route through the
`api.hanzo.ai` gateway via the published [`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)
headless client. No `/api/` prefix, ever — always `/v1/...`.

## Design actions

| Command                          | What it does                                                                 | Write-back            |
| -------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| **Summarize / critique selection** | UX/copy/hierarchy critique of the selection, leading with a one-line take.   | Inserts a note layer  |
| **Rewrite selected text**        | Rewrites each text layer's copy (optionally per an instruction).            | `layer.text = …`      |
| **Translate text layers**        | Translates each text layer into a target language.                          | `layer.text = …`      |
| **Content fill**                 | Replaces each text layer with realistic, role-fitting placeholder copy.     | `layer.text = …`      |
| **Ask Hanzo…**                   | Free-form question about the selection.                                     | Inserts a note layer  |

`rewrite`, `translate`, and `contentfill` are **per-layer**: the model returns a
JSON array positionally aligned to the selected layers, parsed by
`parseLayerEdits` into `{ id, name, text }` edits the panel previews before you
**Apply to layers**. `critique` and `ask` return prose you can **Add note to
canvas** as a new Text layer next to the selection.

## Selection read → write-back flow

```
Sketch selection
  │  command.js → sketch-bridge.readSelection()   (sketch/dom)
  ▼
Selection { layers: TextLayer[], totalCount }
  │  seeded into the WebView (window.__hanzoSeed)
  ▼
design-core.runAction()  →  @hanzo/ai createAiClient().chat.completions.create()
  │  (the model call runs in the WebView — it has fetch)
  ▼
raw text
  ├─ per-layer  → parseLayerEdits(raw, layers) → LayerEdit[]
  │                window.postMessage('applyEdits') → sketch-bridge.applyLayerEdits()
  │                                                    layer.text = edit.text
  └─ prose      → resultNote(id, raw) → { heading, body }
                   window.postMessage('insertNote') → sketch-bridge.insertNote()
                                                       new sketch.Text(...)
```

`sketch-bridge.js` is the ONLY file that touches `sketch/dom`; `design-core.ts`
is pure and fully unit-tested.

## Your Hanzo key

The plugin never bundles or commits a key. Open the panel, expand **Hanzo key &
model**, paste an `hk-…` Hanzo API key (or an IAM access token from
[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)), and **Save**. It is
stored per-plugin with `sketch/settings`. Optionally set a model (default
`zen5`).

## Build

```bash
pnpm install          # from the monorepo root
pnpm --filter @hanzo/sketch build      # → dist/Hanzo AI.sketchplugin
pnpm --filter @hanzo/sketch watch      # rebuild on change
pnpm --filter @hanzo/sketch test       # vitest
pnpm --filter @hanzo/sketch typecheck  # tsc --noEmit
```

`build.js` assembles the `.sketchplugin` bundle in two esbuild passes:
`command.js` → `Contents/Sketch/` as CommonJS for Sketch's CocoaScript runtime
(`sketch/*` external), and the WebView `app.ts` (with `@hanzo/ai` bundled) →
`Contents/Resources/app.js` as a browser IIFE, alongside `webview.html`, the
`manifest.json`, and the icon.

## Install

- **Local:** run the build, then double-click `dist/Hanzo AI.sketchplugin`.
  Sketch installs it into
  `~/Library/Application Support/com.bohemiancoding.sketch3/Plugins/`.
- The commands appear under **Plugins → Hanzo AI** with the shortcuts declared in
  `manifest.json` (⌃⇧K critique, ⌃⇧R rewrite, ⌃⇧T translate, ⌃⇧F content-fill,
  ⌃⇧A ask).

## Publish to the Sketch plugin directory

The build produces a standards-compliant `.sketchplugin` bundle with a
`manifest.json` (`identifier: ai.hanzo.sketch`, `appcast`, `bundleVersion`).
To publish to the [Sketch plugin directory](https://www.sketch.com/extensions/plugins/):

1. Host the built `.sketchplugin` and a Sparkle `appcast.xml` (the `appcast` URL
   in the manifest) so Sketch can auto-update installs.
2. Tag a release in the plugin's GitHub repo containing the built bundle.
3. Submit the repo via the Sketch extensions submission form; Sketch reviews and
   lists it. Bump `version`/`bundleVersion` in `manifest.json` on each release —
   patch bumps only.

## Layout

```
src/
  manifest.json       Sketch plugin manifest — 5 commands + menu
  command.cjs         plugin entry (CommonJS, CocoaScript runtime): opens the WebView, bridges messages
  sketch-bridge.cjs   sketch/dom read (readSelection) + write-back (applyLayerEdits, insertNote)
  design-core.ts      PURE: action catalog, context assembly/truncation, @hanzo/ai shaping, parsing
  webview/
    index.html        the assistant panel
    app.ts            panel logic over design-core + @hanzo/ai (built to Resources/app.js)
build.js              assembles the .sketchplugin bundle
tests/                vitest — the pure design-core + bridge helpers
```

`command.cjs` and `sketch-bridge.cjs` are CommonJS (`.cjs`) because they run on
Sketch's JavaScriptCore/CocoaScript runtime, not Node ESM. `build.js` emits them
as `Contents/Sketch/command.js` for the manifest to reference.
