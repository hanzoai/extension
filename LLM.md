# Hanzo Extension

Browser extension (`packages/browser`) that joins the shared local **zapd** fabric.
One native primitive — no WebSocket, no localhost port, no mDNS, no CDP bridge.
Ships Chrome / Firefox / Safari. Build: esbuild (`src/build.js`, `pnpm build`);
tests: vitest.

## Architecture (native ZAP)

    extension ─connectNative("ai.hanzo.zap")─► native host ─UDS─► zapd ◄─ hanzo-mcp

- `shared/native-zap.ts` — the ONE transport. `ensureNativeZap()` is the ONE entry
  point: drive it from the keep-alive alarm and it reconciles the extension's
  registration against the router (opens the native port — **singleton**, one port;
  the router does evict-and-replace — registers as provider
  `browser:<engine>/<host>/default`, dispatches inbound ROUTE commands).
  Cross-browser (`browser ∥ chrome`).
  **`connected` means "zapd lists me as a provider"**, established by a
  `PROVIDERS_LIST` probe — never merely "a port is open". A WELCOME is not proof:
  a native port stays open while its host is wedged, so a port can be open, deaf
  and unregistered indefinitely (the failure this replaced: zapd reporting 0
  providers for hours while a host process was up and the extension believed it was
  connected). The tick also re-sends HELLO on a healthy-but-unlisted port, and
  replaces a port whose probe went unanswered. Do NOT add a second reconnect path —
  two live hosts race for one provider id and the loser's close deregisters the
  winner. Covered by `tests/native-zap.test.ts`.
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
- **`.hanzo/workflows/*`** — the ONLY pipeline, on `hanzo-build-linux-amd64`
  act_runners: `ci.yml` (amd64 test + build), `publish.yml` (Chrome Web Store +
  Firefox AMO + npm). Renamed from `.gitea/workflows` in `cc622bc`. The forge
  reads this path natively and FIRST — `hanzoai/git modules/setting/actions.go`
  `WorkflowDirs: [".hanzo/workflows", ".gitea/workflows", ".github/workflows"]`
  (since `61ceddeb`, shipped in v1.26.26+).
- **`.github/workflows/` is EMPTY** — GitHub CI was deleted in `6977db0`. Nothing
  builds, publishes or syncs there. Do not "restore" it: GitHub is a mirror, and a
  second plane is exactly what the migration removed.
- Secrets are **KMS only**. The pipeline logs in with the KMS machine identity
  (`KMS_CLIENT_ID`/`KMS_CLIENT_SECRET`, Actions secrets on git.hanzo.ai) and pulls
  store creds from `hanzo:/extension-publish` (env `prod`). CR:
  `deploy/kms/extension-publish-kms-sync.yaml`. No store cred in any Actions
  secret store.

⚠️ **A tag is not a release — verify against the REGISTRY.** `v1.9.37` was tagged,
reached git.hanzo.ai, was picked up by a runner, finished in ~20s and shipped
NOTHING: the KMS machine identity was absent, so the secrets step warned and
`exit 0`'d, and every publish step gates on `env.<CRED> != ''` — so all of them
skipped. Green run, empty release, no error anywhere. That is now a hard failure,
plus a `Publish summary` step that fails the job when a tag published nowhere.
If a release does not appear: check `KMS_CLIENT_ID`/`KMS_CLIENT_SECRET` are seeded
as Actions secrets, then confirm with
`npm view @hanzo/browser-extension version` — never by looking at the tag.

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
