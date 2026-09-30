# Hanzo AI for Microsoft Office

A task-pane add-in that puts Hanzo AI inside **Word, Excel, and PowerPoint** —
desktop and Office on the web. Select text or a range, open the Hanzo pane from
the **Home** tab, ask, and insert the result. This is the surface a
non-developer (a lawyer drafting in Word, an analyst in Excel) actually uses —
distinct from the browser extension and the IDE extensions.

It reuses the **same backend as everything else Hanzo**: model calls go through
`api.hanzo.ai/v1` (OpenAI-compatible), sign-in is Hanzo IAM (`hanzo.id`,
authorization-code + PKCE, HIP-0111). No new API surface.

## What it does

- **Word** — read the selection; draft, rewrite, summarize, or answer; insert
  after or replace the selection.
- **Excel** — read the selected range (as TSV); analyze/transform; write the
  result down a column from the selection.
- **PowerPoint** — read/replace the selected text on a slide.

The engine of the add-in is small, pure, and unit-tested (`tests/`): the chat
request/response shaping (`chat.ts`), the PKCE + authorize URL (`pkce.ts`,
verified against the RFC 7636 test vector), the Excel range↔text helpers
(`host.ts`), and the endpoint contract (`config.ts`). The Office.js glue is thin.

## Build

```bash
pnpm --filter @hanzo/office-addin build      # production (base https://office.hanzo.ai)
pnpm --filter @hanzo/office-addin test        # vitest
```

The build stamps the **hosting base URL** into `dist/manifest.xml`. Office loads
the task pane from an HTTPS origin declared in the manifest; the same origin
serves `auth-callback.html` (the IAM redirect target, which must be registered
on the `hanzo-office` IAM client). Override the base for local dev:

```bash
HANZO_OFFICE_BASE=https://localhost:3000 pnpm --filter @hanzo/office-addin build
```

## Try it (sideload — no store needed)

The add-in is not on AppSource yet, but sideloading gives a lawyer immediate
use inside their own Office:

- **Office on the web**: open Word/Excel on the web → **Insert → Add-ins → Upload
  My Add-in** → pick `dist/manifest.xml`. (`dist/` must be served at the base URL
  over HTTPS.)
- **Windows / Mac desktop**: put `dist/manifest.xml` in a
  [shared-folder catalog](https://learn.microsoft.com/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)
  (or use `office-addin-debugging`), then **Home → Add-ins → Shared Folder**.
- **Whole firm**: an M365 admin deploys `manifest.xml` org-wide from the
  **Microsoft 365 admin center → Integrated apps** — every user gets the Hanzo
  button with no per-person install.

## Hosting

CI publishes `dist/` on every push to main: the repo's `hanzo.yml` `sites:`
entry `office` builds it and uploads it to the Sites plane
(`s3://hanzo-sites/hanzo/office`), and universe
`charts/app/values/hanzo/static-sites.yaml` routes `office.hanzo.ai` to that
prefix — no pod. So `https://office.hanzo.ai/manifest.xml` is always the
manifest of main, stamped for that host. The Outlook add-in (`../outlook`)
ships the same way at `outlook.hanzo.ai`.

Sign-in is the `hanzo-office` IAM client (`type: spa`, public, PKCE), declared
in universe `charts/app/values/hanzo/iam-provision.yaml` with the redirects
`https://office.hanzo.ai/auth-callback.html` and
`https://outlook.hanzo.ai/auth-callback.html`.

## Publish (AppSource — public listing)

`dist/manifest.xml` is a valid, submittable manifest (verified by
`office-addin-manifest validate`). To list publicly, submit
`https://office.hanzo.ai/manifest.xml` through **Microsoft Partner Center →
Marketplace offers → Office add-in** (needs a Partner Center account and
Microsoft's validation pass).

## Copilot (declarative agent) — not in this repo yet

A Microsoft 365 unified manifest (`manifest.json`) could carry this add-in and
declare Hanzo as a Copilot declarative agent, but not as one small file: an
agent that answers with Hanzo must call api.hanzo.ai through an API plugin,
otherwise Copilot answers with Microsoft's model. That is five files plus an
OAuth registration held by Microsoft. The steps:

1. Convert the XML manifest:
   `npx office-addin-manifest-converter convert dist/manifest.xml` writes
   `manifest.json` (unified manifest) and its color/outline icons.
2. In `manifest.json` (`manifestVersion` 1.19 or later) add
   `"copilotAgents": { "declarativeAgents": [{ "id": "hanzo", "file": "declarativeAgent.json" }] }`.
3. `declarativeAgent.json` (declarative agent schema v1.x): `name` "Hanzo AI",
   `description`, `instructions`, and
   `"actions": [{ "id": "hanzo", "file": "hanzo-plugin.json" }]`.
4. `hanzo-plugin.json` (API plugin schema v2.x): one `OpenApi` runtime with
   `"spec": { "url": "openapi.yaml" }`, `"run_for_functions": ["chat"]` and
   `"auth": { "type": "OAuthPluginVault", "reference_id": "<step 6>" }`.
5. `openapi.yaml`: server `https://api.hanzo.ai`, one operation
   `POST /v1/chat/completions` with `operationId: chat`.
6. Declare an IAM client `hanzo-copilot` in universe `iam-provision.yaml`
   (`type: confidential`, redirect
   `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`), seal its
   secret in KMS, then in the **Teams Developer Portal → Tools → OAuth client
   registration** register it: authorization endpoint
   `https://hanzo.id/v1/iam/oauth/authorize`, token and refresh endpoints
   `https://api.hanzo.ai/v1/iam/oauth/token`, scope
   `openid profile email offline_access`, base URL `https://api.hanzo.ai`. The
   registration ID it returns is step 4's `reference_id`.
7. Zip `manifest.json`, the icons and the three agent files; upload the zip in
   the **Microsoft 365 admin center → Settings → Integrated apps** (users need a
   Microsoft 365 Copilot license).

## Not here yet

- Streaming responses (this v1 is a single non-streaming completion, which keeps
  the insert atomic).
