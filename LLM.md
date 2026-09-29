# Hanzo Extension

Browser extension (`packages/browser`) that joins the shared local **zapd** fabric.
One native primitive — no WebSocket, no localhost port, no mDNS, no CDP bridge.
Ships Chrome / Firefox / Safari. The rest of the workspace is the other Hanzo
surfaces (editors, office, chat, business apps); README.md indexes them.

`make build [target=chrome]` builds everything or one target into `dist/`:
browser writes `dist/{chrome,firefox,safari}` itself, every other package builds
in place and `dist/<name>` links to its output. `packages/jetbrains` is a Gradle
build outside the pnpm workspace: `make build` runs its `buildPlugin` too, and
`dist/jetbrains` links to its `build/distributions`. Gradle uses the JDK on
PATH, or fetches Temurin 21 into `.cache/jdk` when there is none (the runners
have none and cannot sudo). `make test` runs every package's suite and the
jetbrains Gradle tests, with Playwright's Chromium under `.cache/ms-playwright`.
pnpm 11 reads `allowBuilds` in `pnpm-workspace.yaml`, which lets only
`better-sqlite3` run install scripts. jupyter builds through
`uvx --from 'jupyterlab>=4.5,<4.6'`: 4.6 fetches core metadata from GitHub at
build time and fails when rate-limited.

vscode's `build` is `vsce package --no-dependencies`, writing
`dist/hanzo-ide.vsix`. Its `vscode:prepublish` typechecks and runs
`scripts/build.js`, which bundles `dist/extension.js` (`main`) and
`dist/mcp-server.js` (the stdio server the extension spawns) with every
dependency inlined: the .vsix carries no node_modules. Only `vscode` and native
optionals stay runtime requires, each behind a try/catch (the list and why are
in `scripts/build.js`). `__dirname` in extension code is `dist/`; find shipped
files through `context.extensionUri`. vsce reads `@types/vscode` from
package.json and cannot parse `catalog:`, so that one devDependency is pinned
to the `engines.vscode` floor, 1.90, where the chat participant API went stable.
vsce refuses a package.json `files` beside `.vscodeignore`; `.vscodeignore` is
an allowlist.

dxt's `server.js` is build output (mcp's `dist/cli.js`), not source.

IAM API is `api.hanzo.ai/v1/iam` (login UI `hanzo.id`). `iam.hanzo.ai` serves
only the IAM web app — a POST there answers HTML, never a token. Verb paths
(`get-users`, `update-user`, …) answer 410 naming the resource that replaced
them (`iam/pkg/gone/gone.go`): `/v1/iam/<kind>` to list and create,
`/v1/iam/<kind>/<owner>/<name>` to GET, PUT and DELETE one. A surface with no
web page of its own redirects to a loopback listener (RFC 8252): IAM accepts
`http://127.0.0.1:<any port>/callback` for `hanzo-jetbrains`, `hanzo-vscode`
and `hanzo-cli`, and refuses `localhost`. VS Code signs in one way,
`packages/vscode/src/auth/iam.ts` (code + PKCE, tokens in SecretStorage).

One default model on every surface: `zen5`, the id catalog.hanzo.ai marks
"Zen5 (Default)". A default or fallback id must be in `api.hanzo.ai/v1/models`.

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
- One gate, `make check`: every package built and tested, the browser bundle
  budget, and the extension e2e in Chromium. `cicd.yml` runs it through
  `hanzoai/ci/.github/workflows/build.yml@v1`, which reads `hanzo.yml`'s
  `test:`; `publish.yml` (push to main, manual dispatch) runs it before it
  ships, and ships that build.
- Both run natively on the `linux-amd64` runners. A runner has the docker CLI
  and no daemon, so a `container:` job dies before its first step; it cannot
  sudo, so nothing asks for `playwright install --with-deps` (its image carries
  chromium's libraries). jupyter's uvx needs uv: the reusable installs it for
  any repo with a `pyproject.toml`, and publish.yml installs it itself.
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
