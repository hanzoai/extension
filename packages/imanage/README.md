# Hanzo AI for iManage

AI over your iManage Work matter — **summarize a document**, **extract key clauses,
dates & parties** (contract review), **search & synthesize** across a matter, and
**compare a document set**, plus a freeform "ask about this matter" box. An
embedded-app **panel** you host at `imanage.hanzo.ai`, backed by a small **OAuth +
Work-API-proxy service** that keeps the iManage client secret and access tokens
server-side.

iManage Work is the dominant document management system (DMS) in legal and
professional services. This app reads workspaces, folders, documents (metadata +
content), and search results through the iManage Work API and grounds every AI
answer in them.

Built on the published Hanzo SDK:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — the headless client.
  `createAiClient({ baseUrl, token }).chat.completions.create({ model, messages })`
  and `.models.list()`. All model calls go to `https://api.hanzo.ai` on `/v1/...`
  (never an `/api/` prefix). We import it; we do not reimplement the transport.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity /
  the `sk-…` API key the panel uses as its gateway bearer.

> **Note on `/api/`.** The `/api/` ban is a **Hanzo gateway** rule (`api.hanzo.ai`
> IS the api host, so paths are `/v1/...`). iManage's **own** Work API path is
> `/api/v2/...` — that is iManage's host, and it is correct to use it verbatim.

---

## Architecture

```
Browser panel (dist/index.html, app.js)          Server service (dist/server.js)
─────────────────────────────────────           ──────────────────────────────
  reads iManage via  ──►  /proxy/*  ──────────►  injects the access token
  same-origin proxy       (cookie)               (X-Auth-Token) + refresh, forwards
  (never sees an iManage token)                  to {host}/api/v2/customers/…
        │
        └── calls api.hanzo.ai /v1 directly with the pasted sk-… Hanzo key
            (@hanzo/ai headless client)
```

- The **panel** never holds an iManage token or the client secret. It reaches
  iManage only through the same-origin `/proxy/*` endpoint (with an HttpOnly
  session cookie). It talks to `api.hanzo.ai` directly with the user's pasted Hanzo
  key. The customer + library scope lives in the request **path**
  (`/customers/{cid}/libraries/{lib}/…`), so the proxy just prepends the Work API
  base and forwards.
- The **service** is the only place `IMANAGE_CLIENT_SECRET` and the OAuth tokens
  exist. It runs the install flow, holds the session, refreshes the token
  transparently, and proxies Work API calls.

### Source layout (all pure logic is unit-tested)

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Host resolution (normalize/validate a per-customer iManage host), the `/api/v2` Work API root, the gateway URL, server-secret config (`readServerConfig` fails fast). |
| `src/imanage-oauth.ts` | OAuth2 Authorization-Code shaping: `authorizeUrl`, `tokenExchange`, `refreshExchange`, token parsing + expiry math. Pure. |
| `src/imanage-api.ts` | Work API v2 request wrappers (`listWorkspaces`, `listFolderChildren`, `getDocument`, `getDocumentContent`, `search`, `updateDocumentProfile`) with customer/library scoping + offset/limit pagination, and envelope-aware response parsers. Pure. |
| `src/documents.ts` | Document profile + extracted content + workspace/folder/search JSON → windowed context text + honest truncation, and text extraction (`extractText`, binary/OCR out of scope). Pure. |
| `src/hanzo.ts` | Thin over `@hanzo/ai`: legal-grounded prompt assembly + the single `ask` path + `listModels`. |
| `src/actions.ts` | The four AI actions (id → prompt) over `ask`. One code path to the model. |
| `src/panel.ts` | Browser proxy-client request shaping + launch-context parsing. Pure. |
| `src/app.ts` | The DOM glue for the panel (the one impure browser entry). |
| `src/server.ts` | Node http service: OAuth install/callback + `/config` + `/proxy/*`. Never logs document content. |

---

## 1. Register an app in the iManage Control Center

In the **iManage Control Center** for your customer:

1. Go to **Applications** → **Add** and register a new OAuth2 application. This
   yields a **Client ID** and **Client Secret**.
2. Set the **grant type** to **Authorization Code** and add the **redirect URI** —
   exactly the URL your service serves the callback at:

   ```
   https://imanage.hanzo.ai/oauth/callback
   ```

   (For local development, add `http://localhost:8793/oauth/callback` too.)
3. Scope is optional for the Authorization-Code app — access is governed by the
   signed-in user's own Work permissions. (If your Control Center offers scopes,
   grant read access to documents/workspaces and, for the optional write-back,
   document profile update.)
4. Note your **iManage host**, your **customer id**, and the **library id(s)** you
   work in (e.g. `ACTIVE_US`). The host is per-customer:

   | Deployment | Host |
   | --- | --- |
   | iManage Cloud (US) | `https://cloudimanage.com` |
   | Regional cloud | `https://<region>.imanage.work` |
   | On-prem Work server | `https://work.<firm>.com` |

   The OAuth control-center endpoints and the Work API are served from this host
   (set `IMANAGE_API_HOST` if your Work API is fronted separately).

---

## 2. OAuth flow

Standard **Authorization Code** grant (server-side secret):

1. `GET /oauth/install` → 302 to
   `https://{host}/auth/oauth2/authorize?response_type=code&client_id=…&redirect_uri=…&state=…`.
2. The user signs in and consents; iManage redirects back to
   `GET /oauth/callback?code=…&state=…`.
3. The service verifies `state`, then POSTs to `/auth/oauth2/token` with
   `grant_type=authorization_code`, the `code`, the `client_id` + `client_secret`
   (**in the body, server-side only**), and the same `redirect_uri`.
4. It opens a session, sets an HttpOnly cookie, and the panel is authenticated.
5. Access tokens are short-lived. The service refreshes with
   `grant_type=refresh_token` **before** each proxied call when the token has
   expired, storing whatever refresh token comes back.

> In-memory sessions here are for a single instance. For a multi-instance
> deployment behind `hanzoai/ingress`, persist sessions + the OAuth `state` set to
> `hanzoai/kv` (Valkey), and read `IMANAGE_CLIENT_SECRET` from KMS
> (`kms.hanzo.ai`) — never from a committed env file.

---

## 3. iManage Work API

All reads/writes go through `https://{host}/api/v2/...`, scoped by customer +
library in the path. The access token rides in the **`X-Auth-Token`** header
(iManage's Work API convention).

| Capability | Endpoint (relative to `/api/v2`) |
| --- | --- |
| Libraries | `GET /customers/{cid}/libraries` |
| Workspaces | `GET /customers/{cid}/libraries/{lib}/workspaces` |
| Workspace (detail) | `GET …/workspaces/{id}` |
| Folder / workspace contents | `GET …/folders/{folderId}/children` (folders + documents) |
| Document (profile) | `GET …/documents/{id}` |
| Document content | `GET …/documents/{id}/download` |
| Search | `GET …/documents/search?q=…` |
| **Profile write-back** (optional) | `PATCH …/documents/{id}` — body `{ "data": { "comment": "…" } }` |

Responses are wrapped in an iManage `{ "data": … }` envelope; list/search endpoints
paginate with **`offset` + `limit`** and report totals/overflow in the body
(surfaced by `parsePaging`). All of this is normalized at the parser boundary.

### Document content & text extraction

`getDocumentContent` fetches `…/documents/{id}/download`. This app assumes **text or
server-exported text**; `extractText` cleans it for the model. **Binary formats**
(native `.docx`/`.pdf`, images) and **OCR are out of scope** — such content is
reported honestly (`extracted: false` with a reason) and the actions summarize from
the **profile metadata** alone rather than feeding the model garbage.

---

## 4. The summarize-document / extract-clauses flow

1. Connect the app (`/oauth/install`) so the service holds an iManage token.
2. Open the panel, enter your **customer id** + **library id** (or arrive
   pre-scoped via the launch-context query / a single-tenant `/config`), and
   **Browse** a workspace. Pick a document and **Load doc** — the panel pulls the
   document's profile + content through the proxy and assembles a windowed,
   truncation-honest context.
3. **Summarize document** — the model summarizes the document type, purpose,
   parties, key terms, and anything needing attention, grounded only in the text
   (or the profile, when content isn't extractable).
4. **Key clauses, dates & parties** — a contract-review extraction returning four
   grounded lists: **Parties**, **Key dates**, **Key clauses** (governing law,
   indemnity, limitation of liability, confidentiality, termination — quoting the
   operative language), and **Dollar amounts**. Anything not written is reported as
   "None found in the text" — never inferred.
5. **Search & synthesize** — enter a query, **Search** the library, and run the
   action to synthesize across the result set, attributing each point to its
   document.
6. **Compare document set** — over a search result set (or a matter), lists the
   material differences side by side.

### Optional write-back (gated + documented)

**Save to comment** writes the current result into the loaded document's **`comment`
profile field** via `PATCH …/documents/{id}` — behind an explicit button **and** a
confirm dialog, targeting only the single loaded document (disabled for a search
result set). It never touches document content. This is the only write path; leave
it unused for a strictly read-only deployment.

---

## Confidentiality posture (legal)

This app handles **confidential, potentially privileged** legal documents. The
design keeps that boundary tight:

- **Tokens + secret are server-side only.** The browser never receives the iManage
  access token or the client secret; it reaches iManage exclusively through the
  same-origin proxy with an HttpOnly session cookie.
- **No document content is ever logged.** The proxy logs only non-content
  bookkeeping (a session id, a status, a target path) — never request/response
  bodies, document text, profiles, or search terms.
- **The model is told the material is confidential** and instructed to reveal no
  more of the text than the task requires, to never invent clauses/dates/parties,
  and that its output is **informational document review, not legal advice** (no
  attorney-client relationship).
- **Grounded, truncation-honest context.** Answers are built only from the windowed
  records actually sent; when the budget truncates, the context note says so and the
  model is told to flag it rather than guess.
- **Least privilege.** Read-and-assist is the default; the one write path is gated
  behind an explicit action + confirm and updates only a profile comment.

---

## Build & run

```bash
pnpm install
pnpm --filter @hanzo/imanage build      # → dist/ (panel + server)
pnpm --filter @hanzo/imanage test       # vitest
pnpm --filter @hanzo/imanage typecheck  # tsc --noEmit

# run the service
IMANAGE_CLIENT_ID=…   \
IMANAGE_CLIENT_SECRET=…   \
IMANAGE_REDIRECT_URI=https://imanage.hanzo.ai/oauth/callback   \
IMANAGE_HOST=https://cloudimanage.com   \
node packages/imanage/dist/server.js
```

### Required / optional environment (service)

| Var | Notes |
| --- | --- |
| `IMANAGE_CLIENT_ID` | App client id (public). |
| `IMANAGE_CLIENT_SECRET` | **Server only.** From KMS in production. |
| `IMANAGE_REDIRECT_URI` | Must match the app's registered redirect. |
| `IMANAGE_HOST` | The customer's iManage host (auth + Work API). |
| `IMANAGE_API_HOST` | Optional — a distinct Work API host (defaults to `IMANAGE_HOST`). |
| `IMANAGE_CUSTOMER_ID` | Optional — panel scoping default (served at `/config`). |
| `IMANAGE_LIBRARY_ID` | Optional — panel scoping default (served at `/config`). |
| `PORT` | Listen port (default `8793`). |

`readServerConfig` throws on a missing secret or a malformed host — the service
refuses to start rather than pretend it can complete an OAuth exchange.

---

## Deploy over hanzoai/ingress

Host the static panel (`dist/index.html`, `app.js`, `styles.css`) with the
**hanzoai/static** plugin and run `dist/server.js` as a small service, both behind
**hanzoai/ingress** at `imanage.hanzo.ai` (no nginx, no caddy):

- `/` and the static assets → the panel.
- `/oauth/*`, `/config`, `/proxy/*`, `/healthz` → the service.

Secrets come from **KMS** as `KMSSecret`-synced env; sessions from **Valkey**
(`hanzoai/kv`) for multi-instance. Image published to
`ghcr.io/hanzoai/imanage:<tag>` by CI/CD (platform.hanzo.ai / Tekton) — never built
locally.

---

*Routed through `api.hanzo.ai`. Answers are grounded in your iManage document
records — informational document review support, not legal advice, and no
attorney-client relationship is created.*
