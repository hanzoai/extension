# Hanzo AI for DocuSign

AI over agreements, right where they're signed. `@hanzo/docusign` adds four
actions to any DocuSign envelope — **summarize**, **extract key terms**,
**risk-flag clauses**, and **draft a memo** — and auto-summarizes every envelope
the moment it completes.

Two surfaces, one shared core:

- **Panel** (`dist/index.html`) — an Extension App / linked-app page that opens
  with an envelope in context and runs the four actions over its agreement text.
- **Service** (`dist/server.js`) — a small Node service that handles the DocuSign
  OAuth callback and the [Connect](https://developers.docusign.com/platform/webhooks/connect/)
  webhook: on `envelope → completed` it fetches the combined PDF, extracts the
  text, and summarizes it via [api.hanzo.ai](https://api.hanzo.ai).

Both are built on the shared Hanzo foundation — `@hanzo/ai` (the headless
OpenAI-compatible model client) and `@hanzo/iam` (Hanzo identity) — and speak the
gateway's `/v1` wire protocol, identical to `@hanzo/pdf`, `@hanzo/meetings`,
`@hanzo/slack`, and `@hanzo/teams`.

> Analysis is informational, grounded strictly in the agreement text — **not legal
> advice**. The system prompt forbids inventing parties, dates, or clauses.

## Architecture

```
src/
  config.ts          env boundary: gateway, model, DocuSign OAuth/API bases, HMAC, server config
  client.ts          the createAiClient contract (thin @hanzo/ai; one-line re-export when published)
  docusign-oauth.ts  Authorization Code Grant request shaping + userinfo/base_uri discovery (pure)
  docusign-api.ts    eSignature REST v2.1 request wrappers + response parsing (pure)
  webhook.ts         Connect HMAC verification + event routing (pure, node:crypto)
  pdf-text.ts        PDF → text (pure itemsToText + injectable pdf.js loader)
  hanzo.ts           document windowing/truncation + prompt assembly + the single `ask` path (pure)
  actions.ts         the four AI actions as prompts over `ask` (one code path to the model)
  envelope.ts        the analysis pipeline: fetch combined PDF → extract → window → action
  panel.ts           pure panel logic (launch-context parse, text→pages)
  app.ts             browser panel: DOM glue over the pure modules
  server.ts          Node service: /oauth/install, /oauth/callback, /connect, /healthz
  index.html         panel markup   styles.css   panel styles
```

Everything logic-heavy is pure and unit-tested; `app.ts` (browser) and
`server.ts` (Node) are the only impure entry points. The gateway is reached
through **one** shape — `createAiClient().chat.completions.create()` — so swapping
in the published `@hanzo/ai` headless client is a one-import change.

## Build & test

```bash
pnpm --filter @hanzo/docusign install
pnpm --filter @hanzo/docusign test        # vitest — 103 tests
pnpm --filter @hanzo/docusign typecheck    # tsc --noEmit, clean
pnpm --filter @hanzo/docusign build        # esbuild -> dist/
```

`build.js` bundles the panel (`app.js`), copies `index.html` + `styles.css`,
emits the pdf.js worker (`pdf.worker.mjs`), and bundles the Node service
(`server.js`).

## Register the DocuSign app

Do this once in the [DocuSign Developer / Admin console](https://admindemo.docusign.com)
(demo) or the production Admin.

1. **Apps and Keys → Add App and Integration Key.** Note the **Integration Key**
   (this is your OAuth `client_id`).
2. **Authentication:** choose **Authorization Code Grant**. Generate a **Secret
   Key** — this is `DOCUSIGN_CLIENT_SECRET`, held only by the service, never in
   the browser bundle.
3. **Redirect URIs:** add your service callback, e.g.
   `https://docusign.hanzo.ai/oauth/callback` (`DOCUSIGN_REDIRECT_URI`).
4. **OAuth scopes:** the app requests `signature openid`. `signature` grants the
   eSignature REST API (read envelopes/documents); `openid` lets
   `/oauth/userinfo` return the account list and each account's regional
   `base_uri` (we never hard-code a REST host — it's discovered at login).
5. **Grant consent** once by visiting `GET /oauth/install` on the service; it
   redirects to DocuSign's consent screen, and the callback stores the account's
   token + `base_uri` for the webhook to use.

DocuSign environments:

| `DOCUSIGN_ENV` | Account server (OAuth)         |
| -------------- | ------------------------------ |
| `demo`         | `https://account-d.docusign.com` |
| `production`   | `https://account.docusign.com`   |

The REST base (`https://<region>.docusign.net/restapi/v2.1`) comes from
`/oauth/userinfo` per account — no configuration needed.

## Configure the Connect webhook (+ HMAC)

Connect is DocuSign's webhook. Under **Settings → Connect → Add Configuration →
Custom**:

1. **URL to publish:** `https://docusign.hanzo.ai/connect` (the service's
   `POST /connect`).
2. **Events:** enable **Envelope → Completed** (the service acts only on
   `completed`; every other status is acknowledged and ignored).
3. **Data format:** JSON (the aggregate payload).
4. **HMAC security** (required): under the configuration's **HMAC** section,
   **add a secret key**. Copy it into `DOCUSIGN_CONNECT_HMAC_KEY`.

### How verification works

DocuSign signs every Connect message. For each configured HMAC key it adds a
header:

```
X-DocuSign-Signature-1: base64( HMAC-SHA256( hmacKey, <raw request body> ) )
```

The service recomputes the digest over the **raw** body bytes (never a
re-serialized object — key order/whitespace would differ) and compares in
**constant time** (`node:crypto` `timingSafeEqual`) against every
`X-DocuSign-Signature-N` header. A message that fails is a **401** before any
document is fetched — that is the entire trust boundary. This is covered by
`test/webhook.test.ts` and verified end-to-end against the running service.

## Environment

The service reads only the environment; nothing is committed. In production these
come from **KMS** (kms.hanzo.ai) synced via `KMSSecret` CRDs — never a checked-in
env file.

| Variable | Required | Meaning |
| -------- | -------- | ------- |
| `DOCUSIGN_CLIENT_ID` | yes | Integration Key (OAuth client id; public) |
| `DOCUSIGN_CLIENT_SECRET` | yes | OAuth secret key (server only) |
| `DOCUSIGN_REDIRECT_URI` | yes | Registered OAuth callback URL |
| `DOCUSIGN_CONNECT_HMAC_KEY` | yes | Connect HMAC secret (server only) |
| `DOCUSIGN_ENV` | no | `demo` (default) or `production` |
| `HANZO_API_KEY` | no | `sk-…` gateway bearer the webhook summarizes with; without it the webhook verifies + routes but skips summarization |
| `PORT` | no | Listen port (default `8789`) |

The service fails fast (throws) at startup if any required secret is missing.

## Endpoints

| Method + path | Purpose |
| ------------- | ------- |
| `GET /oauth/install` | 302 → DocuSign consent |
| `GET /oauth/callback` | exchange code → token, discover `base_uri` via `/oauth/userinfo`, store the account authorization |
| `POST /connect` | verify HMAC, then on `completed` fetch the combined PDF and summarize |
| `GET /healthz` | readiness |

## The summarize / extract / risk flow

**In the panel** — the user (or DocuSign, via the launch URL's envelope context)
provides the agreement text; a chip (or a freeform question) runs:

```
agreement text → asPages → buildDocumentContext (windowed to the char budget,
truncation reported honestly) → buildMessages (grounded system prompt, agreement
fenced as data) → ask → api.hanzo.ai /v1/chat/completions → result
```

**On completion** — the Connect webhook runs the same core, server-side:

```
POST /connect → verify HMAC → routeEvent (completed?) → analyzeEnvelope:
  GET /envelopes/{env}                 (metadata: title, status)
  GET /envelopes/{env}/documents/combined  (all documents as one PDF)
  extractPdfText (pdf.js)              (per-page text)
  buildDocumentContext                 (window to budget)
  runAction('summarize')               (→ api.hanzo.ai)
→ summary   (deliver hook: store in hanzoai/docdb, post back as an envelope
             custom field, or notify the sender — a per-deployment choice)
```

The four actions are the **same** `runAction` id in both surfaces — the chip a
user clicks and the webhook auto-summary share one code path to the model.

## Deploy

The panel is static; the service is a small container. Per the Hanzo stack:

- **Panel** → hosted over **hanzoai/static** behind **hanzoai/ingress** at
  `docusign.hanzo.ai` (serve `dist/index.html`, `app.js`, `styles.css`,
  `pdf.worker.mjs`).
- **Service** → a container running `node dist/server.js`, image
  `ghcr.io/hanzoai/docusign:<tag>` (built in CI/CD, `--platform linux/amd64`),
  behind `hanzoai/ingress`, with secrets from KMS via `KMSSecret`. Point the
  DocuSign redirect URI and the Connect URL at `docusign.hanzo.ai`.

No nginx, no caddy — `hanzoai/ingress` + `hanzoai/static` only.
```
