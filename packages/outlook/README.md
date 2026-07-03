# Hanzo AI for Microsoft Outlook

A **mail add-in** that puts Hanzo AI inside **Outlook** — desktop (Windows/Mac),
new Outlook, and Outlook on the web. Open a message, click the Hanzo button on
the ribbon, and:

- **Summarize thread** — parties, dates, defined terms, obligations, open questions.
- **Draft reply** — a professional reply in the sender's tone; open it in a reply
  window or insert it into the compose body.
- **Extract deadlines & action items** — every due date and task, with owner and date.
- **Explain plainly** — plain-language read-out plus the risks/obligations/deadlines.

This is the highest-value surface for a law office after Word: the inbox is where
deadlines and commitments actually arrive.

It reuses the **same backend as everything else Hanzo**: model calls go through
`api.hanzo.ai/v1` (OpenAI-compatible, streamed), sign-in is Hanzo IAM (`hanzo.id`,
authorization-code + PKCE, HIP-0111) — the mail add-in shares the `hanzo-office`
IAM client. No new API surface.

## What it reads / writes

- **Read mode** (a received message is open): reads the body (`item.body.getAsync`
  as plain text), subject, and `from` — the input to summarize / extract / draft.
  The write path is **Draft reply**, which opens a reply form
  (`item.displayReplyForm`) pre-filled with the AI text.
- **Compose mode** (a reply / new message is open): **Insert into message** writes
  the draft into the compose body — prepended above the quoted thread
  (`item.body.prependAsync`) or replacing the body (`item.body.setSelectedDataAsync`).

## Architecture (DRY with the Office task pane)

The pure, host-agnostic core is **identical** to `@hanzo/office-addin` and
unit-tested here:

- `config.ts` — the `api.hanzo.ai/v1` gateway endpoints + roaming-settings keys.
- `chat.ts` — `ask` / `askStream` (SSE) / `listModels` and the request/response shaping.
- `auth.ts` — the `@hanzo/auth` OAuth2+PKCE core wired to Office `roamingSettings`,
  plus the pasted `hk-` API-key path.

The only Outlook-specific module is **`outlook-host.ts`**: the mailbox glue
(`Office.context.mailbox.item`) and its pure shaping helpers — `stripHtml`,
`collapseWhitespace`, `shapeMessage`, `formatFrom`, `mailMode` — which are what
the tests cover. The Office.js calls themselves are thin.

## Build

```bash
pnpm --filter @hanzo/outlook-addin build      # production (base https://outlook.hanzo.ai)
pnpm --filter @hanzo/outlook-addin test        # vitest
pnpm --filter @hanzo/outlook-addin typecheck   # tsc --noEmit
```

The build stamps the **hosting base URL** into `dist/manifest.xml`. Outlook loads
the task pane from an HTTPS origin declared in the manifest; the same origin
serves `auth-callback.html` (the IAM redirect, registered on the `hanzo-office`
IAM client). Override the base for local dev:

```bash
HANZO_OUTLOOK_BASE=https://localhost:3000 pnpm --filter @hanzo/outlook-addin build
```

Then serve `dist/` over HTTPS at that base:

```bash
npx office-addin-dev-certs install   # trust a localhost cert (once)
cd packages/outlook/dist && node serve.mjs   # https://localhost:3000
```

## Sideload (no store needed)

A **mail add-in** installs differently from a Word/Excel task pane — you add it
through the mailbox, not "Insert → Add-ins".

- **Outlook on the web / new Outlook**: **Settings ⚙ → Mail → Customize actions**
  is *not* the path — use **Get Add-ins** (the "…" / Apps menu on an open message)
  **→ My add-ins → Custom Addins → Add a custom add-in → Add from file**, pick
  `dist/manifest.xml`. (`dist/` must be served at the base URL over HTTPS.)
- **Outlook desktop (Windows/Mac, classic)**: **Home → Get Add-ins → My add-ins →
  Custom add-ins → Add a custom add-in → Add from file** → `dist/manifest.xml`.
  Requires a Microsoft 365 / Exchange Online mailbox (sideloading a custom mail
  add-in from file needs the mailbox to allow it).
- Open any message: the **Hanzo AI** button appears on the message ribbon (read
  view); open a reply/compose and it appears there too.

### Whole firm (recommended for a law office)

An M365 admin deploys the add-in org-wide — every user gets the Hanzo button with
no per-person sideload:

**Microsoft 365 admin center → Settings → Integrated apps → Upload custom apps →
Provide link to manifest file** (host `manifest.xml` at the base URL) **or upload
the manifest**, choose the users/groups, and deploy. Centralized Deployment
covers Outlook desktop, web, and Mac.

## Publish (AppSource — public listing)

`dist/manifest.xml` is a valid, submittable Mail add-in manifest (validate with
`npx office-addin-manifest validate dist/manifest.xml`). To list publicly:

1. Host `dist/` at the production base (`outlook.hanzo.ai`) over HTTPS.
2. Ensure the `hanzo-office` IAM client allows the redirect
   `https://outlook.hanzo.ai/auth-callback.html`.
3. Submit through **Microsoft Partner Center → Office Store** (needs a Partner
   Center account + Microsoft's validation pass).

## Requirements

- Mailbox requirement set **1.5+** (declared in the manifest) — covers current
  Outlook desktop, Mac, and Outlook on the web / new Outlook.
- `Permissions: ReadWriteItem` — reads the open item and writes the reply draft;
  it never touches other items or makes EWS calls (so *not* ReadWriteMailbox).
