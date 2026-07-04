# Hanzo AI for Workday

AI over your Workday people data — **summarize a worker or team**, **draft a job
description / requisition**, **summarize an org and headcount**, **answer HR /
policy questions**, and **draft review feedback**, plus a freeform "ask about
these people" box. An embedded-app **panel** you host at `workday.hanzo.ai`,
backed by a small **read-only OAuth + API-proxy service** that keeps the Workday
client secret and access tokens server-side.

Built on the published Hanzo SDK:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — the headless client.
  `createAiClient({ baseUrl, token }).chat.completions.create({ model, messages })`
  and `.models.list()`. All model calls go to `https://api.hanzo.ai` on `/v1/...`
  (never an `/api/` prefix). We import it; we do not reimplement the transport.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity /
  the `hk-…` API key the panel uses as its gateway bearer.

Workday is the enterprise system of record for people data: workers, supervisory
organizations, time off, and recruiting. This app reads those records through the
Workday REST API and RaaS custom reports, and grounds every AI answer in them.

> **Read-only by design.** v1 exposes reads only. Workday writes (requesting time
> off, business-process submissions) are heavy, kick off approval workflows, and
> mutate the system of record — a gated write-back is a deliberate, documented
> future addition (see *Write-back* below), not an oversight.

---

## Architecture

```
Browser panel (dist/index.html, app.js)          Server service (dist/server.js)
─────────────────────────────────────           ──────────────────────────────
  reads Workday via  ──►  /proxy/*  ──────────►  injects OAuth Bearer + refresh,
  same-origin proxy       (cookie)               resolves the resource route to a
  (never sees a token or the tenant)             REST / RaaS URL on the tenant host
        │
        └── calls api.hanzo.ai /v1 directly with the pasted hk-… Hanzo key
            (@hanzo/ai headless client)
```

- The **panel** never holds a Workday token, the client secret, or even the tenant
  name. It reaches Workday only through the same-origin `/proxy/*` endpoint (with
  an HttpOnly session cookie), calling *resource* routes (`/proxy/workers`,
  `/proxy/organizations`, `/proxy/report/{owner}/{name}`). It talks to
  `api.hanzo.ai` directly with the user's pasted Hanzo key.
- The **service** is the only place `WORKDAY_CLIENT_SECRET`, the OAuth tokens, and
  the tenant address exist. It runs the install flow, holds the session, refreshes
  the access token transparently on expiry, and resolves each resource route to a
  Workday REST/RaaS URL. It accepts **GET only**.

### Source layout (all pure logic is unit-tested)

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Tenant address (host + tenant), REST service/version descriptors, OAuth/REST/RaaS URL builders, gateway URL, server-secret config (`readServerConfig` fails fast). |
| `src/workday-oauth.ts` | OAuth2 Authorization-Code shaping: `basicAuthHeader`, `authorizeUrl`, `tokenExchange`, `refreshExchange`, token parsing + `carryRefreshToken` + expiry math. Pure. |
| `src/workday-api.ts` | REST wrappers (`listWorkers`, `getWorker`, `listDirectReports`, `listSupervisoryOrganizations`, `listJobRequisitions`, `listEligibleAbsenceTypes`) + RaaS (`timeOffReport`) with `limit`/`offset` pagination, and `{ total, data }` / `Report_Entry` parsers. Pure. |
| `src/people.ts` | Worker/org/requisition/absence/report JSON → windowed context text + honest truncation. Pure. |
| `src/hanzo.ts` | Thin over `@hanzo/ai`: HR-guardrailed prompt assembly + the single `ask` path + `listModels`. |
| `src/actions.ts` | The five AI actions (id → prompt) over `ask`. One code path to the model. |
| `src/panel.ts` | Browser proxy-client request shaping (resource routes) + launch-context parsing. Pure. |
| `src/app.ts` | The DOM glue for the panel (the one impure browser entry). |
| `src/server.ts` | Node http service: OAuth install/callback + read-only `/proxy/*`. |

---

## 1. Register a Workday API Client (OAuth)

In your Workday tenant, an integration/security admin registers an **API Client**:

1. Search the task **Register API Client** (or *Register API Client for
   Integrations* for client-credentials integrations). For this app, use the
   **Authorization Code Grant**:
   - Search **Register API Client**, choose **Authorization Code Grant**.
2. Set:
   - **Client Grant Type**: *Authorization Code Grant*.
   - **Access Token Type**: *Bearer*.
   - **Redirection URI** — exactly the URL your service serves the callback at:

     ```
     https://workday.hanzo.ai/oauth/callback
     ```

     (For local development, also add `http://localhost:8791/oauth/callback`.)
   - **Scope (Functional Areas)** — grant the areas this app reads: **Staffing**,
     **Organizations and Roles**, **Recruiting**, and **Time Off and Leave**. The
     client's registered scope governs access; the OAuth `/authorize` call sends
     no `scope` param for a standard client.
   - **Non-Expiring Refresh Tokens** — enable if you want the refresh token to
     persist (Workday refresh tokens do **not** rotate on refresh).
3. On save, Workday shows the **Client ID** and **Client Secret** (the secret is
   shown once — store it in KMS). Note your **tenant name** and your **datacenter
   host** (the origin your users hit, e.g. `https://wd2-impl-services1.workday.com`
   for an implementation tenant, `https://services1.myworkday.com` for production).

### Implementation ("sandbox") vs production

There is no fixed host per environment — each Workday datacenter differs. An
**implementation** tenant carries `-impl` in the host (`isSandboxHost` detects
this). Point the service at whichever host+tenant you are targeting:

| | Host (`WORKDAY_HOST`) | Tenant (`WORKDAY_TENANT`) |
| --- | --- | --- |
| `sandbox` | `https://wd2-impl-services1.workday.com` | your impl tenant |
| `production` | `https://services1.myworkday.com` | your prod tenant |

Develop against the implementation tenant, flip to production when validated.

---

## 2. OAuth flow

Standard **Authorization Code** grant (server-side secret, **HTTP Basic** client
auth on the token endpoint):

1. `GET /oauth/install` → 302 to
   `https://{host}/ccx/oauth2/{tenant}/authorize?response_type=code&client_id=…&redirect_uri=…&state=…`.
2. The user consents; Workday redirects back to `GET /oauth/callback?code=…&state=…`.
3. The service verifies `state`, then POSTs to `/ccx/oauth2/{tenant}/token` with
   `grant_type=authorization_code`, the `code`, and the same `redirect_uri`. The
   **client id + secret ride in the `Authorization: Basic base64(id:secret)`
   header — never in the body**.
4. It opens a session, sets an HttpOnly cookie, and the panel is authenticated.
5. Access tokens are short-lived (~1h). The service refreshes with
   `grant_type=refresh_token` **before** each proxied call when the token has
   expired. Workday does **not** rotate the refresh token, and the refresh
   response usually omits it, so the prior refresh token is carried forward
   (`carryRefreshToken`).

> In-memory sessions here are for a single instance. For a multi-instance
> deployment behind `hanzoai/ingress`, persist sessions + the OAuth `state` set to
> `hanzoai/kv` (Valkey), and read `WORKDAY_CLIENT_SECRET` from KMS
> (`kms.hanzo.ai`) — never from a committed env file.

---

## 3. Workday REST API + RaaS

**REST** reads go through `https://{host}/ccx/api/{service}/{version}/{tenant}/...`.
Each service is versioned independently; list endpoints paginate with `limit`
(≤ 100) + `offset` (0-based) and return a `{ total, data: [...] }` envelope.

| Resource | Service | Endpoint (after the tenant) |
| --- | --- | --- |
| Workers | `staffing/v6` | `GET /workers`, `GET /workers/{id}` |
| Direct reports | `staffing/v6` | `GET /workers/{id}/directReports` |
| Supervisory orgs | `staffing/v6` | `GET /supervisoryOrganizations`, `.../{id}` |
| Job requisitions | `recruiting/v4` | `GET /jobRequisitions`, `.../{id}` |
| Eligible absence types | `absenceManagement/v1` | `GET /workers/{id}/eligibleAbsenceTypes` |

**RaaS** (Report-as-a-Service) reads a customer-defined report as JSON:

```
GET https://{host}/ccx/service/customreport2/{tenant}/{owner}/{report}?format=json
→ { "Report_Entry": [ { … }, … ] }
```

`owner` is the report owner's username; the app forces `format=json` and parses
the `Report_Entry` rows (nested `{ Descriptor }` references are flattened).

### RaaS report setup (time off)

Time-off history and balances are customer-configured, so they are pulled via a
custom report rather than a fixed REST endpoint:

1. In Workday, build a **Custom Report** (e.g. *Team Time Off*) with the fields
   you want per row (Worker, Time Off Type, Units, Date).
2. Enable **Web Service** output (the *customreport2* alias) and share the report
   with the API Client's ISU / owner account.
3. Call it from the panel via `report(owner, name)` (route
   `/proxy/report/{owner}/{name}`); it returns `Report_Entry` rows that feed the
   people context under the **Time off** section.

---

## 4. The summarize-a-worker flow

1. Connect the app (`/oauth/install`) so the service holds a Workday token.
2. Open the panel; it lists the tenant's workers. Pick a worker and **Load**. The
   panel pulls the worker's profile, direct reports, supervisory organizations,
   open requisitions, and eligible absence types through the proxy and assembles a
   windowed, truncation-honest context.
3. **Summarize worker** — the model summarizes role, business title, org and
   manager, location, and (if reports are loaded) team size and notable roles,
   grounded only in the records, never inferring compensation, performance, or any
   protected characteristic.
4. **Org & headcount** — the model summarizes the org, headcount breakdown, open
   requisitions and openings, and time-off coverage.
5. The other actions — **Draft job description**, **Answer HR question**, and
   **Draft review feedback** — run the same way. A freeform box asks anything over
   the loaded records.

Every answer is grounded in the fenced Workday records with an honest note when
the context was truncated to fit the model window.

---

## Write-back (documented, not in v1)

Workday writes (e.g. `POST …/requestTimeOff`, business-process submissions) mutate
the system of record and trigger approval workflows. v1 is intentionally
read-only: the proxy accepts `GET` only and returns `405` for other methods. A
write-back — e.g. drafting a job requisition and submitting it — is a deliberate
future addition that must be gated behind an explicit user confirmation, a
narrowly-scoped API Client permission, and an audit log. It is documented here so
its absence is a decision, not a gap.

---

## Build & run

```bash
pnpm install
pnpm --filter @hanzo/workday build      # → dist/ (panel + server)
pnpm --filter @hanzo/workday test       # vitest
pnpm --filter @hanzo/workday typecheck  # tsc --noEmit

# run the service
WORKDAY_HOST=https://wd2-impl-services1.workday.com   \
WORKDAY_TENANT=acme   \
WORKDAY_CLIENT_ID=…   \
WORKDAY_CLIENT_SECRET=…   \
WORKDAY_REDIRECT_URI=https://workday.hanzo.ai/oauth/callback   \
WORKDAY_ENV=sandbox   \
node packages/workday/dist/server.js
```

### Required environment (service)

| Var | Notes |
| --- | --- |
| `WORKDAY_HOST` | Tenant datacenter host origin, e.g. `https://wd2-impl-services1.workday.com`. |
| `WORKDAY_TENANT` | Tenant name, e.g. `acme`. |
| `WORKDAY_CLIENT_ID` | API Client id (public). |
| `WORKDAY_CLIENT_SECRET` | **Server only.** From KMS in production. |
| `WORKDAY_REDIRECT_URI` | Must match the API Client's registered redirect. |
| `WORKDAY_ENV` | `sandbox` (default) or `production` — a label only. |
| `PORT` | Listen port (default `8791`). |

`readServerConfig` throws on any missing value — the service refuses to start
rather than pretend it can address the tenant or complete an OAuth exchange.

---

## Deploy over hanzoai/ingress

Host the static panel (`dist/index.html`, `app.js`, `styles.css`) with the
**hanzoai/static** plugin and run `dist/server.js` as a small service, both behind
**hanzoai/ingress** at `workday.hanzo.ai` (no nginx, no caddy):

- `/` and the static assets → the panel.
- `/oauth/*`, `/proxy/*`, `/healthz` → the service.

Secrets come from **KMS** as `KMSSecret`-synced env; sessions from **Valkey**
(`hanzoai/kv`) for multi-instance. Image published to
`ghcr.io/hanzoai/workday:<tag>` by CI/CD (platform.hanzo.ai / Tekton) — never
built locally.

---

*Routed through `api.hanzo.ai`. Answers are grounded in your Workday records —
read-only, informational HR support, not an employment, compensation, legal, or
disciplinary decision.*
