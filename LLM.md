# Hanzo Extension

Browser extension (`packages/browser`) that joins the shared local **zapd** fabric.
One native primitive — no WebSocket, no localhost port, no mDNS, no CDP bridge.
Ships Chrome / Firefox / Safari. Build: esbuild (`src/build.js`, `pnpm build`);
tests: vitest.

## Architecture (native ZAP)

    extension ─connectNative("ai.hanzo.zap")─► native host ─UDS─► zapd ◄─ hanzo-mcp

- `shared/native-zap.ts` — the ONE transport: `connectNativeZap()` opens the native
  port (**singleton** — one port; the router does evict-and-replace), registers as
  provider `browser:<engine>/<host>/default`, dispatches inbound ROUTE commands.
  Cross-browser (`browser ∥ chrome`).
- `background.ts` (Chrome) — dispatch via `chrome.debugger` (CDP→tab; shows the
  "debugging this browser" banner; WebKit-incompatible). **To be removed** — see WXT plan.
- `background-firefox.ts` — native `browser.*` dispatch (no banner). The correct model.
- `browser-dispatch.ts` — `chrome.debugger` actuation (Chrome-only).
- `shared/evaluable.ts` — the ONE evaluate rule: `pickEvaluable` (code-param
  aliases) + `wrapEvaluable` (bare expression passes through; statement bodies
  → async IIFE with the trailing value auto-returned). Both dispatch paths
  consume it, so Chrome and Firefox accept identical caller JS.

Wire to zapd: the binary ZAP router envelope (`zap-proto/zapd/src/frame.rs`); the
browser↔host hop is native-messaging JSON, base64'd, quarantined in the host. Host +
per-browser manifests come from `zapd install-host` (`zap-proto/zapd`).

## Versioning
Patch only (X.Y.Z+1), never major. `package.json` is the source of truth; `build.js`
stamps it into every manifest (chrome/firefox/safari).

## CI/CD (native — Hanzo Git, KMS, act_runner)
Git of record is `git.hanzo.ai/hanzoai/extension`; GitHub is a mirror.
- `.gitea/workflows/*` — native pipeline on `hanzo-build-linux-amd64` act_runners:
  `ci.yml` (amd64 test + build), `publish.yml` (Chrome Web Store + Firefox AMO + npm).
- Secrets are **KMS only**. The pipeline logs in with the KMS machine identity
  (`KMS_CLIENT_ID`/`KMS_CLIENT_SECRET`) and pulls store creds from `hanzo:/extension-publish`
  (env `prod`). CR: `deploy/kms/extension-publish-kms-sync.yaml`. No store cred in
  any Actions secret store.
- `.github/workflows/` mirrors + degrades gracefully: `sync.yml` pushes main+tags to
  Hanzo Git; `ci.yml`/`cross-platform-e2e.yml` keep the macOS(Safari)/Windows/matrix
  lanes that still need GitHub-hosted runners; `publish.yml` keeps only the GitHub
  Release + the interim npm publish (store-publish removed → native). See PUBLISHING.md.

## Cross-platform — WXT migration (canonical plan, not yet executed)

One WebExtension codebase, every engine. **WXT** = build/SDK layer (build matrix,
manifest gen, targets, MV3, Vite/TS); `webextension-polyfill` / `@wxt-dev/browser` =
`browser.*` normalization. **Custom (keep):** `shared/native-zap.ts`, and the Safari
`SafariWebExtensionHandler.swift` → `~/.zap/run/zapd.sock` bridge. WXT builds Safari
but does NOT give WebKit `chrome.debugger` — so dispatch must become portable
`browser.*` (the Firefox model is already correct).

1. Adopt WXT build matrix (chrome/firefox/safari) — replaces `build.js`.
2. Collapse forks → one `background.ts`; delete `background-firefox.ts`; runtime
   `browser` adapter.
3. Collapse dispatch → delete `chrome.debugger` / `browser-dispatch.ts`; actuate over
   `tabs`/`scripting`/`webNavigation`/`browser.*` (portable, no banner, Safari-capable).
4. Transport stays per-platform: Chrome/Firefox `connectNative` → host → `zapd.sock`;
   Safari `SafariWebExtensionHandler.swift` → `zapd.sock`.
5. CI guards (last; go red until 1–4 land): fail if `chrome.debugger`, the `debugger`
   permission, or `background-firefox.ts` appears.

Large, multi-phase — do it as a focused pass, never half-merged.
