# @hanzo/desktop

The Hanzo AI desktop app — the **ambient omnipresence layer**. A cross-platform
(macOS / Windows / Linux) menubar/tray app with a global hotkey that pops a Hanzo
assistant over whatever app you are in. Ask, summarize the clipboard, rewrite,
explain, translate, and fix grammar — wired to the `api.hanzo.ai` gateway via the
published [`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai). Built on
[Tauri v2](https://tauri.app) (a Rust shell + a web frontend) — lighter and more
native than Electron.

It is the same assistant as the Office and PDF surfaces, reusing the same
action catalog and prompt/parse contracts, packaged as a standalone always-on-top
window you summon from anywhere.

## What it does

- **Global hotkey** — `Cmd/Ctrl+Shift+Space` shows/hides a small, always-on-top,
  spotlight-style window over the frontmost app. Press again to dismiss; it also
  hides when it loses focus.
- **Tray / menubar icon** — Open, the quick actions, Settings, and Quit. Left-click
  the icon to toggle the window; the menu is the secondary surface.
- **Quick actions over the clipboard** — Copy text in any app, summon Hanzo, and:
  - **Ask** — ask anything (answered from the clipboard if present, else general
    knowledge).
  - **Summarize clipboard** / **Explain** — the answer is streamed and copied to
    the clipboard.
  - **Rewrite** / **Translate** / **Fix grammar** — the result is streamed, then
    **pasted back** over the frontmost app (the corrected text lands where the
    original was).
- **Streaming** — every reply streams token-by-token into the panel.
- **Your key, your machine** — paste your `sk-` key from
  [hanzo.id](https://hanzo.id) into Settings. It is stored **only** in the app's
  local store (the webview's `localStorage`) and sent **only** to `api.hanzo.ai`
  as the bearer. No secret is bundled or committed.

## Architecture

A thin Rust shell + a pure web frontend. The AI logic is entirely in the frontend;
the Rust is the native container.

```
packages/desktop/
├── src/                      frontend (TypeScript, esbuild → dist/)
│   ├── config.ts             gateway endpoints, default model, sk- key guard, store key
│   ├── actions.ts            PURE: action catalog, prompt builders, clipboard-context
│   │                         assembly/truncation, message shaping, reply parsing
│   ├── hanzo.ts              THIN wrapper over @hanzo/ai (createAiClient): run / stream / list
│   ├── store.ts              local settings (sk- key + model): parse / merge / serialize
│   ├── clipboard.ts          Tauri I/O boundary: read clipboard, copy, paste-back
│   ├── app.ts                DOM controller (glue only — one run path for every action)
│   ├── index.html            the panel markup
│   └── styles.css            the panel styling
├── src-tauri/                Rust shell
│   ├── src/main.rs           one-line binary entrypoint
│   ├── src/lib.rs            tray + global hotkey + window toggle + hide_window/paste commands
│   ├── Cargo.toml            tauri 2.11, clipboard-manager + global-shortcut 2.3, enigo 0.6
│   ├── tauri.conf.json       window (small, always-on-top, hidden-on-blur), tray, CSP, bundle
│   ├── capabilities/default.json   plugin + core permissions for the main window
│   ├── entitlements.plist    macOS hardened-runtime entitlements (network client)
│   └── icons/                generated icon set (png / ico / icns)
├── build.js                  esbuild the frontend → dist/ (Tauri's frontendDist)
├── test/                     vitest — the pure frontend logic
├── package.json  tsconfig.json  vitest.config.ts
```

**Separation of concerns:** `actions.ts` and `store.ts` are pure (no Tauri, no SDK,
no DOM) and fully unit-tested. `hanzo.ts` is the only module that calls `@hanzo/ai`.
`clipboard.ts` is the only frontend module that imports Tauri. `app.ts` is glue.
The tray quick actions and the hotkey both emit frontend events, so `app.ts`'s
single run path serves every surface — DRY across native and web.

## Develop

Requires Node ≥ 18 + [pnpm](https://pnpm.io), and — for the native shell only — the
[Rust toolchain](https://tauri.app/start/prerequisites/) and your platform's WebView
dependencies (WebView2 on Windows, WebKitGTK on Linux; built in on macOS).

```bash
pnpm install

# Frontend only — bundle src/ → dist/ (no Rust toolchain needed):
pnpm --filter @hanzo/desktop build          # one-shot
pnpm --filter @hanzo/desktop watch          # rebuild on change

# Type-check the frontend + run the unit tests:
pnpm --filter @hanzo/desktop typecheck
pnpm --filter @hanzo/desktop test

# Full app in dev (needs the Rust toolchain) — builds the frontend, launches the
# native shell with the tray + global hotkey, hot-reloads the frontend:
pnpm --filter @hanzo/desktop tauri:dev
```

`tauri:dev` runs `node build.js --watch` as its `beforeDevCommand` and serves
`dist/`; edit `src/*.ts` and the panel reloads.

## Build installers (CI only)

Building the native installers needs the Rust toolchain and, for a distributable
build, code-signing — so it is a **CI job, never run on a developer machine**.

```bash
# CI, per-OS runner:
pnpm --filter @hanzo/desktop tauri:build
```

`tauri build` runs `node build.js` (frontend) then compiles the Rust shell and
bundles the installers configured in `tauri.conf.json → bundle.targets`:

| OS      | Runner        | Artifact(s)                                                    |
| ------- | ------------- | -------------------------------------------------------------- |
| macOS   | `macos-*`     | `src-tauri/target/release/bundle/dmg/Hanzo_0.1.0_*.dmg` (+ `.app`) |
| Windows | `windows-*`   | `src-tauri/target/release/bundle/{msi,nsis}/Hanzo_0.1.0_*.{msi,exe}` |
| Linux   | `ubuntu-*`    | `src-tauri/target/release/bundle/{appimage,deb}/hanzo_0.1.0_*.{AppImage,deb}` |

Each OS bundle is produced on its own runner (Tauri does not cross-compile the
native shell). Only the frontend (`node build.js`) is verified locally.

### Code signing & notarization (future)

Distributable builds must be signed so the OS does not warn/block them:

- **macOS** — sign with a Developer ID Application certificate and **notarize**
  with Apple (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID` in CI). `src-tauri/entitlements.plist` declares the
  hardened-runtime entitlements (network client). The synthetic **paste** keystroke
  requires the user to grant **Accessibility** to the app at first use (System
  Settings → Privacy & Security → Accessibility) — not an entitlement.
- **Windows** — Authenticode-sign the `.msi`/`.exe` with an EV/OV certificate.
- **Linux** — the `.AppImage` / `.deb` are unsigned; publish checksums.

All signing secrets live in **KMS** and are injected by CI — never in this repo.

## The flow

```
copy text in any app
   │
   ▼  Cmd/Ctrl+Shift+Space  (global hotkey)  ─── or ───  click the tray icon / menu
   │
Rust shell: toggle_window() → show + focus, emit "focus-prompt"
   │                                     tray quick action → emit "run-action" <id>
   ▼
frontend app.ts (one run path):
   gate on sk- key → captureSubject() reads the clipboard (Tauri plugin)
   → buildActionMessages(id, inputs, ctx)  [pure]
   → streamChat(...) over @hanzo/ai → api.hanzo.ai /v1/chat/completions
   → parseResult(reply)  [pure]
   → copy (ask/summarize/explain)   OR   paste-back (rewrite/translate/fix):
        writeText(result) → invoke("paste") → Rust hides the window and
        synthesizes Cmd/Ctrl+V into the now-frontmost app (enigo)
```

## Notes

- All model traffic goes to `api.hanzo.ai` over `/v1/...` (never an `/api/` prefix)
  through `@hanzo/ai` — the transport is never reimplemented here.
- The window CSP allows connecting only to `https://api.hanzo.ai`.
- The `sk-` key is validated (`isHanzoKey`) before it is ever used as a bearer, so
  a wrong paste (an IAM JWT, a half-copied key) is rejected in the UI.

## License

MIT
