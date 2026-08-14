# Hanzo AI for QuickBooks Online

AI over your books, in plain language. `@hanzo/quickbooks` reads your QuickBooks
Online financials and answers questions about them — **summarize financials**,
**explain a report**, **draft invoice/estimate line descriptions**,
**categorize / explain transactions**, and a freeform **ask about the books**.

Two surfaces, one shared core:

- **Panel** (`dist/index.html`) — a web page (hosted behind hanzoai/ingress at
  `quickbooks.hanzo.ai`) that runs the AI actions over a QuickBooks report
  (Profit & Loss, Balance Sheet), an entity query (Invoices / Bills /
  Transactions / Customers / Accounts), or plain figures pasted into it.
- **Service** (`dist/server.js`) — a small Node service that handles the Intuit
  OAuth2 flow and a **QBO API proxy** (`/v1/analyze`) so the Intuit
  `client_secret` and the OAuth tokens stay **server-side**: it fetches the
  report or runs the query against the [Accounting API v3](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities),
  assembles it into analysis text, and summarizes it via
  [api.hanzo.ai](https://api.hanzo.ai).

Both are built on the shared Hanzo foundation — `@hanzo/ai` (the published
headless OpenAI-compatible model client) and `@hanzo/iam` (Hanzo identity) — and
speak the gateway's `/v1` wire protocol, identical to `@hanzo/docusign`,
`@hanzo/pdf`, and `@hanzo/meetings`.

> Analysis is informational, grounded strictly in your QuickBooks data — **not
> tax, audit, or accounting advice**. The system prompt forbids inventing
> accounts, amounts, dates, or trends.

## Architecture

```
src/
  config.ts        env boundary: gateway, model, Intuit OAuth + QBO API hosts, scopes, server config
  qbo-oauth.ts     Intuit OAuth2 Authorization Code Grant request shaping + callback/token parsing (pure)
  qbo-api.ts       Accounting API v3 request wrappers (report/query/get/create) + response parsing (pure)
  finance.ts       QBO report/entity JSON → readable analysis text + truncation to a budget (pure)
  hanzo.ts         prompt assembly + the single `ask` path over the @hanzo/ai SDK (pure/injected)
  actions.ts       the AI actions as prompts over `ask` (one code path to the model)
  qbo-analysis.ts  the pipeline: fetch report/query → assemble context → run action (injected fetch)
  panel.ts         pure panel logic (launch-context parse, interpret pasted data → FinanceContext)
  app.ts           browser panel: DOM glue over the pure modules
  server.ts        Node service: /oauth/install, /oauth/callback, /v1/analyze, /v1/companies, /healthz
  index.html       panel markup   styles.css   panel styles
```

Everything logic-heavy is pure and unit-tested; `app.ts` (browser) and
`server.ts` (Node) are the only impure entry points. The gateway is reached
through **one** shape — the published `createAiClient().chat.completions.create()`
from `@hanzo/ai` — never a hand-rolled client.

## Build & test

```bash
pnpm --filter @hanzo/quickbooks install
pnpm --filter @hanzo/quickbooks test        # vitest — 91 tests
pnpm --filter @hanzo/quickbooks typecheck    # tsc --noEmit, clean
pnpm --filter @hanzo/quickbooks build        # esbuild -> dist/
```

`build.js` bundles the panel (`app.js`, with `@hanzo/ai` inlined for the
browser), copies `index.html` + `styles.css`, and bundles the Node service
(`server.js`, with `@hanzo/ai` left external and loaded from `node_modules`).

## Create an Intuit developer app

1. Sign in at the [Intuit Developer portal](https://developer.intuit.com) and
   **Create an app** → **QuickBooks Online and Payments**.
2. Under **Keys & OAuth**, note the **Client ID** and **Client Secret** for each
   environment (Development / Production). The secret is **server-only** — it
   lives in KMS and is read by `server.ts`; it is never bundled or sent to the
   browser.
3. Add the **Redirect URI**: `https://quickbooks.hanzo.ai/oauth/callback` (and a
   local one, e.g. `http://localhost:8790/oauth/callback`, for dev).
4. The app requests these **OAuth scopes**:
   - `com.intuit.quickbooks.accounting` — the Accounting API.
   - `openid` — returns the `id_token` (identity) at token exchange.
5. **Sandbox company:** the developer account comes with a free
   [sandbox company](https://developer.intuit.com/app/developer/sandbox). Use
   `QBO_ENV=sandbox` (API host `sandbox-quickbooks.api.intuit.com`) against it
   before going to production (`quickbooks.api.intuit.com`).

### OAuth2 flow

| Endpoint | Host |
| --- | --- |
| Authorize | `https://appcenter.intuit.com/connect/oauth2` |
| Token (exchange + refresh) | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` |
| Revoke (disconnect) | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` |

The authorize + token hosts are the **same** for sandbox and production; the
environment selects only the **Accounting API host**. Token exchange uses HTTP
Basic auth (`base64(client_id:client_secret)`) and a form body that includes
`redirect_uri`. On approval Intuit redirects to the callback with `code`,
`state`, and — critically — **`realmId`** (the company id), which scopes every
API path and keys the server's stored authorization. Access tokens live ~1 hour
(`/v1/analyze` refreshes transparently on a 401); refresh tokens rotate ~daily
and live ~100 days.

## Reports and entities used

Everything is on the **Accounting API v3** root
`https://{host}/v3/company/{realmId}/…` with a pinned `minorversion`:

| Data | Request |
| --- | --- |
| Profit & Loss | `GET /reports/ProfitAndLoss?start_date=…&end_date=…` |
| Balance Sheet | `GET /reports/BalanceSheet` |
| Cash Flow / Aged Receivables / Aged Payables | `GET /reports/{name}` |
| Invoices / Bills / Customers / Accounts / Transactions | `GET /query?query=SELECT * FROM {Entity} …` |
| A single record | `GET /{entity}/{id}` |
| Light write-back (create/update invoice, add a memo) | `POST /{entity}` |

Reports come back as a nested `Header` / `Columns` / `Rows` tree (sections with
`Summary` subtotals); `finance.ts` flattens that into an indented, readable
statement the model reasons over. Queries wrap an entity array under
`QueryResponse.{Entity}`; each record is projected to its accounting-relevant
fields.

### Write-back (gated)

The one write path is `qbo-api.create(env, realmId, token, entity, payload)` — a
`POST /{entity}`. Primary value is **read + analyze**; write-back
(create/update an Invoice, add a memo) is deliberately behind an explicit action
and is off by default. Never wired to an AI action that runs without a human
confirming the payload.

## The summarize-financials flow

The canonical path, end to end (`qbo-analysis.analyzeReport`):

1. **Fetch** — `GET /v3/company/{realmId}/reports/ProfitAndLoss` with the period
   params + `minorversion`, `Authorization: Bearer <access_token>`.
2. **Render** — `finance.renderReport` walks the `Rows` tree into an indented
   statement: section headers, line items with their period columns, section
   subtotals (`Total Income`, `Total Expenses`), and the top-level `Net Income`.
3. **Window** — `finance.buildReportContext` caps the rendered statement at the
   character budget on a line boundary, flagging truncation honestly.
4. **Assemble** — `hanzo.buildMessages` fences the statement as data under a
   grounded system prompt (work only from the figures shown; cite lines by name;
   not accounting advice).
5. **Summarize** — one non-streaming completion via the published `@hanzo/ai`
   `createAiClient().chat.completions.create()` against `api.hanzo.ai`.

In the **panel**, the user pastes the report JSON and the same pure
`finance.ts` / `hanzo.ts` produce the answer directly against the gateway with
their pasted `sk-…` key — zero backend. In the **service**, `/v1/analyze` runs
the whole flow server-side so the Intuit token and the Hanzo key never leave the
server.

## Deploy over hanzoai/ingress

The panel is static (`dist/index.html`, `app.js`, `styles.css`) served by
`hanzoai/static`; the service (`dist/server.js`) is a small container behind
`hanzoai/gateway` + `hanzoai/ingress` at `quickbooks.hanzo.ai`. Secrets come from
**KMS** (`kms.hanzo.ai`) synced via KMSSecret CRDs — never in manifests, never in
env files committed to git.

Required environment (see `config.readServerConfig`):

| Var | Notes |
| --- | --- |
| `INTUIT_CLIENT_ID` | OAuth2 client id (public). |
| `INTUIT_CLIENT_SECRET` | OAuth2 secret — **server only**, from KMS. |
| `INTUIT_REDIRECT_URI` | `https://quickbooks.hanzo.ai/oauth/callback`. |
| `QBO_ENV` | `sandbox` (default) or `production`. |
| `HANZO_API_KEY` | Optional — enables the `/v1/analyze` proxy; without it the panel uses its own pasted key. |
| `PORT` | Default `8790`. |

The server exposes `GET /healthz` for readiness. Run: `node dist/server.js`.

## Intuit App Store path

To list publicly on the [QuickBooks App Store](https://apps.intuit.com):

1. Move the app to **Production keys** and pass Intuit's technical + security
   review (OAuth2, token handling, `Disconnect` via the revoke endpoint,
   least-privilege scopes — this app requests only `accounting` + `openid`).
2. Complete the app listing (categories, screenshots, description) and the
   security questionnaire.
3. Intuit reviews and publishes. Until then the app runs against the sandbox and
   any development companies you connect directly.

## License

MIT © Hanzo AI
