# Hanzo AI for Procore

AI over your Procore construction project — **summarize an RFI**, **draft an RFI
response**, **extract action items and risks**, and **summarize project status**,
plus a freeform "ask about the project" box. An embedded-app **panel** you host at
`procore.hanzo.ai`, backed by a small **OAuth + API-proxy service** that keeps the
Procore client secret and access tokens server-side.

Built on the published Hanzo SDK:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — the headless client.
  `createAiClient({ baseUrl, token }).chat.completions.create({ model, messages })`
  and `.models.list()`. All model calls go to `https://api.hanzo.ai` on `/v1/...`
  (never an `/api/` prefix). We import it; we do not reimplement the transport.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity /
  the `hk-…` API key the panel uses as its gateway bearer.

Procore is the construction management system of record: documents, RFIs,
submittals, observations, and daily logs. This app reads those records through
the Procore REST API and grounds every AI answer in them.

---

## Architecture

```
Browser panel (dist/index.html, app.js)          Server service (dist/server.js)
─────────────────────────────────────           ──────────────────────────────
  reads Procore via  ──►  /proxy/*  ──────────►  injects OAuth Bearer + refresh,
  same-origin proxy       (cookie)               forwards to api.procore.com with
  (never sees a Procore token)                   the Procore-Company-Id header
        │
        └── calls api.hanzo.ai /v1 directly with the pasted hk-… Hanzo key
            (@hanzo/ai headless client)
```

- The **panel** never holds a Procore token or the client secret. It reaches
  Procore only through the same-origin `/proxy/*` endpoint (with an HttpOnly
  session cookie). It talks to `api.hanzo.ai` directly with the user's pasted
  Hanzo key.
- The **service** is the only place `PROCORE_CLIENT_SECRET` and the OAuth tokens
  exist. It runs the install flow, holds the session, refreshes the (rotating)
  refresh token transparently, and proxies REST calls.

### Source layout (all pure logic is unit-tested)

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Hosts (production vs sandbox), REST version, gateway URL, server-secret config (`readServerConfig` fails fast). |
| `src/procore-oauth.ts` | OAuth2 Authorization-Code shaping: `authorizeUrl`, `tokenExchange`, `refreshExchange`, token parsing + expiry math. Pure. |
| `src/procore-api.ts` | REST v1.0 request wrappers (`listRFIs`, `getRFI`, `createReply`, `listSubmittals`, `listDocuments`, `listObservations`, `listDailyLogs`) with company/project scoping + pagination, and response parsers. Pure. |
| `src/project.ts` | RFI/submittal/doc/observation/daily-log JSON → windowed context text + honest truncation. Pure. |
| `src/hanzo.ts` | Thin over `@hanzo/ai`: prompt assembly + the single `ask` path + `listModels`. |
| `src/actions.ts` | The four AI actions (id → prompt) over `ask`. One code path to the model. |
| `src/panel.ts` | Browser proxy-client request shaping + launch-context parsing. Pure. |
| `src/app.ts` | The DOM glue for the panel (the one impure browser entry). |
| `src/server.ts` | Node http service: OAuth install/callback + `/proxy/*`. |

---

## 1. Create a Procore developer app

On the **Procore Developer Portal** (<https://developers.procore.com>):

1. Create a new **app** (a Data Connection app). This gives you a **Client ID**
   and **Client Secret** (the *sandbox* credentials first; production credentials
   are issued when you promote the app).
2. Add an **OAuth redirect URI** — exactly the URL your service serves the
   callback at:

   ```
   https://procore.hanzo.ai/oauth/callback
   ```

   (For local development, add `http://localhost:8790/oauth/callback` too.)

3. Grant the app access to the **tools** it reads in your sandbox company:
   Project, **RFIs**, **Submittals**, **Documents**, **Observations**, and
   **Daily Log**. Procore permissions are granted per-company / per-tool in the
   company's admin — the OAuth grant itself takes no `scope` parameter for a
   standard data-connection app.
4. Note your **sandbox company id** — you supply it in the panel and it is sent
   as the `Procore-Company-Id` header on every REST call.

### Sandbox vs production

Everything is host-selected by one env value, `PROCORE_ENV`:

| | Login (OAuth) | REST API |
| --- | --- | --- |
| `sandbox` (default) | `https://login-sandbox.procore.com` | `https://sandbox.procore.com` |
| `production` | `https://login.procore.com` | `https://api.procore.com` |

Develop against `sandbox`, flip to `production` only when your app is approved.

---

## 2. OAuth flow

Standard **Authorization Code** grant (server-side secret):

1. `GET /oauth/install` → 302 to
   `https://login-sandbox.procore.com/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&state=…`.
2. The user consents; Procore redirects back to `GET /oauth/callback?code=…&state=…`.
3. The service verifies `state`, then POSTs to `/oauth/token` with
   `grant_type=authorization_code`, the `code`, the `client_id` + `client_secret`
   (**in the body, server-side only**), and the same `redirect_uri`.
4. It opens a session, sets an HttpOnly cookie, and the panel is authenticated.
5. Access tokens are short-lived (~2h). The service refreshes with
   `grant_type=refresh_token` **before** each proxied call when the token has
   expired. Procore **rotates** the refresh token on every refresh, so the new
   one is stored each time.

> In-memory sessions here are for a single instance. For a multi-instance
> deployment behind `hanzoai/ingress`, persist sessions + the OAuth `state` set
> to `hanzoai/kv` (Valkey), and read `PROCORE_CLIENT_SECRET` from KMS
> (`kms.hanzo.ai`) — never from a committed env file.

---

## 3. Procore REST API

All reads/writes go through `https://api.procore.com/rest/v1.0/...` (or the
sandbox host), and **every request carries the `Procore-Company-Id` header**
(company scope). Project-scoped resources take the project id in the path.

| Resource | Endpoint (relative to `/rest/v1.0`) |
| --- | --- |
| Projects | `GET /projects?company_id={id}` |
| RFIs (list) | `GET /projects/{project_id}/rfis` |
| RFI (detail) | `GET /projects/{project_id}/rfis/{id}` |
| **RFI reply** (write) | `POST /projects/{project_id}/rfis/{id}/replies` — body `{ "rfi_reply": { "body": "…" } }` |
| Submittals | `GET /projects/{project_id}/submittals` |
| Documents | `GET /folders_and_files?project_id={id}` |
| Observations | `GET /observations/items?project_id={id}` |
| Daily logs | `GET /projects/{project_id}/daily_logs/notes_logs?log_date=YYYY-MM-DD` |

List endpoints paginate with `page` (1-based) + `per_page` (max 100) and return
the total record count in the **`Total`** response header (surfaced by
`parseTotal`).

---

## 4. The RFI summarize / respond flow

1. Connect the app (`/oauth/install`) so the service holds a Procore token.
2. Open the panel, enter your **company id**, and **Load** a project. The panel
   pulls the project's RFIs / submittals / documents / observations through the
   proxy and assembles a windowed, truncation-honest context.
3. **Summarize RFI** — the model summarizes the question, replies so far, status,
   ball-in-court, and what's outstanding, grounded only in the records.
4. **Draft RFI response** — the model drafts a reply to the open RFI, answering
   from the records and stating exactly what's still needed rather than inventing
   an answer. The result lands in the Result box.
5. Optional write-back: **Post as RFI reply** posts the Result back to Procore via
   `POST /projects/{id}/rfis/{rfi}/replies` — behind an explicit button and a
   confirm, targeting the first open RFI on the loaded project.

The other actions — **Action items & risks** (owners + severity-ordered risks
from RFIs/observations/daily logs) and **Project status** (open/overdue RFIs and
submittals, notable observations, schedule/safety notes) — run the same way.

---

## Build & run

```bash
pnpm install
pnpm --filter @hanzo/procore build      # → dist/ (panel + server)
pnpm --filter @hanzo/procore test       # vitest
pnpm --filter @hanzo/procore typecheck  # tsc --noEmit

# run the service
PROCORE_CLIENT_ID=…   \
PROCORE_CLIENT_SECRET=…   \
PROCORE_REDIRECT_URI=https://procore.hanzo.ai/oauth/callback   \
PROCORE_ENV=sandbox   \
node packages/procore/dist/server.js
```

### Required environment (service)

| Var | Notes |
| --- | --- |
| `PROCORE_CLIENT_ID` | App client id (public). |
| `PROCORE_CLIENT_SECRET` | **Server only.** From KMS in production. |
| `PROCORE_REDIRECT_URI` | Must match the app's registered redirect. |
| `PROCORE_ENV` | `sandbox` (default) or `production`. |
| `PORT` | Listen port (default `8790`). |

`readServerConfig` throws on a missing secret — the service refuses to start
rather than pretend it can complete an OAuth exchange.

---

## Deploy over hanzoai/ingress

Host the static panel (`dist/index.html`, `app.js`, `styles.css`) with the
**hanzoai/static** plugin and run `dist/server.js` as a small service, both
behind **hanzoai/ingress** at `procore.hanzo.ai` (no nginx, no caddy):

- `/` and the static assets → the panel.
- `/oauth/*`, `/proxy/*`, `/healthz` → the service.

Secrets come from **KMS** as `KMSSecret`-synced env; sessions from **Valkey**
(`hanzoai/kv`) for multi-instance. Image published to
`ghcr.io/hanzoai/procore:<tag>` by CI/CD (platform.hanzo.ai / Tekton) — never
built locally.

---

## Procore Marketplace path

To list on the **Procore App Marketplace**:

1. Build and validate the app in your **sandbox** developer account (the flow
   above).
2. Complete the app's Marketplace listing on the Developer Portal (description,
   screenshots, the OAuth redirect, the tools/permissions it requests).
3. Submit for Procore's **app review**; on approval you receive **production**
   OAuth credentials — set `PROCORE_ENV=production` and swap in the production
   `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET`.
4. Publish. Installing companies grant the app access to their Project / RFIs /
   Submittals / Documents tools; the `Procore-Company-Id` header scopes every
   request to the installing company.

---

*Routed through `api.hanzo.ai`. Answers are grounded in your Procore project
records — informational coordination support, not an engineering, legal, or
safety directive.*
