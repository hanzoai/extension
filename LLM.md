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

## Surfaces — one chat shell, two mounts

Both React surfaces draw chat with **`@hanzo/ui/chat`** (Thread, Message,
Composer, Sources, Code, Step, Failure) and pick models with `@hanzo/ui/models`
`ModelSelector`. There is no local composer, no local model menu, no local
message list, no second markdown renderer. Select on the shell's `data-slot`
contract, never on class names.

- `src/newtab.ts` -> `answer/AnswerEngine.tsx` — the answer engine. Local parts
  are only what is true here: `answer/Toolbar.tsx` (modes + source pills, the
  composer's toolbar slot), Stories, WidgetView, and `answer/model-catalog.ts`,
  which reads the PUBLIC catalog host because `@hanzo/ui/models`' own
  `fetchModelCatalog` reads the authenticated `/models` and would 401 a
  signed-out query.
- `src/sidebar.ts` -> `src/Chat.tsx` — the sidebar's chat tab, mounted at the one
  node `#chat`. `sidebar.html` declares NO chat control; `sidebar.ts` keeps the
  entire wire (auth, retrieval, budgets, dedupe, the stream, persistence) and
  passes values and callbacks. Tools and Settings stay plain DOM.
- `src/shared/markdown.ts` + `shared/Prose.tsx` — the ONE markdown pipeline for
  both. `blocks()` splits prose from fenced code so code renders through the
  shell's `Code` (language label + copy) instead of a `<pre>` string.

**`answer/Rail.tsx` is deliberately NOT the shell's Sidebar.** `Sidebar` has no
collapsed presentation, and `SidebarIconButton` takes only a label, so it cannot
carry the `aria-expanded` that `tests/answer-rail.test.ts` asserts. A rail that
cannot announce its own state is worse than one that is not the shell's. Revisit
when the shell can express a collapsed rail.

Three shell shapes to know, all found by driving the built extension:

1. `ModelSelector`'s trigger is `width: "100%"`. Left free in a `Composer`
   toolbar row it takes the whole row and pushes the send control off the edge —
   box it (`PICKER` in both surfaces).
2. `Thread`'s horizontal padding is coupled to its reading-measure cap, so
   `maxWidth={0}` (fill, which a ~360px column needs) also removes the gutters.
   The surface supplies them.
3. The `Composer` toolbar row does not wrap for its children. Ten controls do
   not fit one row, so `Toolbar` wraps inside its own box.

Proof lives in `e2e/turn.spec.ts`: the built extension in Chrome, a seeded
identity and a scripted SSE body, driving type -> Enter -> stream -> anchoring.
A vitest render exercises none of the gui runtime, the MV3 policy or the worker.


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
