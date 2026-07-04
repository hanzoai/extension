# Hanzo AI for PDFs

A self-contained **web PDF workspace**: a PDF.js viewer on the left, a Hanzo AI
panel on the right. Open a filing, an executed contract, or a discovery
document, then **ask, summarize, and extract** over it. This is the surface a
lawyer spends the most time in — and unlike Acrobat's C++/Windows plugin SDK,
this runs anywhere a browser does, with no Adobe license.

It reuses the **same backend as the rest of the Hanzo productivity suite**: model
calls go through `api.hanzo.ai/v1` (OpenAI-compatible, streamed over SSE), the
same gateway the Office add-in (`@hanzo/office-addin`) uses. No new API surface.

## What it does

- **Renders** the PDF (PDF.js) with page navigation and text selection.
- **Extracts** the selectable text of every page in the browser.
- **Answers** questions grounded in that text, streaming the reply — with a
  legal-analyst system prompt that cites page numbers and refuses to guess.
- **Law-office quick actions**: Summarize · Extract parties, dates & obligations
  · Find & explain risky clauses · Explain the selection plainly · Draft a
  summary memo.

Nothing leaves the browser except the pages sent with a question. Scanned image
PDFs (no text layer) are detected and reported honestly — there is no OCR here.

## Large PDFs — honest context windowing

A 500-page filing does not fit a model context window and is never sent
wholesale. `buildContext` (in `src/config.ts`, pure and unit-tested) caps the
attached text at `CONTEXT_CHAR_BUDGET` (48 000 chars) and:

- **Whole document** scope windows from page 1, including as many whole pages as
  fit the budget, in order.
- **Current page only** scope windows from the page you're viewing, so a
  question about what's on screen sends that page and its neighbours, not the top
  of the document.
- The first line of every request is a **context note** stating the exact page
  range sent and, when pages were dropped, telling the model to answer only from
  what it sees and to say so if a full answer needs the omitted pages. The model
  is never told it has the whole document when it doesn't.

An oversized single page is hard-cut to the budget (and flagged truncated) rather
than silently overflowing.

## Auth

Paste a Hanzo API key (`hk-…`); it is **validated by a real `/v1/models` call**
before it is saved to `localStorage`, so a dead key is rejected at paste time,
not at first question. An empty key still reaches the gateway's public models.
OAuth via `hanzo.id` (device login) is the documented future upgrade — the bearer
plumbing already tolerates any token, so it slots in without a rewrite.

## Build

```bash
pnpm --filter @hanzo/pdf build      # production (base https://pdf.hanzo.ai)
pnpm --filter @hanzo/pdf test        # vitest — pure logic
pnpm --filter @hanzo/pdf typecheck   # tsc --noEmit
```

`build.js` (esbuild → `dist/`) bundles `app.ts` as ESM and copies PDF.js's
worker (`pdf.worker.mjs`) beside it — `app.js` resolves it at runtime via
`new URL('./pdf.worker.mjs', import.meta.url)`, so the worker must sit next to
`app.js`. `dist/` is fully static: `index.html`, `app.js`, `pdf.worker.mjs`,
`styles.css`, `assets/`. Override the hosting base for local dev:

```bash
HANZO_PDF_BASE=https://localhost:8080 pnpm --filter @hanzo/pdf build
```

## Run / host

`dist/` is a static site — serve it over HTTPS from any static host. Locally:

```bash
pnpm --filter @hanzo/pdf build
cd packages/pdf/dist && python3 -m http.server 8080   # then open http://localhost:8080
```

**Deploy target: `pdf.hanzo.ai` over `hanzoai/static`** (the k8s-native static
plugin behind `hanzoai/ingress` — no nginx/caddy). Point the static plugin at the
built `dist/`; there is no server-side component. CORS is not needed —
`api.hanzo.ai` is same-origin-policy-friendly for the browser `fetch`; the
gateway sets the response headers.

## The engine is small, pure, and tested

The logic-heavy parts live in their own modules with vitest coverage (`tests/`):

- `config.ts` — endpoints, `pickBearer`, and `buildContext`/`contextNote` (the
  large-PDF windowing and the honest scope note).
- `chat.ts` — request/response shaping (`buildMessages`, `requestBody`,
  `extractContent`, `streamDelta`, `ask`, `askStream`, `listModels`) — the same
  wire contract as the Office add-in.
- `pdf-view.ts` — the PDF.js binding; `itemsToText` (the text-flattening helper)
  is isolated and unit-tested without a real PDF.

`app.ts` is the thin, browser-only DOM glue that binds them together.
