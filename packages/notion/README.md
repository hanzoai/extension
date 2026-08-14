# Hanzo AI for Notion

Brings Hanzo AI into a startup or ops team's **Notion** pages, databases, and
wikis. Pick a page and Hanzo will:

- **Summarize a page** — read the page's blocks (recursively) and produce a
  tight bullet summary.
- **Draft / expand** — generate content that continues the page in its own
  tone, ready to insert.
- **Extract → database** — pull structured action items (task / owner / due)
  out of a page and create one **row per item** in a Notion database.
- **Ask about a page/workspace** — freeform Q&A over the page's content.

Every result can be **written back to Notion** — appended onto the page as a
labelled **callout** (+ paragraphs), or, for extraction, created as **database
rows**. Model calls route through the same `api.hanzo.ai/v1` gateway as every
other Hanzo surface; Notion access is standard **OAuth2 (public integration) +
REST API v1**.

> Notion has **no in-app UI-extension surface** (no plugins/panels) — the
> platform is API + OAuth only. So this ships as (a) a Notion public
> integration + API client, and (b) a small web app that operates on the user's
> pages and databases. Notion is also the classic case where a **Model Context
> Protocol connector** fits: this same capability pairs with Hanzo `auto`'s MCP
> servers. This package is the **direct** integration; the MCP path is
> complementary, not a replacement.

## Architecture

Two credentials, kept apart by design — and unlike a token that a browser can
hold, **the Notion bot token never leaves the server**:

- **Notion** — OAuth2 authorization-code grant. Both the `client_secret` **and**
  the workspace **bot token** live only in the OAuth + proxy service
  (`server.ts`), read from / stored in the environment. The browser SPA holds
  only an **opaque session id**; every Notion call is proxied through the
  service, which attaches the real `Bearer` + `Notion-Version` server-side.
  (Notion public-integration tokens do not expire and there is no refresh flow —
  so there is nothing time-based to manage.)
- **Hanzo** — an `sk-` API key pasted by the user (kept in the browser), or
  empty for anonymous/limited models. The `createAiClient` contract — the same
  headless client surface as `@hanzo/ai`.

```
browser SPA (app.ts) ──OAuth redirect──▶ api.notion.com/v1/oauth/authorize
     │  code                                     │
     ├──POST /oauth/callback──▶ service (server.ts, holds client_secret + bot token)
     │                              └──POST api.notion.com/v1/oauth/token (Basic auth)──▶ bot token
     │                              ◀── { session, workspace }        (opaque session id only)
     ├──/notion/* (x-hanzo-session)──▶ service ──Bearer bot token──▶ api.notion.com/v1/{search,pages,blocks,databases}
     └──POST /v1/chat/completions (Bearer sk-)──▶ api.hanzo.ai
```

The engine is small, pure, and unit-tested:

| module | responsibility |
| --- | --- |
| `config.ts` | the two backends; Notion API/version/endpoint URLs; Hanzo gateway base + default Zen model |
| `notion-oauth.ts` | authorize URL + token-exchange request shaping (Basic auth, JSON body); token parsing |
| `notion-api.ts` | every REST wrapper — URL, headers, body — `retrieveBlockChildren`, `appendChildren`, `retrievePage`, `createPage`, `retrieveDatabase`, `queryDatabase`, `search`; `readListPage` + the single `paginate` cursor loop |
| `blocks.ts` | Notion blocks ↔ plain text/markdown, both directions (see mapping below) |
| `client.ts` | the `createAiClient` contract — non-streaming `/v1/chat/completions` + `/v1/models` |
| `actions.ts` | the four actions + page-context assembly/truncation + action-item parsing + write-back block/property building |
| `app.ts` | the DOM glue (thin) |
| `server.ts` | the OAuth + Notion-proxy http service (thin), the session store, the proxy allow-list |

## The four actions

| action | reads | asks Hanzo for | writes back |
| --- | --- | --- | --- |
| **Summarize** | page blocks → text | a bullet summary | callout appended to the page |
| **Draft / expand** | page blocks → text | new prose continuing the page | callout + paragraphs appended |
| **Extract → database** | page blocks → text | a **JSON array** of `{ task, owner, due }` | one **row per item** in a chosen database |
| **Ask** | page blocks → text | an answer to the user's question | callout appended (optional) |

## Notion blocks ↔ text mapping

The single source of truth is `blocks.ts`. Reading a page turns its recursively
fetched block tree into markdown-ish text for the model; writing back turns the
model's text into Notion block objects.

**Read (block → text):**

| Notion block | text form |
| --- | --- |
| `heading_1/2/3` | `#` / `##` / `###` + text |
| `paragraph` | inline markdown (bold/italic/code/strike/link) |
| `bulleted_list_item` | `- item` |
| `numbered_list_item` | `1. item` |
| `to_do` | `- [ ] task` / `- [x] task` (checked state) |
| `toggle` | `▸ text` |
| `quote` | `> text` |
| `callout` | `> {emoji} text` |
| `code` | fenced ``` ```lang … ``` ``` with **plain** (un-escaped) content |
| `divider` | `---` |
| `child_page` / `child_database` | `[page] Title` / `[database] Title` |
| _unknown_ | flattened `rich_text`, never throws |

`rich_text` runs are flattened via `plain_text` (falling back to
`text.content`); nested children are indented by depth so list/toggle structure
survives.

**Write (text → block):** `paragraphBlock`, `calloutBlock` (default 🤖 icon),
`headingBlock`, and `textToBlocks` (one paragraph per non-empty line). Long
strings are split at Notion's **2000-char** `rich_text` cap. Property values for
database rows: `titleProperty`, `richTextProperty`, `dateProperty`,
`selectProperty`, `checkboxProperty`.

The write-back flow: the AI text → `resultBlocks(action, text)` = a labelled
`heading_2` ("Hanzo AI — Summary/Draft/Answer") + a `callout` holding the first
paragraph + any overflow as paragraphs → `appendChildren(pageId, blocks)` →
`PATCH /v1/blocks/{pageId}/children`. Extraction: AI JSON → `parseActionItems`
→ `actionItemProperties(item, fieldMap)` → `createPage({ parent: { database_id },
properties })` per item.

## Notion API endpoints used

All under `https://api.notion.com/v1`, every request carrying
`Notion-Version: 2022-06-28`:

- `GET  /blocks/{id}/children` — read a page/block's children (paginated:
  `start_cursor` + `page_size`, cap 100; response `has_more` + `next_cursor`).
- `PATCH /blocks/{id}/children` — append blocks (write-back).
- `GET  /pages/{id}` — read a page's title/properties.
- `POST /pages` — create a page / database row.
- `GET  /databases/{id}` / `POST /databases/{id}/query` — schema / rows.
- `POST /search` — discover the pages & databases the integration was granted.
- OAuth: `GET /oauth/authorize`, `POST /oauth/token` (HTTP **Basic** auth with
  the client id/secret, **JSON** body — not form-urlencoded).

## Create a Notion public integration

1. Go to **notion.so/my-integrations → New integration**, type **Public**.
2. **Capabilities** — this app needs: **Read content**, **Insert content**,
   **Update content**. (No user-info capability is required; the `search`
   endpoint only returns content the user explicitly shares at consent time.)
3. **OAuth Domain & URIs** — set the **Redirect URI** to
   `https://notion.hanzo.ai/oauth/callback`.
4. Copy the **OAuth client ID** (public) and **OAuth client secret** (server-only).

**Scopes / consent:** Notion has no OAuth scope strings — access is granted
per-**page/database** by the user on the consent screen (they pick exactly which
pages the integration can touch). The integration can only ever see and modify
what the user shared; `search` reflects that grant.

### OAuth flow (what the code does)

1. SPA → `GET /v1/oauth/authorize?client_id&response_type=code&owner=user&redirect_uri&state`
   (CSRF `state` minted + stored in `sessionStorage`).
2. User consents, Notion redirects to `…/oauth/callback?code&state`.
3. SPA `POST /oauth/callback { code }` → the **service** exchanges it:
   `POST /v1/oauth/token` with `Authorization: Basic base64(id:secret)` and a
   JSON `{ grant_type, code, redirect_uri }` body.
4. The service stores the returned **bot token** under a fresh opaque
   **session id** and returns only `{ session, workspace }` to the SPA.
5. Every later Notion call goes `SPA → /notion/{subpath} (x-hanzo-session) →
   service → api.notion.com`. Only an **allow-list** of the exact subpaths this
   app uses is forwardable (`proxyPathAllowed`), so a session id can never be
   turned into a general Notion credential.

## Build & test

```bash
pnpm --filter @hanzo/notion test        # vitest — 104 pure-logic tests
pnpm --filter @hanzo/notion typecheck   # tsc --noEmit
pnpm --filter @hanzo/notion build       # esbuild → dist/
```

The build stamps the Notion **public** `client_id` and `redirect_uri` into the
SPA (the secret is never bundled):

```bash
NOTION_CLIENT_ID=<your-client-id> \
NOTION_REDIRECT_URI=https://notion.hanzo.ai/oauth/callback \
HANZO_NOTION_BASE=https://notion.hanzo.ai \
pnpm --filter @hanzo/notion build
```

Run the service (it reads the secret from the environment):

```bash
NOTION_CLIENT_ID=<id> \
NOTION_CLIENT_SECRET=<secret> \
NOTION_REDIRECT_URI=https://notion.hanzo.ai/oauth/callback \
PORT=8788 \
node dist/server.js
```

## Deploy — `hanzoai/static` + `hanzoai/ingress` at `notion.hanzo.ai`

`dist/` is two things: static assets (`index.html`, `app.js`, `styles.css`,
`assets/`) and one small Node service (`server.js`).

- Serve the static assets with the **`hanzoai/static`** plugin.
- Run `server.js` for the two dynamic paths, `POST /oauth/callback` and the
  `/notion/*` proxy, plus `GET /health`.
- Route both through **`hanzoai/ingress`** on the host `notion.hanzo.ai`
  (`/oauth/*` and `/notion/*` → the service; everything else → static). No
  nginx, no caddy — ingress + the static plugin only.
- The `NOTION_CLIENT_SECRET` comes from **KMS** (never a manifest, never the
  bundle). Image: `ghcr.io/hanzoai/notion:<tag>`, `--platform linux/amd64`,
  built in CI. The service is stateless except the session store — a
  single-instance dev uses the in-memory `memoryStore`; a multi-instance deploy
  backs `SessionStore` with `hanzoai/kv` (Valkey). `/health` is the k8s
  liveness/readiness probe.

Model calls always target `api.hanzo.ai/v1` — never an `/api/` prefix, never a
`v2`.
```
