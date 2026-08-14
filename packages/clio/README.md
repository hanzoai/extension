# Hanzo AI for Clio

Brings Hanzo AI into a lawyer's **Clio** matters. Pick a matter and Hanzo will:

- **Summarize the matter** — client, status, parties, key facts, open issues.
- **Draft correspondence** — a send-ready letter/email from the matter context.
- **Extract key dates & obligations** — a structured list with sources.
- **Ask about this matter** — freeform Q&A over the matter's documents.

Every result can be **written back to Clio** — as a **Note** on the matter, or
logged as an **Activity**. Model calls route through the same
`api.hanzo.ai/v1` gateway as every other Hanzo surface (the browser extension,
the Office add-in); Clio access is standard **OAuth2 + REST API v4**.

## Architecture

Two credentials, kept apart by design:

- **Clio** — OAuth2 authorization-code grant. The `client_secret` lives **only**
  in the token-exchange service (`server.ts`), read from the environment. The
  browser SPA never sees it. The SPA holds a short-lived Clio **access token**
  in `sessionStorage` and calls Clio's REST API directly with it.
- **Hanzo** — an `sk-` API key pasted by the user (kept in the browser), or
  empty for anonymous/limited models. Same contract as `@hanzo/office-addin`.

```
browser SPA (app.ts) ──OAuth redirect──▶ app.clio.com/oauth/authorize
     │  code                                     │
     ├──POST /oauth/callback──▶ token service (server.ts, holds client_secret)
     │                              └──POST app.clio.com/oauth/token──▶ tokens
     ├──Clio REST v4 (Bearer access token)──▶ app.clio.com/api/v4/{matters,documents,notes,…}
     └──POST /v1/chat/completions (Bearer sk-)──▶ api.hanzo.ai
```

The engine is small, pure and unit-tested. `clio-oauth.ts` (authorize URL,
token exchange/refresh shaping), `clio-api.ts` (every REST wrapper — URL,
headers, body, `fields`, pagination), `hanzo-chat.ts` (the gateway request
shape), `actions.ts` (the four actions + matter-context assembly/truncation +
write-back), `custom-action.ts` (Clio deep-link parsing). The DOM glue
(`app.ts`) and the http service (`server.ts`) are thin over those.

## Build & test

```bash
pnpm --filter @hanzo/clio test        # vitest — 86 pure-logic tests
pnpm --filter @hanzo/clio typecheck   # tsc --noEmit
pnpm --filter @hanzo/clio build       # esbuild → dist/
```

The build stamps the Clio **public** `client_id`, `redirect_uri` and `region`
into the SPA (the secret is never bundled):

```bash
CLIO_CLIENT_ID=<your-key> \
CLIO_REDIRECT_URI=https://clio.hanzo.ai/oauth/callback \
CLIO_REGION=us \
HANZO_CLIO_BASE=https://clio.hanzo.ai \
pnpm --filter @hanzo/clio build
```

`dist/` then contains the static SPA (`index.html`, `app.js`, `styles.css`,
`assets/`) and the token service (`server.js`).

## Register the Clio Developer App

1. Sign in to Clio and open **Settings → Developer Applications**
   (`https://app.clio.com/settings/developer_applications`) → **Add**.
2. Fill in:
   - **Name**: `Hanzo AI`
   - **Redirect URI**: `https://clio.hanzo.ai/oauth/callback`
     (must match `CLIO_REDIRECT_URI` exactly, and be registered before use).
   - **Scopes / access**: request **read** and **write** — write is required for
     the write-back (create Note, log Activity, upload Document).
3. Clio issues a **Client ID** (`CLIO_CLIENT_ID`, public) and a
   **Client Secret** (`CLIO_CLIENT_SECRET`, server-only). Store the secret in
   **KMS** (`kms.hanzo.ai`), synced to the service's environment. Never commit
   it; never ship it to the browser.

**OAuth scopes.** Clio's grant is coarse — the app's declared access (read /
write) gates every REST call. This app asks for `read write`. If a firm scopes
its app to read-only, the write-back actions will fail at Clio with a 403 and
the UI surfaces Clio's message.

**Regions.** A firm's data lives in one Clio region. Set `CLIO_REGION` to
`us` (default), `eu`, `au`, or `ca`; both the OAuth host and the API host derive
from it (`app.clio.com`, `eu.app.clio.com`, `au.app.clio.com`,
`ca.app.clio.com`).

## Custom Actions (a Hanzo button inside Clio)

Clio can render your app's buttons directly on records. In
**Settings → Developer Applications → (your app) → Custom Actions**, add one:

- **Label**: `Open in Hanzo AI`
- **UI reference / target**: **Matter** (Clio can also place actions on
  Contacts, Documents, and Bills).
- **URL**: `https://clio.hanzo.ai/custom-action`

When a lawyer clicks it, Clio opens that URL with four query params:
`custom_action_id`, `user_id`, `subject_url` (the URL-encoded record API path,
e.g. `%2Fapi%2Fv4%2Fmatters%2F1234`), and `custom_action_nonce`.

The **nonce is a single-use code (60s expiry), not a locally-verifiable
signature.** Per Clio's contract, the app validates the click by **replaying
the nonce to the Clio API** as a `custom_action_nonce` query param on its next
authenticated request; Clio validates it server-side (confirming the click's
user matches the OAuth token) and returns `403` for a bad or stale one. So:

1. `server.ts` `/custom-action` parses the matter id from `subject_url`
   (`parseSubjectUrl`) and redirects to
   `index.html?matter_id=<id>&custom_action_nonce=<nonce>`.
2. The SPA's first authenticated Clio call (`getMatter`) carries the nonce
   (`custom-action.ts`, `clio-api.ts`), so Clio performs the validation. The
   nonce is single-use — the app clears it after that one call.

## Hosting

- **SPA** — serve `dist/{index.html,app.js,styles.css,assets}` as static over
  `hanzoai/static` at `clio.hanzo.ai`.
- **Token service** — run `dist/server.js` (a dependency-free Node http server)
  behind `hanzoai/ingress`, same origin, routing `/oauth/callback`,
  `/oauth/refresh`, `/custom-action`, `/healthz`. Required environment:

  | var                  | example                                   | notes            |
  | -------------------- | ----------------------------------------- | ---------------- |
  | `CLIO_CLIENT_ID`     | `abc…`                                     | public           |
  | `CLIO_CLIENT_SECRET` | *(from KMS)*                               | **server only**  |
  | `CLIO_REDIRECT_URI`  | `https://clio.hanzo.ai/oauth/callback`     | matches the app  |
  | `CLIO_REGION`        | `us` \| `eu` \| `au` \| `ca`               | default `us`     |
  | `PORT`               | `8787`                                     | listen port      |

  The service **fails fast** if any of the three required values is unset.

## Clio App Directory listing

To list publicly in the **Clio App Directory**
(`https://app.clio.com/settings/developer_applications` → submit for review):
host at `clio.hanzo.ai` over HTTPS, register the redirect + Custom Actions
above, then submit the app through Clio's developer portal for their review and
Marketplace approval.

## Write-back flow

1. Pick a matter (or arrive via a Custom Action deep-link).
2. Run an action — the app loads the matter + up to 10 of its documents,
   assembles a capped context (`assembleMatterContext`, 48k chars total, 12k per
   doc, truncation marked), and asks Hanzo.
3. Review the output, choose **Save as matter Note** (default) or **Log as
   Activity**, and **Write back to Clio**:
   - Note → `POST /api/v4/notes` (`type: Matter`, pinned to the matter, subject
     `Hanzo AI: <action> — <matter>`, the full AI text as the detail).
   - Activity → `POST /api/v4/activities` (a `TimeEntry` logging the work
     product against the matter).

Nothing is persisted until the lawyer clicks write-back — Hanzo is drafting
assistance, reviewed before it is used.
