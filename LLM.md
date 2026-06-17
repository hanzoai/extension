# LLM.md - Hanzo Extension

## Overview
Hanzo AI Development Platform Monorepo. The browser extension lives in
`packages/browser` and ships to Chrome / Firefox / Safari.

## Tech Stack
- **Language**: TypeScript/JavaScript
- **Build**: esbuild via `packages/browser/src/build.js`
- **Tests**: vitest

## Build & Run
```bash
pnpm install && pnpm build
pnpm test
```

## Architecture (browser-extension 1.9.x — native ZAP)

The extension connects to the **one shared local `zapd` router** (see
`~/work/zap`) through exactly one browser-native primitive — there is **no**
WebSocket, no localhost port, no mDNS probing, no CDP bridge:

```
extension ─connectNative("ai.hanzo.zap")─► native host ─UDS─► zapd ◄─ hanzo-mcp
```

- **shared/native-zap.ts** — the ONE transport: `connectNativeZap()` opens the
  native-messaging port, registers as a provider (`browser:<chrome|firefox>/default`,
  the host stamps the device hostname), and dispatches inbound ROUTE commands.
  Cross-browser (`browser ∥ chrome`).
- **background.ts** (Chrome) — `connectNativeZap(..., cdpBridge.dispatchMethod)`.
  Dispatch still uses `chrome.debugger` (CDP-to-tab) → Chrome's "debugging this
  browser" banner. **TODO:** native `browser.*` dispatch for banner-light parity.
- **background-firefox.ts** — `connectNativeZap(..., hanzoExtension.dispatchMethod)`.
  Already native `browser.*` (no banner). Same transport as Chrome.
- **browser-dispatch.ts** (was `cdp-bridge.ts`) — `chrome.debugger` actuation
  (`dispatchMethod`). The legacy `cdp-bridge-server.ts` WS bridge is **deleted**.
- **shared/zap.ts** — legacy WebSocket ZAP wire; retained only for unrelated
  helpers (RAG/event broadcast no-op when disconnected). NOT the transport.

Native-host manifests: Chrome `…/Google/Chrome/NativeMessagingHosts/ai.hanzo.zap.json`
(`allowed_origins`), Firefox `…/Mozilla/NativeMessagingHosts/ai.hanzo.zap.json`
(`allowed_extensions: ["hanzo-ai@hanzo.ai"]`). Both `path` → `~/work/zap/host/zap_host.sh`.

The wire to zapd is the **binary ZAP router envelope** (`len|type|flags|from|to|payload`,
defined in `zap-proto/zapd/src/frame.rs`); the opaque command payload is a compact
binary codec. The browser↔host hop is native-messaging JSON (Chrome-forced), base64'd,
quarantined in the host.

## Versioning rule
Always bump **patch** (X.Y.Z → X.Y.Z+1). Never bump major — the ZAP
transport pivot ships as ordinary patches, not a 2.0. `package.json` and
both `manifest*.json` must agree.
