# Hanzo AI for Canva

A Canva **Apps SDK** side-panel app that puts Hanzo's models next to your design.
Non-designers, marketers, and SMBs — Canva's core audience — get copywriting help
without leaving the canvas:

- **Generate copy** — headlines, captions, and marketing copy from a short brief.
- **Rewrite selected text** — tighten, restyle, or restate the text you selected, in place.
- **Translate** — the selected text into any language, tone preserved.
- **Content ideas** — a numbered list of angles for a topic; click one to add it.
- **Ask** — a question about the design or its copy.

It reads the current selection and page via `@canva/design`, runs the model gateway
through the **published `@hanzo/ai`** headless client over `api.hanzo.ai`, and adds or
replaces text elements with the result. You paste your own Hanzo `sk-` key; the app
holds no secret and calls no `/api/` path — only `api.hanzo.ai/v1/...`.

## Architecture — one way to do everything

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `src/design-core.ts` | **PURE.** The action catalog, prompt builders, design-context assembly + truncation, and response parsing. No SDK, no DOM. Fully unit-tested. | — |
| `src/hanzo.ts` | Thin wrapper over `@hanzo/ai` — the only place the model gateway is called. | `@hanzo/ai` |
| `src/canva.ts` | Thin adapter over `@canva/design` — read the selection, replace it, insert a new text element. | `@canva/design` |
| `src/config.ts` | Gateway base URL, default model, context budget, `sk-` key guard. | — |
| `src/app.tsx` | The App UI Kit panel — binds the three above to widgets; holds only UI state. | `@canva/app-ui-kit` |
| `src/index.tsx` | Entry — mounts `App` under `AppUiProvider`. | `react-dom`, `@canva/app-ui-kit` |

The design-core mirrors [`@hanzo/figma`](../figma)'s design-core so the two design
apps expose the same five actions with the same context/prompt/parse contracts.

### The read-selection → insert-text flow

1. On mount, `canva.ts` `onSelectionChange` subscribes to `selection.registerOnChange({ scope: 'plaintext' })`. Each change yields a `SelectionSnapshot` (`count`, joined `text`); the panel gates **Rewrite** / **Translate** on `count > 0` and shows a preview of the selected text.
2. You pick an action, add a brief/question/language as needed, and press **Run**.
3. `design-core.buildActionMessages(id, inputs, { selection })` resolves the action's task, fences the observed design as **data** (with an honest truncation note if it was cut), and returns the OpenAI-shaped message list.
4. `hanzo.runChat(messages, { token, model })` calls `@hanzo/ai` `chat.completions.create` (non-streaming) and returns the assistant text.
5. `design-core.parseCopy` / `parseIdeas` strips code fences, wrapping quotes, and list markers into paste-ready text.
6. You press **Replace selection** (Rewrite → `canva.replaceSelectedText`, which reads a fresh draft, overwrites `draft.contents[].text`, and `draft.save()`s) or **Add to design** (everything else → `canva.insertText` → `addElementAtCursor` with a new `TextElement`). Ideas insert one line per click.

## Develop locally

Prerequisites: Node 18+, pnpm, and a Canva account.

### 1. Create the app in the Canva Developer Portal

1. Go to <https://www.canva.com/developers/apps> and **Create an app**.
2. Under **App details**, copy the **App ID**.
3. Under **Add features → Editing**, enable the app to run in the editor side panel (this app needs the *Design editing* scope: read the selection, add/replace elements).
4. Under **Configure your app**, set the **Development URL** to the CLI/preview origin (default `http://localhost:8080`).

### 2. Configure

```bash
cd packages/canva
cp .env.template .env
# put your App ID into CANVA_APP_ID
```

### 3. Install, test, build

```bash
pnpm install            # from the repo root (workspace)
pnpm --filter @hanzo/canva test       # vitest — the pure design-core + hanzo shaping
pnpm --filter @hanzo/canva typecheck  # tsc --noEmit, strict
pnpm --filter @hanzo/canva build      # esbuild → dist/{index.html,app.js,app.css}
```

### 4. Preview in Canva

Serve the bundle and point the Developer Portal's Development URL at it. With the
Canva CLI:

```bash
npx @canva/cli@latest login
pnpm --filter @hanzo/canva watch      # rebuilds dist/ on change
npx @canva/cli@latest apps preview    # opens the app in the Canva editor, hot-reloading
```

Open any design, launch **Hanzo AI** from the app side panel, paste your `sk-` key,
pick a model, and run an action. Select text on the canvas to enable **Rewrite** and
**Translate**.

### Getting a Hanzo `sk-` key

Sign in at <https://hanzo.id> and mint an API key (prefixed `sk-`). The panel
validates the prefix before use and sends it as the bearer to `api.hanzo.ai`. The key
lives only in the panel's session state — it is never persisted or bundled.

## Submit to the Canva Apps Marketplace

1. Finish and test the app in preview; ensure `pnpm build` is clean and `dist/` loads.
2. Host `dist/` on your production origin (behind `hanzoai/ingress` + the `hanzoai/static` plugin — never nginx/caddy) and set the app's production **App source URL** to it.
3. In the Developer Portal, complete **App listing** (name, icon, description, screenshots) and **Submit for review**.
4. Canva reviews for the requested scopes (Design editing here) and UX. Address feedback and resubmit; on approval the app is published to the Apps Marketplace.

## Tests

`test/design-core.test.ts` covers the pure core: whitespace collapse, context
assembly + budget truncation, message fencing (data vs. task, the truncation note,
the no-context path), the five prompt builders (brief/tweak/language/count/question
embedding and the count clamp), the `id → messages` path, and the response parsers
(fence/quote stripping, idempotence, list-marker stripping). `test/hanzo.test.ts`
asserts the `@hanzo/ai` request shaping against a mock client (model, `stream:false`,
temperature, messages, abort signal, empty-content error, model listing).
`test/config.test.ts` covers the `/v1` endpoint builders and the `sk-` key guard.

```
Test Files  3 passed (3)
     Tests  40 passed (40)
```
