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

## Publish (AppSource — public listing)

`dist/manifest.xml` is a valid, submittable manifest (verified by
`office-addin-manifest validate`). To list publicly:

1. Host `dist/` at the production base (`office.hanzo.ai`) over HTTPS.
2. Register the `hanzo-office` client in IAM with redirect
   `https://office.hanzo.ai/auth-callback.html`.
3. Submit through **Microsoft Partner Center → Office Store** (needs a Partner
   Center account + Microsoft's validation pass).

## Not here yet

- **Outlook** (mail) is a different host category with its own manifest shape —
  a tracked follow-up, not this add-in.
- Streaming responses (this v1 is a single non-streaming completion, which keeps
  the insert atomic).
