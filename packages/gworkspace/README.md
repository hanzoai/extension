# Hanzo AI for Google Workspace

A Google Workspace **add-on** that puts Hanzo AI inside **Google Drive, Docs,
Sheets, Slides, and Gmail** — the Google-ecosystem counterpart to
[`@hanzo/office-addin`](../office) (Word/Excel/PowerPoint). Open the Hanzo panel
from the add-on sidebar, pick a model, ask (or tap a quick action), and insert
the result into the document. In Drive, select files and summarize them, ask
about them, or draft a new Google Doc from them.

It reuses the **same backend as everything else Hanzo**: model calls go through
`api.hanzo.ai/v1` (OpenAI-compatible) via `UrlFetchApp`. No new API surface.

## Architecture

Google Workspace Add-ons run on **Apps Script** (server-side JS in Google's V8
runtime) with a **CardService** UI — not HTML/JS in a task pane. Apps Script has
no `fetch`/SSE, so every model call is **one non-streaming completion**
(`UrlFetchApp.fetch` → insert), which keeps the insert atomic.

```
src/
  appsscript.json   add-on manifest: scopes, urlFetchWhitelist, the OAuth2
                    library, per-host triggers
  auth.gs           Hanzo IAM sign-in: the OAuth2 service (code + PKCE), the
                    sign-in card, authCallback, sign-out
  hanzo.gs          API client — buildMessages / requestBody / extractContent /
                    parseModels (pure, tested) + ask / listModels (UrlFetchApp) +
                    the per-user model preference (PropertiesService)
  ui.gs             CardService UI + every entry point the manifest names:
                    homepage triggers, Gmail contextual/compose triggers,
                    settings + universal actions, button handlers
  docs.gs           Docs: read selection/body, insert/replace at cursor
  sheets.gs         Sheets: read range as TSV, write result down a column
  slides.gs         Slides: read selected text/shapes, insert
  drive.gs          Drive: read the selected files as text (Drive REST API),
                    create a Google Doc from a draft
  gmail.gs          Gmail: read the open message/thread, draft a reply
tests/              vitest over the pure logic (loads the .gs in a Node sandbox)
scripts/            validate-manifest.mjs — preflight before `clasp push`
```

The pure functions live **once** in the `.gs` files and end with a guarded
`module.exports` (inert in Apps Script — it has no `module` — but live under
Node), so the tests exercise the exact shipped code with zero duplication.

## Auth

Hanzo IAM, nothing else. The add-on is the public OAuth client
**`hanzo-gworkspace`**: authorization code + PKCE (S256) against
`https://hanzo.id/v1/iam/oauth/authorize`, tokens from
`https://api.hanzo.ai/v1/iam/oauth/token` (HIP-0111; the tests hold both equal
to `@hanzo/auth`). The flow is the
[OAuth2 for Apps Script](https://github.com/googleworkspace/apps-script-oauth2)
library, declared in `appsscript.json` (script ID
`1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`, version 43, the
first that runs PKCE with no client secret).

- No session: any card that needs the API throws
  `CardService.newAuthorizationException()` with the custom sign-in card
  (`onSignInCard`); its button opens hanzo.id and reloads the add-on on close.
- IAM redirects to the script's own callback,
  `https://script.google.com/macros/d/<SCRIPT_ID>/usercallback`, where
  `authCallback` exchanges the code. That URI is registered on
  `hanzo-gworkspace` in the IAM app graph (universe
  `charts/app/values/hanzo/iam-provision.yaml`).
- The token set lives in `PropertiesService.getUserProperties()` and is
  refreshed under the user lock, because IAM rotates refresh tokens and a
  replayed one revokes the session.
- A 401 from api.hanzo.ai drops the session and prompts again. **Hanzo
  account** (universal action) signs out.

## OAuth scopes (in `appsscript.json`)

| Scope | Why |
| --- | --- |
| `documents.currentonly` | read/insert in the open Doc |
| `spreadsheets.currentonly` | read range / write cell in the open Sheet |
| `presentations.currentonly` | read/insert in the open Slides deck |
| `drive.addons.metadata.readonly` | the Drive selection's id, title and MIME type |
| `drive.file` | the files the user allows from the card (one **Allow** per file), and the Docs the add-on creates |
| `gmail.addons.current.message.readonly` | read the open message/thread |
| `gmail.addons.current.message.metadata` | message metadata for the contextual trigger |
| `gmail.addons.current.action.compose` | open a draft reply |
| `gmail.addons.execute` | run the Gmail add-on |
| `script.external_request` | `UrlFetchApp` to `api.hanzo.ai` (the model gateway and the IAM token endpoint) |
| `script.locale` | user locale |

Drive holds **per-file** scopes only. `drive` and `drive.readonly` are
restricted scopes that force a paid CASA security assessment; `validate` and the
tests refuse any Drive scope beyond the two above. DriveApp needs the full
`drive` scope, so `drive.gs` reads (`files/<id>/export`, `?alt=media`) and
creates (`upload/drive/v3/files`, multipart, converted to a Doc) through the
Drive REST API with `ScriptApp.getOAuthToken()`.

`urlFetchWhitelist` is pinned to `https://api.hanzo.ai/` and the two Drive API
prefixes — the add-on can call **nothing else**.

## Develop & test

```bash
pnpm --filter @hanzo/gworkspace-addon test        # vitest over the pure logic
pnpm --filter @hanzo/gworkspace-addon validate     # manifest + .gs preflight
```

`validate` checks that `appsscript.json` is valid JSON with the required scopes,
the whitelist and the OAuth2 library; that every function the manifest names
(`runFunction`/`onTriggerFunction`) or the code names as a callback
(`setFunctionName`, `setCallbackFunction`, `setCustomUiCallback`, `actionFor_`)
is defined in a `.gs`; and that every `.gs` parses.

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

**Then register the Script ID with IAM.** The first `clasp create` is what mints
the Script ID, so the `hanzo-gworkspace` client is declared with a placeholder:
in universe `charts/app/values/hanzo/iam-provision.yaml`, replace `SCRIPT_ID` in
`https://script.google.com/macros/d/SCRIPT_ID/usercallback` with the real ID and
merge. The hourly converge registers it; read it back with
`curl -s 'https://hanzo.id/v1/iam/auth/application?clientId=hanzo-gworkspace' | jq .data.redirectUris`.
Until then hanzo.id refuses the redirect.

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
3. Open Drive / Docs / Sheets / Slides / Gmail — the **Hanzo AI** add-on appears in the
   right-hand add-on rail. Open it and **Sign in to Hanzo**.

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
