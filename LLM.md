# Hanzo Extension

Browser extension (`packages/browser`) that joins this computer's **ZAP router**
with nothing to pair or register: native messaging to `hanzo-zap-host` where the
browser allows a helper, else the router's loopback door on a well-known port.
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

The extension speaks MCP to one server, `dist/mcp-server.js`, over the child's
stdio (`src/mcp/server.ts`, the SDK's `StdioClientTransport`); `activate()`
returns that client as `{ mcp }`. The child runs on `process.execPath` with
`ELECTRON_RUN_AS_NODE=1`, VS Code's Electron as Node (Node itself under a remote
host), so it needs no Node on PATH. It gets `HANZO_WORKSPACE` and `HANZO_CONFIG`
(the `hanzo.*` settings as JSON), which the build's `vscode` stand-in reads, and
serves every enabled `MCPTools` tool under the tool's own JSON Schema.
`xvfb-run -a pnpm --filter hanzo-ide test:electron` runs the extension-host
suite. Every Hanzo API path is `/v1/…`: `/mcp/v1/proxy` and
`/platform/v1/<action>` 404, and the platform API is
`/v1/platform/projects/:project/apps/:app/…`.

dxt's `build` bundles mcp's `src/cli.ts` into `dist/server.js`, CommonJS with
every dependency inlined (a .dxt has no node_modules, and no package.json to
declare ESM), stamps package.json's version into `dist/manifest.json`, and zips
the manifest, server and icon into `dist/hanzo-ai.dxt`. mcp imports its own
modules statically: a dynamic `import()` of a bundled module makes esbuild wrap
it and all it reaches, zod included, in lazy init, and the SDK then read zod
before it ran — server.js died at load with `Class2 is not a constructor`.
`npx @anthropic-ai/mcpb validate manifest.json` checks the manifest against the
schema Claude Desktop installs by; a `user_config` value reaches the server only
through `${user_config.<key>}` in `mcp_config`, here as a CLI flag.

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
`auto` is not in it, so nothing defaults to it. Embeddings default to
`zen-embedding`; the list has no image or speech model, so those calls take
the id the caller names. No surface calls a provider's own API: VS Code goes
through `packages/vscode/src/api/chat.ts` (bearer: the IAM session, else
`HANZO_API_KEY` or `hanzo.llm.hanzo.apiKey`), hanzo-mcp through
`API_URL` with `HANZO_API_KEY`. Ollama and LM Studio stay: they are local.

## Office, Outlook and Workspace add-ins

- `packages/office` (Word/Excel/PowerPoint) and `packages/outlook` are served
  from the Sites plane, not a pod: `hanzo.yml` `sites:` publishes their `dist/`
  to `s3://hanzo-sites/hanzo/{office,outlook}` on every push to main, and
  universe `charts/app/values/hanzo/static-sites.yaml` routes
  `office.hanzo.ai` / `outlook.hanzo.ai` there. Each `build.js` stamps its
  host into `manifest.xml`; the manifest URL is the sideload/AppSource URL.
- Both sign in as IAM client `hanzo-office` (public, PKCE); its redirects
  (`https://{office,outlook}.hanzo.ai/auth-callback.html`) are declared in
  universe `charts/app/values/hanzo/iam-provision.yaml`, converged hourly.
- `packages/gworkspace` (Apps Script, Drive/Docs/Sheets/Slides/Gmail) signs in
  as `hanzo-gworkspace` through the OAuth2 for Apps Script library; its
  redirect is the script's `usercallback`, so the Script ID from the first
  `clasp create` must replace `SCRIPT_ID` in iam-provision.yaml. Drive uses
  `drive.file` + `drive.addons.metadata.readonly` only (validate refuses
  broader Drive scopes) and the Drive REST API, because DriveApp needs `drive`.
- Live IAM rows: `curl -s 'https://hanzo.id/v1/iam/auth/application?clientId=<id>' | jq .data.redirectUris`.

## Architecture (ZAP, no pairing)

    extension ─native messaging (ai.hanzo.zap)─► hanzo-zap-host ─UDS─► ZAP router ◄─UDS─ hanzo-mcp, dev, desktop, IDE
    extension ─WebSocket 127.0.0.1:9998 (snap/Flatpak)───────────────► ZAP router

The router is not a daemon: it is the `zapd` library embedded in every Hanzo
process that speaks ZAP, and an fcntl lock elects one per user (HIP-0069). When
that process exits another takes over and the extension reconnects.

- **Native first.** `hanzo-zap-host` (python-sdk `hanzo_tools.browser.native_host`)
  is Chrome native messaging host `ai.hanzo.zap`, allowed for this extension's
  id only; every hanzo-mcp start writes its manifest for Chrome, Chromium,
  Brave, Edge and Vivaldi. It relays envelopes (base64 in `{z}`) to the
  router's unix socket and stands for the router itself, so the browser alone
  is enough. No AUTH: Chrome's origin check and the socket's 0600 owner are
  the trust.
- **Door when a browser cannot exec a helper** (snap, Flatpak): the router's
  WebSocket on 9998 (ZAP over WebSocket; the services' native ZAP is 9999), else
  the first free port in 21000-21007 (zapd `pair::WELL_KNOWN`).
  Our Blink origin (`chrome-extension://biingenefmanpecedoafkfajbnlgdmbl`, fixed by
  the manifest `key`) is admitted without a proof (zapd ≥1.1.4) and says HELLO
  at once; the extension sweeps those ports, then backs off. Only
  random-origin browsers (Firefox, Safari) pair: `hanzo-mcp pair` prints
  `ws://127.0.0.1:<port>/#<64 hex>`, kept in `storage.local`, and the connect
  runs the mutual HMAC (router first). A browser node may answer calls but
  never call another node.
- `shared/socket.ts` — the ONE transport module: `Link` is a native port or a
  door socket, `ensureZap()` the ONE reconciler on the ONE clock (20 s
  heartbeat while registered — the `PROVIDERS_LIST` probe, which also keeps
  the MV3 worker alive — and 250 ms doubling to 30 s after a drop).
- **`connected` means "the router lists me"**, established by the probe — never
  merely "a socket is open". The tick re-sends HELLO when proven but unlisted,
  and replaces a socket whose probe or proof went unanswered for 5 s.
- `shared/zap.ts` — `startZap()`, used by both backgrounds: loads the pairing and
  this install's node name (`<engine>-<4 hex>`, minted once), answers
  `zap.status` / `zap.pair` / `zap.unpair`. `state.caps` is what the router's
  registry says this browser serves; the sidebar's tool count is its length.
- Safari runs the same code (the converter builds it from `dist/chrome`): WebKit
  opens `ws://127.0.0.1` from an extension's secure context, so there is no
  Swift bridge.
- `background.ts` (Chrome) — dispatch via `chrome.debugger` (CDP→tab; shows the
  "debugging this browser" banner; WebKit-incompatible). **To be removed** — see WXT plan.
- `background-firefox.ts` — native `browser.*` dispatch (no banner). The correct model.
- `browser-dispatch.ts` — `chrome.debugger` actuation (Chrome-only).
- `shared/evaluable.ts` — the ONE evaluate rule: `pickEvaluable` (code-param
  aliases) + `wrapEvaluable` (bare expression passes through; statement bodies
  → async IIFE with the trailing value auto-returned). Both dispatch paths
  consume it, so Chrome and Firefox accept identical caller JS.
- **Snapshot → ref: the one way an agent drives a page.** `hanzo.snapshot`
  prints the rendered accessibility tree with `[ref=eN]` on every actionable
  node; `hanzo.act {op, selector}` clicks/fills/types/presses/selects/checks by
  ref or CSS; `hanzo.read` is the page as markdown; `hanzo.wait`,
  `hanzo.navigate` (returns after load), `hanzo.annotate` (label N = @eN).
  Page half: `shared/snapshot.ts` + `shared/read.ts`, bundled as `page.js` and
  injected into the tab's ISOLATED world on first use; background half:
  `shared/drive.ts`, which both dispatchers call before their own switch — no
  CDP, identical on every engine. Refs live in the isolated world (a new
  document starts an empty table; numbering continues past the tab's last ref),
  a removed element's ref is refused, and a click hit-tests its point first and
  names the covering element. Extension pages reach it with runtime message
  `{action: 'drive'}` (web pages refused). The older `hanzo.click/fill/…`
  selector verbs are no longer called by hanzo-mcp; WXT step 3 deletes them.

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
`browser.*` normalization. **Custom (keep):** `shared/socket.ts` and `shared/zap.ts`,
the same on every engine. WXT builds Safari
but does NOT give WebKit `chrome.debugger` — so dispatch must become portable
`browser.*` (the Firefox model is already correct).

1. Adopt WXT build matrix (chrome/firefox/safari) — replaces `build.js`.
2. Collapse forks → one `background.ts`; delete `background-firefox.ts`; runtime
   `browser` adapter.
3. Collapse dispatch → delete `chrome.debugger` / `browser-dispatch.ts`; actuate over
   `tabs`/`scripting`/`webNavigation`/`browser.*` (portable, no banner, Safari-capable).
4. Transport is already one for every engine: `shared/socket.ts`.
5. CI guards (last; go red until 1–4 land): fail if `chrome.debugger`, the `debugger`
   permission, or `background-firefox.ts` appears.

Large, multi-phase — do it as a focused pass, never half-merged.
