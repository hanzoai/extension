# @hanzo/github

Hanzo AI on GitHub. A **GitHub App** (webhooks + Octokit) that reviews pull
requests, triages new issues, and answers `@hanzo` mentions in issue and PR
comments — across open source and enterprise repos.

Built on the shared Hanzo foundation:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — the headless model
  client. Every model call goes through `createAiClient(...).chat.completions.create(...)`
  against `https://api.hanzo.ai` (`/v1/...`). This package never speaks raw HTTP
  to the gateway.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity.
  Used to validate an inbound Hanzo user token when a request is owner-scoped.

## What it does

| Event | Action | Behaviour |
| --- | --- | --- |
| `pull_request` | `opened`, `synchronize`, `reopened` | Fetch the PR's unified diff, window it to the model budget (honest truncation note on large PRs), review it, and post a **PR review** (`event: COMMENT`). |
| `issues` | `opened` | Summarize the issue, assign a severity, suggest labels **from the repo's real labels only**, draft a first response, comment, and apply the labels. |
| `issue_comment` | `created` containing `@hanzo <question>` | Answer the question in context (issue/PR body + comment thread) and reply. A bare `@hanzo` summarizes the thread. |

Bot-authored comments and comments without `@hanzo` are ignored, so the app
never talks to itself.

## Architecture

The cores are **pure** — total functions over their inputs, no network, no
Octokit, no `@hanzo/ai`. That is what makes the whole pipeline unit-testable
without a live gateway or a GitHub App:

```
webhook.ts   verify X-Hub-Signature-256 HMAC (constant time) + route (event,payload) → intent
review.ts    diff → window/truncate → prompt → review comment      (pure)
triage.ts    issue → prompt ; parse severity/labels/response       (pure)
mention.ts   issue/PR + thread + question → prompt → answer         (pure)
```

The impure edges compose them:

```
config.ts      the only env boundary → typed Config
hanzo.ts       thin over @hanzo/ai — the ONE path to the model
github-api.ts  thin Octokit .request() wrappers (getPRDiff, createReview, comment, addLabels, …)
app.ts         Octokit App + webhook handlers → routeEvent → dispatch
server.ts      HTTP server (health + graceful shutdown) around Octokit's node middleware
```

## Create the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
(or an org's settings for an org-owned app).

1. **Webhook**
   - **URL:** `https://<your-host>/v1/github/webhooks` (served by `hanzoai/ingress`).
   - **Secret:** a strong random string. This is `GITHUB_WEBHOOK_SECRET`; the app
     verifies `X-Hub-Signature-256` against it (HMAC-SHA256, constant time).

2. **Repository permissions**

   | Permission | Access | Why |
   | --- | --- | --- |
   | Pull requests | **Read & write** | Read the diff, post reviews/comments. |
   | Issues | **Read & write** | Comment on issues, apply labels. |
   | Contents | **Read-only** | Repo metadata for context. |
   | Metadata | **Read-only** | Mandatory. |

3. **Subscribe to events:** `Pull request`, `Issues`, `Issue comment`.

4. **Private key:** generate one on the app page and download the `.pem`. This is
   `GITHUB_PRIVATE_KEY`. The app mints a JWT from it and exchanges it for a
   per-installation token for every repo it operates on (Octokit handles this).

5. **App ID:** shown at the top of the app page → `GITHUB_APP_ID`.

6. **Install** the app on the repos or the whole org you want covered.

## Environment

Never commit secrets — env only (store in KMS, sync to k8s via `KMSSecret`).

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `GITHUB_APP_ID` | yes | — | Numeric app id. |
| `GITHUB_PRIVATE_KEY` | yes | — | PEM. `\n`-escaped one-liners are un-escaped automatically. |
| `GITHUB_WEBHOOK_SECRET` | yes | — | Verifies `X-Hub-Signature-256`. |
| `HANZO_API_KEY` | no | `''` | `sk-…` gateway bearer. Empty ⇒ anonymous/limited models. |
| `HANZO_API_BASE_URL` | no | `https://api.hanzo.ai` | Gateway. |
| `HANZO_MODEL` | no | `zen5` | Review/triage model (Zen, qwen3+). |
| `HANZO_MAX_DIFF_CHARS` | no | `120000` | Diff budget before windowing. |
| `HANZO_IAM_SERVER_URL` | no | `https://hanzo.id` | Token issuer (owner-scoping). |
| `HANZO_IAM_CLIENT_ID` | no | `hanzo-github` | Audience for inbound Hanzo tokens. |
| `PORT` | no | `3000` | Webhook server port. |

## Run

```bash
pnpm --filter @hanzo/github build
pnpm --filter @hanzo/github start   # node dist/server.js
```

- `GET /health` → readiness probe (`{ status: "ok", model }`).
- `POST /v1/github/webhooks` → the webhook sink. Octokit's node middleware
  verifies the signature and dispatches into the registered handlers.

Embed it instead of running the server:

```ts
import { createApp, loadConfig } from '@hanzo/github';
const app = createApp(loadConfig()); // Octokit App with handlers wired
```

## Deploy over hanzoai/ingress

Run as a stateless Deployment behind `hanzoai/ingress` (never nginx/caddy):

- Image `ghcr.io/hanzoai/github:<tag>` (`--platform linux/amd64`), built by CI.
- Route the app's webhook host to the Service; path `/v1/github/webhooks`.
- Secrets (`GITHUB_*`, `HANZO_API_KEY`) via `KMSSecret` from `kms.hanzo.ai` —
  never in the manifest.
- `livenessProbe`/`readinessProbe` → `GET /health`. The server drains on
  `SIGTERM` for zero-downtime rollouts.
- Scale horizontally: handlers are stateless; GitHub retries deliveries, and the
  installation token is fetched per request.

## GitHub Marketplace

To list publicly on the **GitHub Marketplace**: make the app public, complete the
Marketplace listing (name, logo, description, pricing plan — a free plan is
fine), and submit for review. The same webhook + permission model above applies;
Marketplace adds `marketplace_purchase` events for plan changes, which can be
handled later without touching the review/triage cores. Enterprises can install
the private app directly on their org without a Marketplace listing.

## Test

```bash
pnpm --filter @hanzo/github test        # vitest
pnpm --filter @hanzo/github typecheck   # tsc --noEmit
```

The pure cores are covered exhaustively: HMAC signature verification, event
routing, diff windowing/truncation, review/triage/mention prompt assembly, label
parsing, `@hanzo/ai` request shaping (mocked), and the full route → dispatch →
post path (fake Octokit).
