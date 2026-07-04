# @hanzo/zendesk — Hanzo AI for Zendesk

A Zendesk **Support app** (ZAF v2, `ticket_sidebar`) that puts Hanzo AI next to
every ticket. It reads the current ticket and its conversation, and gives the
agent one-click actions — **Summarize ticket**, **Draft reply** (in the agent's
voice), **Suggest next steps**, **Explain the issue**, and a freeform **Ask** —
then writes the result back into the reply editor or adds it as an internal note.

Built on the published **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)**
headless client against **api.hanzo.ai** (`/v1/...`). No UI framework — a plain
HTML/TypeScript iframe panel bundled with esbuild.

## How it works

```
Zendesk ticket_sidebar iframe
        │
   src/panel.ts ── DOM glue only
        ├── src/zaf.ts     read ticket context · write back · secure-proxy fetch
        ├── src/ticket.ts  PURE: conversation → windowed text (+ honest scope note)
        └── src/hanzo.ts   PURE shaping + @hanzo/ai createAiClient (ONE model path)
        │
   api.hanzo.ai /v1/chat/completions   (via the Zendesk proxy — see "Security")
```

### Ticket context → model

`zaf.getTicketContext` reads `ticket.subject`, `ticket.requester.name`, and
`ticket.comments` in one batched `client.get([...])`. `ticket.buildContext` then
windows the conversation to a character budget (48k), **keeping the newest
comments** (a support reply is grounded in the latest exchange) and dropping the
oldest first — always including at least the most recent comment, hard-cut if it
alone is over budget. Each comment is labelled with its author and whether it was
a public reply or an internal note. `ticket.contextNote` prepends one honest
sentence so the model (and the agent) knows whether older context was omitted —
we never claim the whole thread was sent when it wasn't.

### Reply write-back

The output isn't inserted automatically. The agent clicks:

- **Insert as reply** → `client.set('ticket.comment.type', 'publicReply')` then
  `client.invoke('ticket.comment.appendText', text)` — appends to the reply
  editor without clobbering what the agent already typed.
- **Add as note** → the same, with `type: 'internalNote'`.

## Security — the Hanzo key never reaches the browser

The Hanzo API key (`hk-…`) is a **secure installation setting**
(`manifest.json` → `parameters[hanzo_api_key]`, `"secure": true`, `"type":
"password"`). Zendesk stores secure settings server-side and **does not expose
them to the iframe** — so the panel can't (and doesn't) read the key.

Instead, model traffic is sent through Zendesk's request proxy:
`zaf.secureFetch` implements a `fetch` that calls `client.request(...)` with
`secure: true` and an `Authorization: Bearer {{setting.hanzo_api_key}}` header.
Zendesk substitutes the real key on its server, out of reach of the browser. We
pass that `fetch` to `createAiClient({ baseUrl: 'https://api.hanzo.ai', fetch })`,
so we **use the published `@hanzo/ai` client** while the secret stays secure. No
key is ever stored in `localStorage`, committed, or logged.

The optional **Default model** (`default_model`) is a *non-secure* setting, so
the panel reads it from `client.metadata().settings` and falls back to `zen5`.

## Build

```bash
pnpm install --filter @hanzo/zendesk
pnpm --filter @hanzo/zendesk build      # → dist/  (ZAF app bundle)
pnpm --filter @hanzo/zendesk test       # vitest
pnpm --filter @hanzo/zendesk typecheck  # tsc --noEmit
```

`build.js` (esbuild + Node stdlib) produces the bundle `zcli` expects:

```
dist/
├── manifest.json
├── translations/en.json
└── assets/
    ├── iframe.html      the ticket_sidebar page (manifest location url = assets/iframe.html)
    ├── panel.js         bundled from src/panel.ts (ESM, @hanzo/ai included)
    ├── styles.css
    ├── logo.png         128px Marketplace icon
    └── logo-small.png   in-panel icon
```

The ZAF SDK is **not** bundled — `iframe.html` loads it from Zendesk's CDN
(`https://static.zdassets.com/zendesk_app_framework_sdk/2.0/zaf_sdk.min.js`),
which exposes the `ZAFClient` global.

## Validate, package, and upload (zcli)

Uses [`@zendesk/zcli`](https://www.npmjs.com/package/@zendesk/zcli) (a devDep).

```bash
# 1. Authenticate once against your Zendesk account.
npx zcli login -i
#   (or set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN)

# 2. Validate the built bundle.
npx zcli apps:validate dist

# 3. Package it into a zip (writes dist/tmp/*.zip).
npx zcli apps:package dist

# 4. Upload + install it as a PRIVATE app on your account.
#    Writes zcli.apps.config.json with the assigned app_id — do not commit it.
npx zcli apps:create dist

# 5. Push later changes to the same installed app.
npx zcli apps:update dist
```

`pnpm --filter @hanzo/zendesk validate` / `package` wrap steps 2–3.

### Configure the app

After install, in **Admin Center → Apps and integrations → Zendesk Support
apps**, open the app's settings and:

1. Paste your Hanzo API key (`hk-…`) into **Hanzo API key** (secure).
2. Optionally set a **Default model** (defaults to `zen5`).
3. Save. The panel appears in the ticket sidebar.

Generate a Hanzo API key at <https://hanzo.ai>.

### Marketplace

To list publicly, set `"private": false` in `manifest.json`, fill in
`translations/en.json` (`short_description` ≤ 80 chars, `long_description`,
`installation_instructions`), then submit the packaged zip via the Zendesk
Marketplace developer flow (Admin Center → **Marketplace** → submit an app). See
the [Zendesk app publishing
guide](https://developer.zendesk.com/documentation/apps/getting-started/publishing-your-app/).

## Layout

| File | Role |
|---|---|
| `src/config.ts` | Constants: gateway base URL, default model, setting names, context budget. |
| `src/ticket.ts` | **Pure.** Ticket conversation → windowed, labelled, truncated text + honest scope note. |
| `src/hanzo.ts` | **Pure shaping** + the one `@hanzo/ai` model path (quick-action catalog, `buildMessages`, `stream`/`complete`). |
| `src/zaf.ts` | The ZAF boundary: init, ticket read, write-back, secure-proxy `fetch`. |
| `src/panel.ts` / `panel.html` / `styles.css` | The iframe UI. |
| `manifest.json` | ZAF v2 app manifest (location `ticket_sidebar`, secure key parameter). |
| `translations/en.json` | App name, descriptions, and parameter labels. |
| `build.js` | esbuild → `dist/` ZAF app bundle. |

## License

MIT
