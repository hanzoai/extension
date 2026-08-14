# Hanzo AI for HubSpot

Brings Hanzo AI into a sales, marketing, or customer-success team's **HubSpot**
CRM. Open the **Hanzo AI** tab on any contact, company, or deal record and Hanzo
will:

- **Summarize this record** — read the record and its associated records
  (a contact's companies + deals, a deal's contacts + companies, …) and produce
  a tight, rep-ready overview.
- **Draft email** — generate a short, personalized follow-up grounded in the
  record data, ready to send.
- **Next steps** — a prioritized list of concrete actions for this record.
- **Ask** — freeform Q&A over the record and its context.

Every result can be **written back to HubSpot** with one click — logged as a
**Note** or created as a follow-up **Task** on the record, associated via the
platform's default engagement association. Model calls route through the same
`api.hanzo.ai/v1` gateway as every other Hanzo surface, using the published
[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai) headless client.

This is a HubSpot **public app** on the developer-projects platform: a **CRM card
UI extension** (React) backed by **serverless functions**. The Hanzo API key and
the per-portal OAuth token live only in the serverless backend — **they never
reach the browser**.

## Architecture

Two credentials, kept apart by design:

- **HubSpot** — OAuth 2.0 authorization-code grant. The `client_secret` lives
  only in the app's OAuth exchange (see `src/oauth.ts` for the exact wire shape);
  the resulting per-portal access token is injected by HubSpot into the
  serverless runtime as `process.env.PRIVATE_APP_ACCESS_TOKEN`. The React card
  never sees it — it reads/writes CRM data only by calling the serverless
  functions.
- **Hanzo** — an `sk-…` API key stored as a HubSpot **secret**
  (`HANZO_API_KEY`), read by the `hanzo-assistant` serverless function and passed
  to `@hanzo/ai`. The browser only ever receives the final generated text.

```
CRM card (HanzoAssistant.tsx, React, no window/fetch)
   │  runServerlessFunction('hanzo-assistant', { objectType, objectId, action, detail, model })
   ▼
app.functions/hanzo-assistant.js   (holds HANZO_API_KEY; OAuth token from env)
   ├── @hubspot/api-client  ── read record + associations (getById, associations.v4, batch.read)
   ├── @hanzo/hubspot (pure core) ── buildContextBlocks → assembleRecordContext (windowed)
   └── @hanzo/ai  createAiClient ── POST api.hanzo.ai/v1/chat/completions
   ◀── { text, truncated }

CRM card ── runServerlessFunction('hanzo-writeback', { kind, objectType, objectId, body })
   ▼
app.functions/hanzo-writeback.js
   └── noteWriteBack / taskWriteBack (pure) → POST /crm/v3/objects/{notes,tasks}
```

The **pure core** (`src/config.ts`, `src/hanzo.ts`, `src/oauth.ts`,
`src/record.ts`, `src/api/*`) has no HubSpot runtime and no DOM dependency — it
is the `@hanzo/hubspot` package the serverless functions import, and it is
covered by the vitest suite. The `.tsx` card and the `.js` serverless functions
are the two thin edges HubSpot's own tooling bundles and runs.

## Layout

```
src/
  config.ts            Hanzo + HubSpot endpoints, object types, context budget
  hanzo.ts             the single model path (over @hanzo/ai) + context windowing + the 4 actions
  oauth.ts             HubSpot OAuth token-exchange request shaping
  record.ts            CRM record → ordered model-context blocks (property + association selection)
  api/
    hubspot-api.ts     CRM v3 request shaping + response parsing (getObject, getAssociations, …)
    write-back.ts      Note / Task engagement payload assembly (default association edges)
  index.ts             the pure public surface (what the serverless functions import)
  app/
    public-app.json    the public app: name, OAuth (scopes + redirect), card reference
    extensions/
      hanzo-assistant-card.json   the CRM card config (crm.record.tab, objectTypes)
      HanzoAssistant.tsx          the React UI extension
    app.functions/
      serverless.json             function → file + secrets map
      hanzo-assistant.js          reads record, runs the model (holds HANZO_API_KEY)
      hanzo-writeback.js          creates the Note / Task engagement
hsproject.json         project name, srcDir, platformVersion (2025.1)
assets/                app-listing icons (16/32/128)
```

## Setup

### 1. Create a HubSpot developer account + app

1. Sign up for a free **HubSpot developer account** at
   <https://developers.hubspot.com/> and create a **test account** (sandbox) to
   install into.
2. Install the HubSpot CLI and authenticate:

   ```bash
   npm i -g @hubspot/cli
   hs init            # writes hubspot.config.yml, authenticates an account
   hs account list    # confirm your test account is connected
   ```

### 2. Configure OAuth

The app declares OAuth in `src/app/public-app.json`:

- **Redirect URL** — `https://hubspot.hanzo.ai/oauth/callback`. Change this to
  your own HTTPS callback that runs the token exchange (`src/oauth.ts`
  `tokenExchange` → `parseTokenResponse`).
- **Required scopes** — read + write on the three object types the card mounts
  on:

  ```
  crm.objects.contacts.read   crm.objects.contacts.write
  crm.objects.companies.read  crm.objects.companies.write
  crm.objects.deals.read      crm.objects.deals.write
  ```

  Read powers **Summarize / Draft / Next steps / Ask**; write powers the
  **Note / Task** write-back.

The install flow: send the user to `authorizeUrl(...)` (built in `src/oauth.ts`),
HubSpot redirects back to your callback with `?code=…&state=…`, you `POST` the
`tokenExchange` request to `https://api.hubapi.com/oauth/v1/token`, and store the
returned token set. HubSpot then makes the per-portal token available to the
serverless functions.

### 3. Set the Hanzo key as a secret

The model key never goes in source or in the browser — it is a HubSpot secret:

```bash
hs secret add HANZO_API_KEY        # paste your sk-… key from hanzo.id
```

`serverless.json` declares `HANZO_API_KEY` on the `hanzo-assistant` function, so
HubSpot injects it as `process.env.HANZO_API_KEY` at runtime.

### 4. Upload + deploy

```bash
cd packages/hubspot
hs project upload      # builds and uploads the project (creates a build)
hs project deploy      # deploys the latest build to make the app live
# iterate with a live reload while developing:
hs project dev
```

`hs project dev` runs the card locally against your test account (records show a
"Developing locally" tag). To point `hubspot.fetch`/serverless calls at a local
backend during development, use a `local.json` proxy.

### 5. Install the card on record pages

1. Install the app into your test account from the app's install URL (the OAuth
   consent flow above).
2. Open any **contact**, **company**, or **deal** record.
3. The **Hanzo AI** card appears as a tab (`crm.record.tab`). Add it to the
   record's default view via **Customize record** if it isn't shown.

### 6. Use it

Pick a **model** (the picker is populated from `/v1/models` via the serverless
proxy; defaults to `zen5`), choose an **action**, and run. For **Draft email**
and **Ask**, type the topic / question first. Review the output, then
**Save as Note** or **Create Task** to write it back to the record.

## App Marketplace

To list publicly on the **HubSpot App Marketplace**:

1. Complete the app's listing in the developer portal (name, description, the
   icons in `assets/`, screenshots, support info).
2. Ensure the app requests only the scopes it uses (the six above) and has a
   production OAuth redirect and install flow.
3. Submit for review at
   <https://developers.hubspot.com/docs/guides/apps/marketplace/listing-your-app>.
   Marketplace apps must use `oauth` auth (already the case here).

## Development

```bash
pnpm --filter @hanzo/hubspot test        # vitest — the pure core
pnpm --filter @hanzo/hubspot typecheck   # tsc --noEmit over src + tests
pnpm --filter @hanzo/hubspot build       # emit dist/ (ESM + CJS) for the serverless import
```

The tests are pure (no network): CRM request shaping + parsing, OAuth
token-exchange shaping, record-context assembly/truncation, the `@hanzo/ai`
request shaping (over an injected client), and the Note/Task write-back payloads.
