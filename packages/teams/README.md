# Hanzo AI for Microsoft Teams

A **Bot Framework** app that brings Hanzo AI into **Microsoft Teams** — the
comms standard for enterprises and regulated, non-technical orgs. DM Hanzo or
`@mention` it in a channel, run quick actions on any message ("Ask Hanzo"), or
compose an AI draft — all answered by Hanzo AI and rendered as native
**Adaptive Cards**.

It reuses the **same backend and design as every other Hanzo surface**: model
calls go through **`api.hanzo.ai` / `/v1`** via the headless
[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai) client (never an `/api/`
path), identity is Hanzo IAM via [`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam),
and every card is built from the shared canonical panel spec in
[`@hanzo/cards`](../cards) — one `PanelSpec` → `toAdaptiveCard`. No new API
surface, no hand-written Adaptive Card JSON.

## What it does

- **Chat** — a DM or `@Hanzo <prompt>` in a channel runs a completion and
  replies with the Hanzo assistant panel (model picker, quick actions, prompt).
- **Quick actions** — Draft reply, Summarize, Explain, Extract action items —
  as Adaptive Card buttons and as the **"Ask Hanzo"** message-action command on
  any message.
- **Compose** — the **"Compose with Hanzo"** command generates an AI draft to
  insert while writing a message.
- **Adaptive Card actions** — model picker (`Input.ChoiceSet`), quick-action
  buttons, and a prompt `Input.Text` + submit, all from `@hanzo/cards`.

## Architecture

```
Teams  ──POST /api/messages──▶  server.ts (restify + CloudAdapter)
                                      │
                                      ▼
                                   bot.ts  (TeamsActivityHandler)
             ┌────────────────────────┼─────────────────────────┐
             ▼                        ▼                          ▼
        context.ts               dispatch.ts                 panels.ts
    (message/thread text)   (data.action → intent)   (PanelSpec → Adaptive Card
             │                        │                    via @hanzo/cards)
             └───────────┬────────────┘
                         ▼
                     hanzo.ts  ──▶  @hanzo/ai  ──▶  api.hanzo.ai /v1
```

Everything except `server.ts` (opens the socket) and `bot.ts` (wires botbuilder)
is a **pure** module — `dispatch`, `panels`, `context`, `hanzo`, `identity`,
`config` — so the routing, card assembly, and text extraction are unit-tested in
isolation.

### The `Action.Submit` dispatch flow

Every button and input in a Hanzo card comes from `@hanzo/cards`, which stamps a
stable id onto each `Action.Submit` as **`data.action`**, and keys the inputs by
`ActionId.ModelSelect` (`hanzo_model_select`) and `PROMPT_INPUT_ID`
(`hanzo_prompt`). Teams returns that merged payload on submit, and
[`dispatch(data)`](src/dispatch.ts) turns it into one typed `CardIntent`:

| `data.action`                       | Also carries                         | → `CardIntent`                         |
| ----------------------------------- | ------------------------------------ | -------------------------------------- |
| `hanzo_sign_in`                     | —                                    | `{ kind: 'sign_in' }`                  |
| `hanzo_model_select`                | `hanzo_model_select` = model id      | `{ kind: 'model_select', model }`      |
| `hanzo_prompt_submit`               | `hanzo_prompt`, `hanzo_model_select` | `{ kind: 'prompt', prompt, model? }`   |
| `hanzo_quick_action:<chip>`         | `chip`, `hanzo_prompt`, model        | `{ kind: 'quick_action', chip, … }`    |
| _anything else_                     | —                                    | `{ kind: 'unknown', action? }`         |

`bot.ts` receives the submit two ways and routes both through the same
`dispatch`: a classic `Action.Submit` arrives as a **message activity** with
`activity.value` set (handled in `onMessage`), and an `Action.Execute` arrives
via `onAdaptiveCardInvoke` (`invokeValue.action.data`). One routing table, two
entry points.

## Requirements

- Node 18+ and `pnpm`.
- An Azure Bot registration (app id + secret) — see below.
- A Hanzo API key (`sk-…`) with model access on `api.hanzo.ai`.

## Configuration

All secrets come from the **environment** — nothing is committed. `loadConfig`
([src/config.ts](src/config.ts)) reads and validates them at startup:

| Variable                  | Required | Default              | Meaning                                              |
| ------------------------- | -------- | -------------------- | ---------------------------------------------------- |
| `MICROSOFT_APP_ID`        | yes      | —                    | Azure Bot app id (`botId`).                          |
| `MICROSOFT_APP_PASSWORD`  | yes      | —                    | Azure Bot client secret.                             |
| `HANZO_API_KEY`           | yes      | —                    | Hanzo API key (bearer to api.hanzo.ai).              |
| `MICROSOFT_APP_TYPE`      | no       | `MultiTenant`        | `MultiTenant` / `SingleTenant` / `UserAssignedMSI`.  |
| `MICROSOFT_APP_TENANT_ID` | no       | `""`                 | AAD tenant id (required for `SingleTenant`).         |
| `HANZO_BASE_URL`          | no       | `https://api.hanzo.ai` | Override the AI base URL (local dev).              |
| `HANZO_MODELS`            | no       | `zen5,zen5-flash,zen5-mini,zen5-coder,zen5-pro` | Comma-separated picker models. |
| `HANZO_DEFAULT_MODEL`     | no       | first of `HANZO_MODELS` | Default model id.                                |
| `PORT`                    | no       | `3978`               | HTTP port for the messaging endpoint.                |

## Develop

```bash
pnpm install          # from the monorepo root (workspace), or standalone here
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest — pure logic (dispatch, panels, context, config, …)
pnpm build            # tsup → dist/ (library + runnable server)
pnpm start            # node dist/server.js  (needs the env above)
```

Run locally against Teams with a tunnel (e.g. `devtunnel` or `ngrok`) pointing
at `http://localhost:3978/api/messages`.

## Azure Bot registration

1. In the **Azure portal** → **Create a resource** → **Azure Bot**. Choose a
   name and, for **Type of App**, **Multi Tenant** (or Single Tenant / MSI).
2. Under **Configuration**, set the **Messaging endpoint** to your public URL:
   `https://<your-host>/api/messages`.
3. Under **Configuration → Microsoft App ID**, copy the **App ID** →
   `MICROSOFT_APP_ID`. Click **Manage** → **Certificates & secrets** → **New
   client secret** → copy the value → `MICROSOFT_APP_PASSWORD`.
4. Under **Channels**, add the **Microsoft Teams** channel.

## Build & sideload the Teams app package

The Teams app package is a zip of `manifest.json` + `color.png` + `outline.png`.
The build step substitutes `${{…}}` placeholders from the environment and zips:

```bash
MICROSOFT_APP_ID=<your-bot-app-id> \
TEAMS_APP_ID=<a-guid-for-the-app> \   # optional; defaults to MICROSOFT_APP_ID
  pnpm package                        # → dist/hanzo-teams.zip
```

Then upload it one of two ways:

- **Developer Portal / Teams client** — Teams → **Apps** → **Manage your apps**
  → **Upload an app** → **Upload a custom app** → pick `dist/hanzo-teams.zip`.
- **Teams Admin Center** (org-wide) — **Teams apps → Manage apps → Upload new
  app**, then set the org/app permission policy so users can install it.

### Manifest highlights ([manifest/manifest.json](manifest/manifest.json))

- **Schema** `v1.16`.
- **`bots`** — scopes `personal`, `team`, `groupChat` (1:1, channel, group chat).
- **`composeExtensions`** — `askHanzo` (action, contexts `message`/`compose`/
  `commandBox`, with the four quick actions as a `choiceset`) and `composeHanzo`
  (query, inserts an AI draft).
- **`permissions`** — `identity`, `messageTeamMembers`.
- **`validDomains`** — `api.hanzo.ai`, `token.botframework.com`.

## Identity

Two supported models, both in [src/identity.ts](src/identity.ts):

1. **Per-tenant key** (default, complete out of the box) — the tenant is
   provisioned one `HANZO_API_KEY`; every Teams user acts as that Hanzo
   principal. The enterprise/regulated-org pattern.
2. **Per-user link** — a Teams user presents a Hanzo IAM JWT (via Teams SSO);
   `resolveFromToken` validates it with `@hanzo/iam` and derives the Hanzo org
   from the `sub` (`org/username`) claim.

## Deploy

Build the image in CI (`ghcr.io/hanzoai/teams`, `--platform linux/amd64`) and
run it behind the platform ingress; set the Azure Bot **Messaging endpoint** to
`https://<host>/api/messages`. Secrets (`MICROSOFT_APP_*`, `HANZO_API_KEY`) come
from KMS, never from the image or the repo. `GET /healthz` is the readiness
probe.
