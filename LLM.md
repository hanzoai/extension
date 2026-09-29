# Hanzo Extension

Browser extension (`packages/browser`) that joins the shared local **zapd** fabric.
One native primitive — no WebSocket, no localhost port, no mDNS, no CDP bridge.
Ships Chrome / Firefox / Safari. The rest of the workspace is the other Hanzo
surfaces (editors, office, chat, business apps); README.md indexes them.

`make build [target=chrome]` builds everything or one target into `dist/`:
browser writes `dist/{chrome,firefox,safari}` itself, every other package builds
in place and `dist/<name>` links to its output. `make test` runs every vitest
suite. pnpm 11 reads `allowBuilds` in `pnpm-workspace.yaml`, which lets only
`better-sqlite3` run install scripts. jupyter builds through
`uvx --from 'jupyterlab>=4.5,<4.6'`: 4.6 fetches core metadata from GitHub at
build time and fails when rate-limited.

IAM API is `api.hanzo.ai/v1/iam` (login UI `hanzo.id`). `iam.hanzo.ai` serves
only the IAM web app — a POST there answers HTML, never a token.

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
- The same `PROVIDERS` reply carries our entry's caps, so `decodeProviders` keeps
  the whole entry and `state.caps` is what the router says this browser serves.
  `shared/zap.ts` answers `zap.status` from that state — registration, provider id,
  caps — and the sidebar's tool count is that list's length. There is no MCP-tool
  manifest to report: the extension is a provider on zapd, not a consumer of one.
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

## CI/CD
- Workflows live in `.github/workflows/`, moved there from `.hanzo/workflows/` in
  `7bfd1e1`: `ci.yml` (push and pull request) and `publish.yml` (push and manual
  dispatch) run on the `linux-amd64` runners; `cicd.yml` calls
  `hanzoai/ci/.github/workflows/build.yml@v1`.
- Secrets are **KMS only**. The pipeline logs in with the KMS machine identity
  (`KMS_CLIENT_ID`/`KMS_CLIENT_SECRET`, org-level Actions secrets on
  git.hanzo.ai, inherited by every `hanzoai` repo) and reads each credential at
  run time. No store cred in any Actions secret store.

**The KMS read contract.** Cloud's embedded KMS serves the FLAT form and answers
`{name, env, value}`:

    GET https://kms.hanzo.ai/v1/kms/secrets/[<path>/]<KEY>?env=prod   -> .value

The org is not a path segment — the read is scoped by the token's owner claim.
The older `/v1/kms/orgs/<org>/secrets/<path>/<KEY>` form with `.secret.value`
404s, and because a 404 body is not a value, every key it reads comes back
empty. `@hanzo/ui` and `@hanzo/logo` read the flat form too; it is the one way.

Where each credential lives:
- `NPM_TOKEN` — org `hanzo`, env `prod`, **root path** (`KMS_NPM_PATH` empty).
- Chrome Web Store + Firefox AMO — `hanzo:/extension-publish`, env `prod`
  (`KMS_STORE_PATH`). CR: `deploy/kms/extension-publish-kms-sync.yaml`.
  **Not seeded yet**, so those two steps skip and `Publish summary` says so.

⚠️ **A tag is not a release — verify against the REGISTRY.** Every publish step
gates on `env.<CRED> != ''`, so a credential that reads back empty skips its
step rather than failing it. Two steps exist to stop that reading as success:
`npm serves what the tree declares` asks the registry for the version the tree
declares, and `Publish summary` names every target that shipped and fails the
job if none did. If a release does not appear, confirm with
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
