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

## Architecture (since browser-extension 2.0.0)

Two-process: each Python `hanzo-mcp` hosts a ZAP server directly. The
extension discovers it on the lowest free port from
`[9999, 9998, 9997, 9996, 9995]` and dispatches commands over a binary
WebSocket frame:

```
[0x5A 0x41 0x50 0x01][type:1][length:4 BE][JSON payload]
```

- **shared/zap.ts** — canonical wire constants (MSG_REQUEST=0x10,
  MSG_RESPONSE=0x11, MSG_PING=0xFE, MSG_PONG=0xFF). Both Chrome and
  Firefox extensions use this. Includes `setZapRequestHandler(mgr, fn)`
  so the Python server can dispatch RPCs back to the extension.
- **background.ts** (Chrome) — wires `cdpBridge.dispatchMethod` as the
  ZAP inbound handler.
- **background-firefox.ts** — wires `HanzoFirefoxExtension.dispatchMethod`
  as the ZAP inbound handler.
- **cdp-bridge-server.ts** — DEPRECATED. Legacy node bridge on
  `:9223/9224`. Fallback only; not in the critical path.

Wire constants must stay locked across implementations:
- `python-sdk/pkg/hanzo-tools-browser/hanzo_tools/browser/zap_server.py`
- `extension/packages/browser/src/shared/zap.ts`
- `extension/packages/mcp/src/zap-server.ts`

If you change them, change all three and update `tests/shared-zap.test.ts`
+ `tests/test_zap_server.py::TestWireFormat::test_constants_match_extension`.

## Versioning rule
Bump patch (X.Y.Z+1) for protocol-compatible changes. Bump major (e.g.
1.x → 2.0) only when the wire format changes or the architecture pivots
(2.0.0 = ZAP becomes canonical, dropping the node bridge from default
boot). `package.json` and both `manifest*.json` must agree.
