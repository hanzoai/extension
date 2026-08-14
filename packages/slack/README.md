# @hanzo/slack

Hanzo AI in Slack — the comms hub of every knowledge org.

A [Bolt](https://slack.dev/bolt-js) app that brings the Hanzo assistant into
Slack: a `/hanzo` slash command, an **App Home** assistant panel, an **Ask
Hanzo** message shortcut, and full interactivity. It is built on the shared
Hanzo foundation and writes **no** Block Kit by hand:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — headless client.
  `createAiClient({ token }).chat.completions.create({ model, messages })`
  (non-streaming — cards do not stream) and `.models.list()`. Defaults to
  `https://api.hanzo.ai`, `/v1/...`.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity.
  `validateToken` verifies an inbound Hanzo user token against IAM and yields the
  `owner` (org) claim for scoping.
- **`@hanzo/cards`** (workspace) — the ONE canonical `PanelSpec` →
  `toSlackBlocks(spec)` gives the Block Kit `blocks[]`. Stable action ids:
  `hanzo_model_select`, `hanzo_prompt_submit`, `hanzo_quick_action:<id>`,
  `hanzo_sign_in`, prompt field `hanzo_prompt`.

## What it does

| Surface | Trigger | Behavior |
| --- | --- | --- |
| Slash command | `/hanzo <prompt>` | Runs one completion, replies in-channel with a `@hanzo/cards` result panel. |
| App Home | Open the app's Home tab | Renders the assistant panel: model picker, quick-action chips, prompt input, sign-in state. |
| Interactivity | Buttons / selects | Handles the stable card action ids (model select, quick actions, prompt submit, sign in). |
| Message shortcut | **Ask Hanzo** on a message | Summarizes the message/thread and replies ephemerally. |
| App mention | `@Hanzo …` in a thread | Replies in-thread with a completion over the thread context. |

**Quick actions** — Summarize, Draft reply, Explain, Action items — operate on
the **thread or message** the user invoked them on. The handler pulls that
context via `conversations.replies` (a thread) or `conversations.history` (a
standalone message), then [`thread.ts`](src/thread.ts) turns the Slack messages
into a token-bounded text block (drops join/leave noise, keeps the **most
recent** messages within the char budget). That text is fenced into the prompt
so the model treats it as data, not instructions.

## Architecture

One path from Slack to the model. Pure modules are unit-tested; Bolt handlers
are thin glue.

```
src/
  config.ts   env boundary → typed SlackConfig (all secrets from env)
  client.ts   createAiClient — OpenAI-compatible /v1 client (fetch injectable)
  hanzo.ts    complete(prompt, context, model, token) → text; quick-action catalog; IAM validation
  thread.ts   Slack messages → model-ready text (noise-drop + truncation)
  panels.ts   PanelSpecs via @hanzo/cards → toSlackBlocks / home view
  actions.ts  action-id routing (parse hanzo_quick_action:<id>, …)
  install.ts  OAuth InstallationStore + per-workspace Hanzo token (server-side)
  app.ts      Bolt wiring: commands, actions, events, home, shortcut
  server.ts   HTTP entry: start Bolt, add /health, graceful shutdown
```

> `client.ts` is the `createAiClient` contract the app is written against.
> Point it at the published `@hanzo/ai` headless client by re-exporting from
> there — the call sites do not move.

## Configuration (env only — never commit secrets)

| Var | Required | Purpose |
| --- | --- | --- |
| `SLACK_SIGNING_SECRET` | yes | Verify request signatures. |
| `SLACK_BOT_TOKEN` | single-workspace | `xoxb-…` bot token. Use this **or** OAuth. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | OAuth | Multi-workspace install. |
| `SLACK_STATE_SECRET` | OAuth | Signs the OAuth `state`. |
| `SLACK_APP_TOKEN` | Socket Mode | `xapp-…`, with `SLACK_SOCKET_MODE=true`. |
| `HANZO_API_KEY` | no | App-default gateway bearer (`sk-…`). A workspace's own bound token overrides it. |
| `HANZO_API_BASE_URL` | no | Gateway base. Default `https://api.hanzo.ai`. |
| `HANZO_DEFAULT_MODEL` | no | Default model. Default `zen5`. |
| `HANZO_IAM_SERVER_URL` | no | IAM origin for token validation. Default `https://hanzo.id`. |
| `HANZO_IAM_CLIENT_ID` | no | OAuth client id inbound Hanzo tokens are audienced to. Default `hanzo-slack`. |
| `HANZO_INSTALL_STORE` | no | Path to the JSON install store. Default `./.data/installations.json`. |
| `PORT` | no | HTTP port. Default `3000`. |

The gateway bearer resolves **workspace token first, then `HANZO_API_KEY`, then
anonymous** (`resolveBearer`). Slack bot tokens and Hanzo tokens are stored
server-side only (`install.ts`) and never logged.

## Run

```bash
pnpm install
pnpm build
SLACK_SIGNING_SECRET=… SLACK_BOT_TOKEN=xoxb-… HANZO_API_KEY=sk-… pnpm start
# → @hanzo/slack listening on :3000
```

Scripts: `build` (tsc emit to `dist/`), `typecheck` (`tsc --noEmit`), `test`
(vitest), `start` (`node dist/server.js`).

## Register the Slack app

### 1. Create the app from the manifest (one click)

Go to <https://api.slack.com/apps> → **Create New App** → **From an app
manifest**, pick your workspace, and paste [`manifest.yaml`](#slack-app-manifest)
below. Replace `https://slack.hanzo.ai` with your public base URL.

The manifest declares:

- **Bot scopes**: `commands`, `chat:write`, `app_mentions:read`,
  `channels:history`, `groups:history`, `im:history`, `mpim:history`
  (`*:history` scopes let quick actions read the thread/message context).
- **Slash command** `/hanzo` → `POST {BASE}/slack/events`.
- **Interactivity + events** request URL → `POST {BASE}/slack/events`
  (Bolt handles commands, actions, and the Events API on one endpoint).
- **Events subscribed**: `app_home_opened`, `app_mention`.
- **App Home** with the Home tab enabled.
- **Message shortcut** `Ask Hanzo` (callback id `hanzo_ask`).
- **OAuth redirect** `{BASE}/slack/oauth_redirect`.

### 2. Install

- **Single workspace**: **Install to Workspace**, copy the Bot User OAuth Token
  (`xoxb-…`) into `SLACK_BOT_TOKEN`, and the Signing Secret into
  `SLACK_SIGNING_SECRET`.
- **Multi-workspace (OAuth)**: set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
  `SLACK_STATE_SECRET`, then send admins to `{BASE}/slack/install`. Each install
  is stored per team; bind that workspace's Hanzo `sk-…` key with
  `store.setHanzoToken(teamId, { token })`.

### 3. Point Slack at your URLs

If you edited URLs after creation: **Slash Commands** → `/hanzo` request URL;
**Interactivity & Shortcuts** → request URL + the `Ask Hanzo` shortcut;
**Event Subscriptions** → request URL + subscribe to `app_home_opened` and
`app_mention`; **OAuth & Permissions** → redirect URL. All point at
`{BASE}/slack/events` except the redirect (`{BASE}/slack/oauth_redirect`).

## Deploy

Serve the Bolt HTTP receiver behind `hanzoai/ingress` (never nginx/caddy) as a
small K8s service, or over `hanzoai/static` + gateway. The container exposes
`/health` for probes and shuts down gracefully on SIGTERM. Provide secrets from
KMS (never in manifests). Images: `ghcr.io/hanzoai/slack:<tag>`,
`--platform linux/amd64`, built by CI/CD — never locally.

## Slack app manifest

```yaml
display_information:
  name: Hanzo
  description: Hanzo AI in Slack — ask, summarize, draft, and explain.
  background_color: "#0b0b0d"
features:
  bot_user:
    display_name: Hanzo
    always_online: true
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: false
    messages_tab_read_only_enabled: true
  slash_commands:
    - command: /hanzo
      url: https://slack.hanzo.ai/slack/events
      description: Ask Hanzo AI
      usage_hint: "[your prompt]"
      should_escape: false
  shortcuts:
    - name: Ask Hanzo
      type: message
      callback_id: hanzo_ask
      description: Summarize or draft a reply with Hanzo AI
oauth_config:
  redirect_urls:
    - https://slack.hanzo.ai/slack/oauth_redirect
  scopes:
    bot:
      - commands
      - chat:write
      - app_mentions:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history
settings:
  event_subscriptions:
    request_url: https://slack.hanzo.ai/slack/events
    bot_events:
      - app_home_opened
      - app_mention
  interactivity:
    is_enabled: true
    request_url: https://slack.hanzo.ai/slack/events
  org_deploy_enabled: true
  socket_mode_enabled: false
  token_rotation_enabled: false
```

## License

MIT © Hanzo AI
