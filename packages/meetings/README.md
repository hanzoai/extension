# Hanzo AI for Zoom + Google Meet

Bring Hanzo AI **into the meeting**. Every industry runs on calls; this puts a
Hanzo assistant in the side panel of **Zoom** and **Google Meet** to answer
questions about the meeting, write a **summary**, extract **action items**, and
draft a **follow-up email** — plus a server that turns a completed Zoom cloud
recording into a summary automatically.

Two surfaces, one shared panel:

- **Zoom App** (`src/zoom/`) — an in-meeting side panel over the **Zoom Apps
  SDK** (`@zoom/appssdk`), plus a small **server** (`src/zoom/server.ts`) for
  OAuth install and the `recording.completed` / `meeting.ended` **webhook**.
- **Google Meet add-on** (`src/meet/`) — a side-panel web app over the **Meet
  Add-ons SDK** (`@googleworkspace/meet-addons`).

Both mount the same assistant panel (`src/panel/`) and call the **same backend**
as the rest of the Hanzo productivity suite: model calls go through
`api.hanzo.ai/v1` (OpenAI-compatible, streamed over SSE) via `@hanzo/ai`, with
identity via `@hanzo/iam` (hanzo.id). No new API surface, no `/api/` prefix.

## What it does

- **Ask about the meeting** — grounded in the transcript, with speaker
  attribution, streamed as it's written.
- **Summarize** — purpose, key points, decisions.
- **Action items** — a checklist with owner and due date where stated.
- **Follow-up email** — a professional recap with next steps.
- **Auto-summary on Zoom cloud recordings** — the webhook downloads the recording
  transcript (VTT), summarizes it, and logs the result (delivery target is a
  per-deployment choice — see below).

## Transcript → summary — honest context windowing

A one-hour call transcribes to tens of thousands of words; it does not fit a
model context window and is never sent wholesale. `buildTranscriptContext` (in
`src/hanzo.ts`, pure and unit-tested) caps the attached transcript at
`TRANSCRIPT_CHAR_BUDGET` (48 000 chars):

- Segments are walked **in order** (order carries meaning in a meeting) and
  included until the budget is reached; at least the first segment is always
  included (hard-cut if that one segment is over budget).
- The request carries a **context note** stating how many of how many segments
  were sent and, when truncated, telling the model to answer only from what it
  sees and to say so if the omitted part is needed. The model is never told it
  has the whole meeting when it doesn't.

`parseVtt` turns Zoom's WebVTT transcript download into those segments (speaker +
start timestamp + text), leniently (unknown input → `[]`, reported honestly).

### A note on live in-panel transcripts

Neither the Zoom Apps SDK nor the Meet Add-ons SDK hands a **live** transcript to
an in-meeting panel. So the panels answer live questions and read meeting
metadata (topic, id, participants where scoped), while the **grounded transcript
summary** is produced **after** the call:

- **Zoom** — via the `recording.completed` webhook, which downloads the cloud
  recording's VTT. (Requires cloud recording + audio transcript enabled on the
  Zoom account.)
- **Meet** — the same server pattern can pull the transcript from the Meet REST
  API post-meeting (gated by Workspace admin policy + consent); the panel's
  `getTranscript()` returns `[]` today and is honest about it.

This is stated in the panel's context note rather than faked.

## Build

```bash
pnpm install --ignore-workspace
pnpm build        # → dist/zoom, dist/meet, dist/server.js
pnpm test         # vitest (pure logic: windowing, VTT, request shaping, webhook)
pnpm typecheck    # tsc --noEmit
pnpm start        # run the Zoom OAuth + webhook server (needs env, below)
```

Build output:

```
dist/zoom/index.html   dist/zoom/zoom.js    — Zoom App panel  (host at meetings.hanzo.ai/zoom)
dist/meet/index.html   dist/meet/meet.js    — Meet add-on panel (host at meetings.hanzo.ai/meet)
dist/server.js                              — Zoom OAuth install + webhook service
```

The Meet add-on needs its Google Cloud **project number** stamped in at build
time:

```bash
HANZO_MEET_GCP_PROJECT=123456789012 pnpm build
```

## Configuration (environment only — never commit secrets)

The server reads these from the environment (validated at startup by
`readServerConfig`; a missing required secret fails fast). Store them in KMS,
never in the repo.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ZOOM_CLIENT_ID` | yes | Zoom app OAuth client id (public; also used by the panel). |
| `ZOOM_CLIENT_SECRET` | yes | Zoom app OAuth client secret — **server only**. |
| `ZOOM_REDIRECT_URI` | yes | OAuth redirect, e.g. `https://meetings.hanzo.ai/zoom/oauth/callback`. |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | yes | Verifies the HMAC signature on every webhook. |
| `HANZO_API_KEY` | no | Bearer the webhook uses to summarize (no user in the loop). Without it, the webhook verifies + routes but skips summarization. |
| `PORT` | no | Listen port (default `8788`). |

The Meet add-on and the in-panel Zoom app use a **pasted Hanzo API key** (`hk-…`,
held in `localStorage`, validated by a real `/v1/models` call) — no OAuth client
needed for the panel itself. hanzo.id device login is the documented upgrade; the
bearer plumbing already tolerates any token.

## Register the Zoom App (marketplace.zoom.us)

1. **Create app** → *General app* (formerly "Zoom App / OAuth"). Choose
   *User-managed* (or account-level per your distribution).
2. **OAuth**
   - Redirect URL for OAuth: `https://meetings.hanzo.ai/zoom/oauth/callback`
     (= `ZOOM_REDIRECT_URI`).
   - Add `https://meetings.hanzo.ai` to the OAuth allow list.
3. **Scopes** (least privilege for what this app uses):
   - `meeting:read` — meeting context/UUID in-panel.
   - `cloud_recording:read` — download the recording transcript for the webhook.
   - (Optional) `meeting:read:list_participants` / participant scope for the
     participant list in the panel.
4. **Features → Zoom App SDK** — enable the embedded browser; add the
   in-client **Home URL**: `https://meetings.hanzo.ai/zoom/index.html`. Add the
   domain to the app's Domain Allow List. Under **Zoom App SDK → APIs**, enable
   exactly the JS APIs the panel requests in `src/zoom/main.ts`:
   `getMeetingContext`, `getMeetingUUID`, `getMeetingParticipants`,
   `getRunningContext`, `getUserContext`.
5. **Event Subscriptions (webhook)**
   - Event notification endpoint URL: `https://meetings.hanzo.ai/zoom/webhook`.
   - Subscribe to **Recording → Recording Completed** (`recording.completed`)
     and **Meeting → Meeting Ended** (`meeting.ended`).
   - Copy the **Secret Token** into `ZOOM_WEBHOOK_SECRET_TOKEN`.
   - **URL validation:** Zoom sends an `endpoint.url_validation` event on save;
     the server answers it automatically (echoes `plainToken` + its HMAC via
     `urlValidationResponse`), so click **Validate** with the server running.

**Webhook trust:** every request is verified before any transcript is fetched.
The server recomputes `v0=HMAC_SHA256(secretToken, "v0:{timestamp}:{rawBody}")`
over the **raw** body and compares it to `x-zm-signature` in constant time
(`verifySignature`). A bad or absent signature is a `401`.

## Register the Google Meet add-on

1. In the **Google Cloud project** that owns the add-on, note the **project
   number** and build with `HANZO_MEET_GCP_PROJECT=<number>`.
2. **Google Workspace Marketplace SDK** → configure a **Meet add-on**:
   - **Side panel URL:** `https://meetings.hanzo.ai/meet/index.html`
   - (Optional) **Main stage URL** if you add a main-stage view later.
   - Set the add-on's display name, logo, and support links.
3. Publish to your Workspace (private/internal listing is enough for an org).
   Admins install it for the domain; it then appears in the Meet **Activities**
   panel.

The side panel calls `meet.addon.createAddonSession({ cloudProjectNumber })` →
`createSidePanelClient()` and reads `getMeetingInfo()` (meeting id + code). See
`src/meet/main.ts`.

## Hosting (hanzoai/static + hanzoai/ingress)

The two panels are static (HTML + one ESM bundle + icons) — serve `dist/zoom`
and `dist/meet` with **hanzoai/static** behind **hanzoai/ingress** at
`meetings.hanzo.ai`. The **server** (`dist/server.js`) is a small dependency-free
Node service (Node stdlib only) — run it as a container behind the same ingress
for the `/zoom/install`, `/zoom/oauth/callback`, and `/zoom/webhook` routes.
Every model call goes to `api.hanzo.ai/v1` regardless of the host origin. No
nginx, no caddy.

## Where the summary is delivered

The webhook pipeline is complete through **generating the summary**
(`handleRecordingCompleted` → `summarizeTranscript`). Delivering it — posting to
Zoom Team Chat, emailing participants, writing to a CRM — is a per-deployment
choice wired at the marked hook in `src/zoom/server.ts`; the summary text is in
hand there.

## Layout

```
src/
  config.ts          endpoints, pickBearer, server env (readServerConfig)
  hanzo.ts           chat client + transcript windowing/VTT + prompt assembly (pure core)
  auth.ts            pasted-key storage + validation (localStorage)
  panel/
    host.ts          PanelHost — the seam between the panel and a platform
    panel.ts         shared DOM wiring (model picker, chips, streaming output)
    panel.html       shared panel markup (stamped per surface at build)
  zoom/
    main.ts          Zoom App entry — PanelHost over zoomSdk
    oauth.ts         Zoom OAuth request shaping (pure)
    webhook.ts       signature verify + url-validation + event routing (pure)
    server.ts        http glue: install / oauth callback / webhook
  meet/
    main.ts          Meet add-on entry — PanelHost over the Meet SDK
tests/               vitest for every pure module
build.js             esbuild → dist/ (both panels + server)
```
