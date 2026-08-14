# Hanzo AI for Google Workspace

A Google Workspace **add-on** that puts Hanzo AI inside **Google Docs, Sheets,
Slides, and Gmail** — the Google-ecosystem counterpart to
[`@hanzo/office-addin`](../office) (Word/Excel/PowerPoint). Open the Hanzo panel
from the add-on sidebar, pick a model, ask (or tap a quick action), and insert
the result into the document.

It reuses the **same backend as everything else Hanzo**: model calls go through
`api.hanzo.ai/v1` (OpenAI-compatible) via `UrlFetchApp`. No new API surface.

## Architecture

Google Workspace Add-ons run on **Apps Script** (server-side JS in Google's V8
runtime) with a **CardService** UI — not HTML/JS in a task pane. Apps Script has
no `fetch`/SSE, so every model call is **one non-streaming completion**
(`UrlFetchApp.fetch` → insert), which keeps the insert atomic.

```
src/
  appsscript.json   add-on manifest: scopes, urlFetchWhitelist, per-host triggers
  hanzo.gs          API client — buildMessages / requestBody / extractContent /
                    parseModels (pure, tested) + ask / listModels (UrlFetchApp) +
                    the per-user API-key & model store (PropertiesService)
  ui.gs             CardService UI + every entry point the manifest names:
                    homepage triggers, Gmail contextual/compose triggers,
                    settings + universal actions, button handlers
  docs.gs           Docs: read selection/body, insert/replace at cursor
  sheets.gs         Sheets: read range as TSV, write result down a column
  slides.gs         Slides: read selected text/shapes, insert
  gmail.gs          Gmail: read the open message/thread, draft a reply
tests/              vitest over the pure logic (loads the .gs in a Node sandbox)
scripts/            validate-manifest.mjs — preflight before `clasp push`
```

The pure functions live **once** in the `.gs` files and end with a guarded
`module.exports` (inert in Apps Script — it has no `module` — but live under
Node), so the tests exercise the exact shipped code with zero duplication.

## Auth

Paste a Hanzo **API key** (`sk-…`, created at
[console.hanzo.ai/api-keys](https://console.hanzo.ai/api-keys)) into the add-on
**Settings** card. It is stored in `PropertiesService.getUserProperties()`
(per-user, never leaves the account) and sent as `Authorization: Bearer <key>`.
No key means the add-on shows an onboarding card first.

## OAuth scopes (in `appsscript.json`)

| Scope | Why |
| --- | --- |
| `documents.currentonly` | read/insert in the open Doc |
| `spreadsheets.currentonly` | read range / write cell in the open Sheet |
| `presentations.currentonly` | read/insert in the open Slides deck |
| `gmail.addons.current.message.readonly` | read the open message/thread |
| `gmail.addons.current.message.metadata` | message metadata for the contextual trigger |
| `gmail.addons.current.action.compose` | open a draft reply |
| `gmail.addons.execute` | run the Gmail add-on |
| `script.external_request` | `UrlFetchApp` to `api.hanzo.ai` |
| `script.locale` | user locale |

`urlFetchWhitelist` is pinned to `https://api.hanzo.ai/` — the add-on can call
**nothing else**.

## Develop & test

```bash
pnpm --filter @hanzo/gworkspace-addon test        # vitest over the pure logic
pnpm --filter @hanzo/gworkspace-addon validate     # manifest + .gs preflight
```

`validate` checks that `appsscript.json` is valid JSON with the required scopes
and the `api.hanzo.ai` whitelist, that every `runFunction`/`onTriggerFunction`
the manifest names is defined in a `.gs`, and that every `.gs` parses.

## Deploy (clasp → Apps Script → Workspace Add-on)

[`clasp`](https://github.com/google/clasp) is the Apps Script CLI. It is a
devDependency of this package.

### 1. One-time: log in and create the Apps Script project

```bash
cd packages/gworkspace
pnpm install                       # installs @google/clasp
pnpm exec clasp login              # opens a browser; authorizes clasp

# Create a NEW standalone Apps Script project bound to nothing (add-ons are
# standalone, not container-bound). This writes .clasp.json for you:
pnpm exec clasp create --type standalone --title "Hanzo AI" --rootDir src
```

If the project already exists (a teammate created it), skip `create` and copy
`.clasp.json.example` → `.clasp.json`, filling in the `scriptId` from the Apps
Script editor (**Project Settings → IDs → Script ID**). `.clasp.json` is
git-ignored; only the `.example` is committed.

### 2. Push the code

```bash
pnpm exec clasp push               # uploads src/*.gs + src/appsscript.json
```

`rootDir: src` and `.claspignore` mean only the `.gs` files and the manifest are
pushed — tests, scripts, and `node_modules` stay local.

> The **Google Cloud project** backing the Apps Script must have the
> **Google Workspace Add-ons API** and (for Gmail) the **Gmail API** enabled,
> and an **OAuth consent screen** configured. In the Apps Script editor:
> **Project Settings → Google Cloud Platform (GCP) Project** → switch to a
> standard GCP project you own, then enable those APIs in that project.

### 3. Test-deploy (install into your own account)

In the [Apps Script editor](https://script.google.com) for the project:

1. **Deploy → Test deployments**.
2. Under **Application(s): Google Workspace Add-on**, click **Install**.
3. Open Docs / Sheets / Slides / Gmail — the **Hanzo AI** add-on appears in the
   right-hand add-on rail. Open it, go to **Settings**, paste your `sk-` key.

A test deployment installs the add-on **only for you**, from the current HEAD of
what you pushed — the fast inner loop.

### 4. Versioned deployment (for sharing / Marketplace)

```bash
pnpm exec clasp deploy --description "v1"      # cuts a numbered version
pnpm exec clasp deployments                     # list deployment ids
```

A versioned deployment is what the Google Workspace Marketplace listing points
at.

## Publish to the Google Workspace Marketplace (staged)

Add-ons are distributed through the **Google Workspace Marketplace**, configured
via the **Google Cloud Console** on the same GCP project that backs the Apps
Script.

1. **Enable** the *Google Workspace Marketplace SDK* on the GCP project
   (**APIs & Services → Library**).
2. **Marketplace SDK → App Configuration**:
   - **Visibility: `Private`** (only your Workspace org) first, or **`Unlisted`**
     (anyone with the link) for a wider staged test — **not `Public`** yet.
   - **App integration: Google Workspace Add-on**, and paste the **deployment
     ID** from `clasp deployments` (step 4 above).
   - Declare the same OAuth scopes as `appsscript.json`.
3. **Marketplace SDK → Store Listing**: name (Hanzo AI), icons, screenshots,
   description, support/privacy URLs (`hanzo.ai/support`,
   `hanzo.ai/privacy`), then **Publish** to the chosen visibility.
4. **OAuth verification**: because the add-on requests Gmail scopes, a
   **`Public`** listing requires Google's **OAuth app verification** (and, for
   the restricted Gmail scopes, a **CASA security assessment**). Stay
   `Private`/`Unlisted` until that clears — internal-org (`Private`) and
   unlisted installs work without full verification.

**Staging path:** `Private` (your org) → `Unlisted` (link-shared beta) →
`Public` (after OAuth verification + CASA). Ship internal first.

## Not here yet

- **Streaming** — Apps Script has no SSE reader, so responses are single
  non-streaming completions by design.
- **Hanzo OAuth (hanzo.id) sign-in** — the Office add-in offers an IAM OAuth
  path in addition to the API key; here the API key is the one path (an OAuth
  path would need a registered redirect on the Apps Script web-app URL). API key
  is complete and zero-setup.
