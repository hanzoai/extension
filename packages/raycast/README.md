# Hanzo AI for Raycast

Hanzo AI in the [Raycast](https://raycast.com) command bar. Ask Hanzo anything,
and run one-keystroke actions over whatever you have selected in the frontmost
app (or your clipboard): **Summarize · Explain · Rewrite · Translate · Fix
Grammar**. Wired to the `api.hanzo.ai` gateway through the published
[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai) headless client — the same
gateway and model catalog as the Hanzo browser extension, Office add-in, and
design apps.

## Commands

| Command | Mode | What it does |
| --- | --- | --- |
| **Ask Hanzo** | view | A form (prompt + action + model) → a `Detail` that **streams** the answer live. Copy or paste the result. |
| **Summarize** | no-view | Summarize the selection/clipboard; copies the summary. Optional focus argument. |
| **Explain** | no-view | Explain the selection/clipboard in plain language; copies it. Optional audience argument. |
| **Rewrite** | no-view | Rewrite the selection; **pastes** it back over the selection. Optional instruction argument. |
| **Translate** | no-view | Translate the selection into a target language argument (e.g. `Spanish`); pastes it back. |
| **Fix Grammar** | no-view | Correct grammar/spelling/punctuation of the selection; pastes it back. |

### Selection → action → paste flow

The quick-action commands share one path (`src/run-action.ts`):

1. **Capture** — read the frontmost app's selection via `getSelectedText()`; if
   there is none, fall back to `Clipboard.readText()` (`captureSubject` /
   `chooseSubject`). Selection wins over clipboard.
2. **Build** — the captured text is fenced as *data* and layered under the
   action's prompt (`buildActionMessages`), capped at a character budget with
   honest truncation.
3. **Run** — one call through `@hanzo/ai` (`runChat`, or `streamChat` for Ask).
4. **Return** — the reply is stripped of code fences / wrapping quotes
   (`parseResult`) and then either **pasted back over the selection**
   (`Clipboard.paste` — Rewrite / Translate / Fix Grammar) or **copied**
   (`Clipboard.copy` — Summarize / Explain).

## Configuration

Set these in Raycast → Extensions → Hanzo AI (⌘,):

- **Hanzo API Key** (required) — your `sk-…` key from
  [hanzo.id](https://hanzo.id). Stored securely by Raycast (a `password`
  preference); sent only to `api.hanzo.ai` as a bearer. Never committed.
- **Model** (optional) — default model id routed by the gateway (default
  `zen5`). Override per request in **Ask Hanzo**.

## Development

Requires [Raycast](https://raycast.com) (macOS) and Node ≥ 18.

```bash
# from the monorepo root
pnpm install

# in this package
cd packages/raycast

pnpm dev        # ray develop — hot-reloads the extension into Raycast
pnpm build      # ray build -e dist — validates the manifest, typechecks, bundles
pnpm lint       # ray lint (ESLint 9 flat config + Prettier + manifest checks)
pnpm fix-lint   # ray lint --fix
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run — the pure logic (prompts, context, request shaping, parsing)
```

`ray develop` opens Raycast with the extension loaded from source; edits reload
live. The pure logic lives in `src/actions.ts`, `src/hanzo.ts`, and
`src/config.ts` and is fully unit-tested; the `@raycast/api` React views
(`src/ask.tsx`) are intentionally kept thin over that logic.

## Publishing to the Raycast Store

```bash
npm run publish   # npx @raycast/api@latest publish
```

`ray publish` validates the manifest, builds, and opens a PR against
[`raycast/extensions`](https://github.com/raycast/extensions) (or your private
Store). Requirements the CLI enforces:

- **`author`** must be a registered Raycast username. This extension is authored
  as `hanzo`; claim/verify the handle at
  [raycast.com](https://www.raycast.com) before the first publish (the lint
  step's author check hits `raycast.com/api/v1/users/<author>`).
- A 512×512 PNG icon (`assets/hanzo-icon.png`) and a filled-in `categories`,
  `description`, and per-command `title`/`description` — all present in
  `package.json`.

## Architecture

One and only one way through the stack — pure core, thin adapters:

```
src/
  config.ts       gateway URLs, default model, sk- key guard      (pure)
  actions.ts      action catalog, prompts, context assembly,      (pure)
                  capture policy (chooseSubject), response parsing
  hanzo.ts        the ONLY caller of @hanzo/ai: runChat /          (thin adapter)
                  streamChat / listModels
  selection.ts    the ONLY caller of @raycast/api I/O: read        (thin adapter)
                  selection/clipboard, preferences, paste/copy
  run-action.ts   the shared quick-action runner (validate →       (glue)
                  capture → build → run → parse → paste/copy)
  ask.tsx         the Ask view command (Form → streaming Detail)   (view)
  summarize.ts    explain.ts  rewrite.ts  translate.ts  fix-grammar.ts
                  one-line command entry points over run-action.ts
```

Every network call goes through `@hanzo/ai` at `api.hanzo.ai/v1/...` — no `/api/`
prefix, no reimplemented transport. This mirrors `@hanzo/canva` and
`@hanzo/figma` so the Hanzo productivity suite stays consistent.

## License

MIT © Hanzo AI
