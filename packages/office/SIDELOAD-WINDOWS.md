# Test Hanzo AI in Word/Excel on Windows

This is the `localhost` build of the Hanzo Office add-in — a self-contained kit
to try it on your own machine before it's on AppSource. No Hanzo infra, no IAM
setup: paste a Hanzo API key and go.

## What's in this zip

- `manifest.xml` — the add-in manifest (points at `https://localhost:3000`)
- `taskpane.html` / `taskpane.js` / `assets/` — the add-in itself
- `serve.mjs` — a tiny HTTPS server for the files above
- this guide

## Steps (5 minutes)

You need [Node.js](https://nodejs.org) installed.

1. **Trust a localhost HTTPS certificate** (once per machine — Office refuses an
   untrusted task-pane origin):

   ```powershell
   npx office-addin-dev-certs install
   ```

2. **Serve the add-in** from this folder:

   ```powershell
   node serve.mjs
   ```

   Leave it running. It serves `https://localhost:3000`.

3. **Sideload the add-in.** Easiest path — **Word or Excel on the web**
   (office.com): open a document → **Home → Add-ins → More Add-ins → My Add-ins
   → Upload My Add-in** → pick this folder's `manifest.xml`.

   Desktop Word/Excel on Windows: put this folder on a
   [network shared-folder catalog](https://learn.microsoft.com/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins),
   trust it in **File → Options → Trust Center → Trusted Add-in Catalogs**, then
   **Home → Add-ins → Shared Folder → Hanzo AI**.

4. **Use it.** Click **Hanzo AI** on the Home tab to open the pane. Expand
   **"Or use a Hanzo API key"**, paste your `sk-…` key (from
   console.hanzo.ai → API keys), **Save**. Select text or a range, type an
   instruction, **Ask Hanzo**, then **Insert**.

## Notes

- The API key is stored in your Office roaming settings (per-user, encrypted at
  rest by Office) — not in this folder.
- Sign-in with your Hanzo account (instead of an API key) works once the
  production add-in is hosted at `office.hanzo.ai`; the API key is the
  zero-setup path for local testing.
- Model calls go to `https://api.hanzo.ai/v1` — the same gateway the browser
  extension uses.
