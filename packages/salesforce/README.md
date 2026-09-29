# Hanzo AI for Salesforce

An SFDX package that puts **Hanzo AI inside Salesforce** — a Lightning Web
Component assistant that drops onto **Account, Opportunity, Case, Lead, and
Contact** record pages. Summarize the record, draft a follow-up, extract next
steps, or ask anything — then write the result back as a **Task**, a **Note**, or
a **Chatter post**.

It uses the **same backend as everything else Hanzo**: model calls go through
`api.hanzo.ai/v1` (OpenAI-compatible) — the same gateway and wire format as the
[browser extension](../browser), the [Office add-in](../office), the
[Google Workspace add-on](../gworkspace), and the [Slack app](../slack). No new
API surface, one contract everywhere.

## Architecture

Salesforce runs on **Apex** (server-side) with **Lightning Web Components** (the
client). Apex has no `fetch`/SSE, so every model call is **one non-streaming
completion** (`Http.send` → render), which keeps the round-trip atomic — the same
one-shot model as the Apps Script and Office integrations.

```
force-app/main/default/
  classes/
    HanzoClient.cls          API client — chatCompletionsUrl / buildMessages /
                             requestBody / extractContent / parseModels (pure,
                             tested) + ask / listModels (Http via Named Credential)
    HanzoContext.cls         SOQL context assembly per object (Account, Opportunity,
                             Case, Lead, Contact) + related lists + truncate
    HanzoController.cls       @AuraEnabled: complete / listModels / writeBack
    HanzoCalloutMock.cls      HttpCalloutMock for the api.hanzo.ai gateway (tests)
    HanzoClientTest.cls       wire contract + callout shape (>75% of HanzoClient)
    HanzoControllerTest.cls   complete/listModels/writeBack over real records
  lwc/hanzoAssistant/         the panel: model picker + quick actions + output +
                             prompt + write-back buttons
  namedCredentials/Hanzo_API      → https://api.hanzo.ai, injects the Bearer header
  externalCredentials/Hanzo_API   → holds the API-key principal (key entered post-deploy)
  permissionsets/Hanzo_AI_User    → Apex + External Credential principal access
  connectedApps/Hanzo_AI          → OAuth for programmatic access to this org
  customMetadata/ + objects/Hanzo_Config__mdt → non-secret default model config
config/project-scratch-def.json   scratch-org shape
src/context.js + tests/           the truncate helper mirrored for vitest
scripts/validate-source.mjs       structural preflight (no org needed)
```

The pure functions live **once** in `HanzoClient` and are the tested core, so the
wire format is asserted the same way as every other Hanzo integration.

## Security model — where the key lives

The Hanzo API key is **never** in Apex, metadata, or git. It lives in the
**External Credential** `Hanzo_API` as an authentication parameter, and the
**Named Credential** injects it as `Authorization: Bearer …` at callout time via
the merge field `{!$Credential.Hanzo_API.ApiKey}`. Apex only ever references
`callout:Hanzo_API` — it never sees the token. A user can call the assistant
because their permission set grants **External Credential principal access**, not
because they hold the key.

Non-secret configuration (the default model id) lives in the
`Hanzo_Config__mdt.Default` custom-metadata record.

All record reads use `WITH SECURITY_ENFORCED` and all write-backs run `as user`,
so the assistant honors the running user's field-level security and CRUD — it can
never surface or write data the user couldn't themselves.

## Prerequisites

- The [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)
  (`sf`) on your PATH.
- A Salesforce org (a scratch org, a Developer Edition, or a sandbox) with
  **My Domain** enabled (required for Named Credentials and LWC).
- A **Hanzo API key** (`sk-…`) for your org — mint one at
  [hanzo.ai](https://hanzo.ai) / your Hanzo IAM console.

## Deploy

### 1. Deploy the source

```bash
# authorize a target org (once)
sf org login web --alias hanzo-sf

# validate + run tests before deploying (recommended)
npm run deploy:validate        # sf project deploy validate … RunLocalTests

# deploy
npm run deploy                 # sf project deploy start --source-dir force-app
```

For a fresh scratch org end-to-end:

```bash
npm run org:create             # create + set default scratch org
npm run org:push               # deploy the source
npm run org:open               # open it
```

### 2. Enter the Hanzo API key (once, per org — the only manual step)

The deploy creates the Named + External Credential but **not** the key (secrets
never ship in source). Add it once:

1. **Setup → Security → Named Credentials → External Credentials** tab → **Hanzo
   API**.
2. Under **Principals**, click **New** (or edit `HanzoApiPrincipal`):
   - Parameter Name: `HanzoApiPrincipal`
   - Sequence Number: `1`
   - Under **Authentication Parameters**, add one named **`ApiKey`** with your
     `sk-…` key as the value.
3. Save.

The Named Credential's header `Bearer {!$Credential.Hanzo_API.ApiKey}` now
resolves to your key on every callout.

### 3. Grant access

Assign the **Hanzo AI User** permission set to the reps who should use the
assistant (it grants the Apex + the External Credential principal access):

```bash
sf org assign permset --name Hanzo_AI_User
```

### 4. Add the LWC to a record page

1. Open an **Account** (or Opportunity/Case/Lead/Contact) record.
2. **Setup (gear) → Edit Page** (Lightning App Builder).
3. Drag **Hanzo AI Assistant** from the Custom components list onto the page.
4. **Save** → **Activate** (org default, app default, or by profile).

Repeat, or assign the same activation, for each object you want the panel on.

## Using it

- **Pick a model** in the panel header (loaded from `/v1/models`; falls back to
  the configured default, `zen5`).
- **Quick actions**: Summarize · Draft email · Next steps · Risks.
- **Ask**: type a question about the record and hit **Ask**.
- **Write back** the output: **Save as Task**, **Save as Note**, or **Post to
  Chatter** — created on the current record, in your user context.

## Tests

Apex tests are the primary suite — they use `HttpCalloutMock` (no live network)
and assert the request shape (URL `/v1/chat/completions`, POST, body
`model` + `messages[]` + `stream:false`), response parsing, and that each
write-back creates the right record.

```bash
npm run apex:test              # sf apex run test … --code-coverage (needs an org)
```

A small **vitest** suite covers the pure JS `truncate` helper that mirrors the
Apex context-truncation logic:

```bash
npm test                       # vitest run  (Node only, no org)
```

A structural preflight runs with **no org at all** — it checks Apex meta/brace
balance, that every LWC `@salesforce/apex` import resolves to an `@AuraEnabled`
method, endpoint discipline (`/v1` only, no `/api/`, no `v2`), and that no key or
Bearer token is committed:

```bash
npm run validate               # node scripts/validate-source.mjs
```

## Connected App / OAuth

The bundled **Hanzo AI** Connected App governs OAuth for programmatic access to
this org (an external orchestrator calling in, or the org calling out under a
named user). It is admin-approved and pre-authorized for the **Hanzo AI User**
permission set. After deploy, retrieve its Consumer Key/Secret from **Setup →
App Manager → Hanzo AI → View**. The **model callout itself does not use this
app** — it uses the `Hanzo_API` Named Credential.

## AppExchange packaging

To ship this as a managed package (2GP) for AppExchange:

```bash
# create the package (once), then version it
sf package create --name "Hanzo AI for Salesforce" --package-type Managed --path force-app
sf package version create --package "Hanzo AI for Salesforce" \
  --installation-key-bypass --code-coverage --wait 30
sf package version promote --package "Hanzo AI for Salesforce@0.1.0-1"
```

The install link produced by `version create` installs the LWC, Apex, Named/
External Credential, permission set, and the config metadata into a subscriber
org; the subscriber then does step 2 (enter their own `sk-…` key) and step 4 (add
the LWC to their page layouts). Managed-package Apex requires **≥75% coverage** —
`HanzoClientTest` + `HanzoControllerTest` cover the callout, parsing, context
assembly, and all three write-backs.
