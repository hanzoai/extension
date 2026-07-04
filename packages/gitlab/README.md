# @hanzo/gitlab

Hanzo AI on GitLab. A **webhook service** (GitLab Project/Group webhooks + REST
API v4) that reviews merge requests, triages new issues, and answers `@hanzo`
mentions in issue and MR notes — on self-managed GitLab and gitlab.com alike.

Built on the shared Hanzo foundation:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — the headless model
  client. Every model call goes through `createAiClient(...).chat.completions.create(...)`
  against `https://api.hanzo.ai` (`/v1/...`). This package never speaks raw HTTP
  to the gateway.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity.
  Used to validate an inbound Hanzo user token when a request is owner-scoped.

## What it does

| `X-Gitlab-Event` | Action | Behaviour |
| --- | --- | --- |
| `Merge Request Hook` | `open`, `update`, `reopen` | Fetch the MR's file changes, reconstruct a unified diff, window it to the model budget (honest truncation note on large MRs), review it, and post a **note** on the MR. |
| `Issue Hook` | `open`, `reopen` | Summarize the issue, assign a severity, suggest labels **from the project's real labels only**, draft a first response, post a note, and apply the labels. |
| `Note Hook` | note on an MR/Issue containing `@hanzo <question>` | Answer the question in context (issue/MR body + note thread) and reply. A bare `@hanzo` summarizes the thread. |

System notes (label changes, etc.) and notes without `@hanzo` are ignored, so
the service never talks to itself.

## Architecture

The cores are **pure** — total functions over their inputs, no network, no REST
client, no `@hanzo/ai`. That is what makes the whole pipeline unit-testable
without a live gateway or a GitLab host:

```
webhook.ts   verify X-Gitlab-Token (constant time) + route (event,payload) → intent
review.ts    GitLab changes → unified diff → window/truncate → prompt → note   (pure)
triage.ts    issue → prompt ; parse severity/labels/response                    (pure)
mention.ts   issue/MR + thread + question → prompt → answer                     (pure)
```

The impure edges compose them:

```
config.ts      the only env boundary → typed Config
hanzo.ts       thin over @hanzo/ai — the ONE path to the model
gitlab-api.ts  thin REST v4 fetch wrappers (getMRChanges, listLabels, createNote, addLabels, …)
app.ts         GitlabClient + route → dispatch → post
server.ts      HTTP server (verify token, health, graceful shutdown)
```

## Set up the webhook

GitLab is authenticated two ways here: the **service** authenticates to GitLab's
REST API with an **access token** (`api` scope), and each **delivery** is
verified with a **secret token** you set on the webhook.

### 1. Access token (`GITLAB_TOKEN`)

Create a token with the **`api`** scope. Any of these work:

- **Project Access Token** — Project → **Settings → Access Tokens**. Scope
  `api`, role `Reporter` (read + note) or `Developer` (also apply labels).
  Simplest for a single project.
- **Group Access Token** — Group → **Settings → Access Tokens**. Covers every
  project in the group.
- **Personal Access Token** — for a bot user that is a member of the projects.
- **GitLab App OAuth token** — for a multi-tenant install; send it as
  `Authorization: Bearer` instead (the client uses `PRIVATE-TOKEN`; both are
  accepted by GitLab).

### 2. Webhook + secret token (`GITLAB_WEBHOOK_SECRET`)

Project → **Settings → Webhooks → Add new webhook** (or Group → **Webhooks** to
cover every project in the group).

- **URL:** `https://<your-host>/v1/gitlab/webhook` (served by `hanzoai/ingress`).
- **Secret token:** a strong random string. This is `GITLAB_WEBHOOK_SECRET`;
  GitLab sends it verbatim in the `X-Gitlab-Token` header, and the service
  compares it in **constant time** before doing any work. (GitLab does not HMAC
  the body — the shared secret token is the gate.)
- **Trigger — check these boxes:**
  - **Merge request events**
  - **Issues events**
  - **Comments** (note events)
- **SSL verification:** on.

Click **Add webhook**, then **Test → Merge request events** to confirm delivery.

## Environment

Never commit secrets — env only (store in KMS, sync to k8s via `KMSSecret`).

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `GITLAB_TOKEN` | yes | — | Access token with `api` scope. |
| `GITLAB_WEBHOOK_SECRET` | yes | — | Verifies `X-Gitlab-Token` (constant time). |
| `GITLAB_BASE_URL` | no | `https://gitlab.com` | Self-managed host, e.g. `https://gitlab.acme.internal`. |
| `HANZO_API_KEY` | no | `''` | `hk-…` gateway bearer. Empty ⇒ anonymous/limited models. |
| `HANZO_API_BASE_URL` | no | `https://api.hanzo.ai` | Gateway. |
| `HANZO_MODEL` | no | `zen5` | Review/triage model (Zen, qwen3+). |
| `HANZO_MAX_DIFF_CHARS` | no | `120000` | Diff budget before windowing. |
| `HANZO_IAM_SERVER_URL` | no | `https://hanzo.id` | Token issuer (owner-scoping). |
| `HANZO_IAM_CLIENT_ID` | no | `hanzo-gitlab` | Audience for inbound Hanzo tokens. |
| `PORT` | no | `3000` | Webhook server port. |

## Run

```bash
pnpm --filter @hanzo/gitlab build
pnpm --filter @hanzo/gitlab start   # node dist/server.js
```

- `GET /health` → readiness probe (`{ status: "ok", model }`).
- `POST /v1/gitlab/webhook` → the webhook sink. The server verifies
  `X-Gitlab-Token`, routes on `X-Gitlab-Event`, ACKs `202`, then runs the model
  work off the response path (GitLab retries slow deliveries).

Embed it instead of running the server:

```ts
import { createService, loadConfig, dispatch } from '@hanzo/gitlab';
const svc = createService(loadConfig());
await dispatch('Issue Hook', payload, svc.client, svc.config, svc.run);
```

## The MR-review / triage flow

1. GitLab delivers a webhook to `/v1/gitlab/webhook` with `X-Gitlab-Token` and
   `X-Gitlab-Event`.
2. `verifyToken` compares the token to `GITLAB_WEBHOOK_SECRET` in constant time.
   Mismatch ⇒ `401`, nothing runs.
3. `routeEvent(event, payload)` maps the delivery to one intent: `review_mr`,
   `triage_issue`, `answer_mention`, or `ignore`.
4. **Review:** `getMRChanges` → `/projects/{id}/merge_requests/{iid}/changes` →
   `changesToDiff` reconstructs a unified diff → `windowDiff` trims to the model
   budget with an honest note → `hanzo.complete` reviews → `createMRNote` posts
   the note.
5. **Triage:** `listLabels` → `/projects/{id}/labels` → the model picks a
   severity + labels **intersected with the real project labels** → `createIssueNote`
   posts the summary + drafted reply → `addIssueLabels` (`PUT …?add_labels=…`)
   applies only the real labels.
6. **Mention:** `getNotes` fetches the thread (system notes dropped) →
   `hanzo.complete` answers in context → the reply is posted on the MR or issue.

## Deploy over hanzoai/ingress

Run as a stateless Deployment behind `hanzoai/ingress` (never nginx/caddy):

- Image `ghcr.io/hanzoai/gitlab:<tag>` (`--platform linux/amd64`), built by CI.
- Route the webhook host to the Service; path `/v1/gitlab/webhook`.
- Secrets (`GITLAB_TOKEN`, `GITLAB_WEBHOOK_SECRET`, `HANZO_API_KEY`) via
  `KMSSecret` from `kms.hanzo.ai` — never in the manifest.
- `livenessProbe`/`readinessProbe` → `GET /health`. The server drains on
  `SIGTERM` for zero-downtime rollouts.
- Scale horizontally: handlers are stateless; GitLab retries deliveries, and the
  service token authenticates every REST call.

## Test

```bash
pnpm --filter @hanzo/gitlab test        # vitest
pnpm --filter @hanzo/gitlab typecheck   # tsc --noEmit
```

The pure cores are covered exhaustively: constant-time token verification, event
routing, GitLab-changes → unified-diff reconstruction, diff windowing/truncation,
review/triage/mention prompt assembly, label parsing ∩ project labels,
`@hanzo/ai` request shaping (mocked), the REST wrappers (fake fetch), the full
route → dispatch → post path, and the HTTP boundary (token gate, health, ACK).
