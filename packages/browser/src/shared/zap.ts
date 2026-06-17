/**
 * ZAP (Zero-latency Agent Protocol) — shared across all browser targets.
 *
 * Binary format: [0x5A 0x41 0x50 0x01][type:1][length:4 BE][JSON payload]
 */

import type { ZapState } from './types.js';

// ── Protocol Constants ──────────────────────────────────────────────────
export const ZAP_MAGIC = new Uint8Array([0x5A, 0x41, 0x50, 0x01]);
export const MSG_HANDSHAKE    = 0x01;
export const MSG_HANDSHAKE_OK = 0x02;
export const MSG_REQUEST      = 0x10;
export const MSG_RESPONSE     = 0x11;
export const MSG_PING         = 0xFE;
export const MSG_PONG         = 0xFF;

/**
 * Canonical Hanzo service-type per HIP-0069. Discovery is mDNS-only —
 * the legacy [9999..9995] port-probe was removed in 1.9.13 to surface
 * non-compliant deployments instead of papering over them.
 */
export const HANZO_SERVICE_TYPE = '_hanzo._tcp.local.';
export const ZAP_RECONNECT_DELAY = 3000;
export const ZAP_DISCOVERY_TIMEOUT = 2000;


// ── Encode / Decode ─────────────────────────────────────────────────────

export function encodeZapMessage(type: number, payload: object): ArrayBuffer {
  const json = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);
  const buf = new ArrayBuffer(4 + 1 + 4 + data.length);
  const view = new DataView(buf);
  new Uint8Array(buf, 0, 4).set(ZAP_MAGIC);
  view.setUint8(4, type);
  view.setUint32(5, data.length, false);
  new Uint8Array(buf, 9).set(data);
  return buf;
}

export function decodeZapMessage(buf: ArrayBuffer): { type: number; payload: any } | null {
  if (buf.byteLength < 9) return null;
  const magic = new Uint8Array(buf, 0, 4);
  if (magic[0] !== 0x5A || magic[1] !== 0x41 || magic[2] !== 0x50 || magic[3] !== 0x01) {
    return null;
  }
  const view = new DataView(buf);
  const type = view.getUint8(4);
  const length = view.getUint32(5, false);
  const decoder = new TextDecoder();
  const json = decoder.decode(new Uint8Array(buf, 9, length));
  return { type, payload: JSON.parse(json) };
}

// ── Connection Management ───────────────────────────────────────────────

/**
 * Handler invoked when a ZAP server pushes a request TO the extension.
 * Returns a result (or throws) and the framework converts that into a
 * MSG_RESPONSE frame back to the server.
 *
 * Keeping this at the manager level means the extension's existing
 * request-dispatchers (handleExtensionRequest, executeMethod) can be
 * mounted once and serve every connected MCP without duplication.
 */
export type ZapRequestHandler = (method: string, params: any) => Promise<any> | any;

export interface ZapManager {
  state: ZapState;
  connections: Map<string, WebSocket>;
  pendingRequests: Map<string, { resolve: Function; reject: Function }>;
  requestIdCounter: number;
  /** Optional inbound request handler (set via setZapRequestHandler). */
  requestHandler?: ZapRequestHandler;
}

export function createZapManager(): ZapManager {
  return {
    state: {
      connected: false,
      mcps: [],
      extensionId: `hanzo-ext-${Date.now().toString(36)}`,
    },
    connections: new Map(),
    pendingRequests: new Map(),
    requestIdCounter: 0,
  };
}

/** Install (or replace) the inbound request handler. */
export function setZapRequestHandler(mgr: ZapManager, handler: ZapRequestHandler | undefined): void {
  mgr.requestHandler = handler;
}

/** Connect to a ZAP server and set up message handling */
export async function connectZap(
  url: string,
  mgr: ZapManager,
  browserName: string,
  version: string,
  log: (msg: string) => void = console.log,
): Promise<string | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    const connTimer = setTimeout(() => { ws.close(); resolve(null); }, 10000);

    ws.onopen = () => {
      ws.send(encodeZapMessage(MSG_HANDSHAKE, {
        clientId: mgr.state.extensionId,
        clientType: 'browser_extension',
        browser: browserName,
        version,
        capabilities: ['tabs', 'navigate', 'screenshot', 'evaluate', 'cookies', 'storage'],
      }));
    };

    ws.onmessage = (ev) => {
      let msg: { type: number; payload: any } | null = null;
      if (ev.data instanceof ArrayBuffer) {
        msg = decodeZapMessage(ev.data);
      }
      if (!msg) return;

      switch (msg.type) {
        case MSG_HANDSHAKE_OK: {
          clearTimeout(connTimer);
          const info = msg.payload;
          const mcpId = info.serverId || `mcp-${Date.now().toString(36)}`;
          mgr.connections.set(mcpId, ws);
          mgr.state.connected = true;
          mgr.state.mcps.push({
            id: mcpId,
            name: info.name || `MCP@${url}`,
            url,
            tools: (info.tools || []).map((t: any) => t.name),
          });
          log(`[Hanzo/ZAP] Connected to ${info.name || url} (${(info.tools || []).length} tools)`);
          // No application-level heartbeat: ZAP is a long-lived WS and the
          // OS already delivers FIN/RST on real disconnects, which fires
          // ws.onclose → our reconnect chain (added 1.9.7). The 1.9.9
          // PING/PONG was both unnecessary and buggy (it stacked
          // ws.onmessage wrappers on every tick).
          resolve(mcpId);
          break;
        }
        case MSG_RESPONSE: {
          const { id, result, error } = msg.payload;
          const pending = mgr.pendingRequests.get(id);
          if (pending) {
            mgr.pendingRequests.delete(id);
            if (error) pending.reject(new Error(error.message || error));
            else pending.resolve(result);
          }
          break;
        }
        case MSG_REQUEST: {
          // Server-initiated RPC: a Python hanzo-mcp is asking the
          // extension to perform a browser action. Dispatch via the
          // installed handler and reply with MSG_RESPONSE.
          const { id: reqId, method: reqMethod, params: reqParams } = msg.payload || {};
          const respond = (payload: object) => {
            try {
              ws.send(encodeZapMessage(MSG_RESPONSE, payload));
            } catch (e) {
              // ws.send throws if the socket is closing; nothing we can do.
            }
          };
          const handler = mgr.requestHandler;
          if (!handler) {
            respond({ id: reqId, error: { code: -32601, message: `No request handler installed (method: ${reqMethod})` } });
            break;
          }
          Promise.resolve()
            .then(() => handler(reqMethod, reqParams || {}))
            .then((result) => respond({ id: reqId, result: result === undefined ? null : result }))
            .catch((e: any) => respond({ id: reqId, error: { code: -1, message: e?.message || String(e) } }));
          break;
        }
        case MSG_PING:
          ws.send(encodeZapMessage(MSG_PONG, {}));
          break;
      }
    };

    let scheduledRetry = false;
    const scheduleRetry = (reason: string) => {
      if (scheduledRetry) return;
      scheduledRetry = true;
      log(`[Hanzo/ZAP] ${reason} — reconnecting to ${url} in ${ZAP_RECONNECT_DELAY}ms...`);
      setTimeout(() => connectZap(url, mgr, browserName, version, log), ZAP_RECONNECT_DELAY);
    };

    ws.onclose = () => {
      for (const [id, conn] of mgr.connections) {
        if (conn === ws) {
          mgr.connections.delete(id);
          mgr.state.mcps = mgr.state.mcps.filter(m => m.id !== id);
          break;
        }
      }
      mgr.state.connected = mgr.connections.size > 0;
      scheduleRetry('Disconnected');
    };

    ws.onerror = () => {
      clearTimeout(connTimer);
      // onerror fires when the bind window misses, the server is restarting,
      // or the connection is reset mid-handshake. Without scheduling a retry
      // here the entire reconnect chain dies after a single failed attempt
      // (1.9.6 and earlier) — fixed in 1.9.7 by chaining a retry the same
      // way onclose does.
      scheduleRetry('Connect error');
      resolve(null);
    };
  });
}

/** Send a ZAP RPC request to an MCP server */
export function zapRequest(mgr: ZapManager, mcpId: string, method: string, params: any = {}): Promise<any> {
  const ws = mgr.connections.get(mcpId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`MCP ${mcpId} not connected`));
  }

  const id = `req-${++mgr.requestIdCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mgr.pendingRequests.delete(id);
      reject(new Error(`ZAP request timeout: ${method}`));
    }, 30000);

    mgr.pendingRequests.set(id, {
      resolve: (r: any) => { clearTimeout(timer); resolve(r); },
      reject:  (e: any) => { clearTimeout(timer); reject(e); },
    });

    ws.send(encodeZapMessage(MSG_REQUEST, { id, method, params }));
  });
}

/** Call a tool via ZAP on the first MCP that has it */
export async function zapCallTool(
  mgr: ZapManager,
  name: string,
  args: Record<string, unknown> = {},
  targetMcpId?: string,
): Promise<any> {
  if (targetMcpId) {
    return zapRequest(mgr, targetMcpId, 'tools/call', { name, arguments: args });
  }
  for (const mcp of mgr.state.mcps) {
    if (mcp.tools.includes(name)) {
      return zapRequest(mgr, mcp.id, 'tools/call', { name, arguments: args });
    }
  }
  throw new Error(`Tool not found on any ZAP-connected MCP: ${name}`);
}

export function hasZapTool(mgr: ZapManager, name: string): boolean {
  return mgr.state.mcps.some((mcp) => mcp.tools.includes(name));
}

// ── MCP Protocol Convenience Methods ──────────────────────────────────
// Full MCP parity: resources/*, prompts/* work over ZAP just like tools/*

/** List available resources from an MCP server */
export function zapListResources(mgr: ZapManager, mcpId: string): Promise<any> {
  return zapRequest(mgr, mcpId, 'resources/list');
}

/** Read a specific resource by URI */
export function zapReadResource(mgr: ZapManager, mcpId: string, uri: string): Promise<any> {
  return zapRequest(mgr, mcpId, 'resources/read', { uri });
}

/** List available prompts from an MCP server */
export function zapListPrompts(mgr: ZapManager, mcpId: string): Promise<any> {
  return zapRequest(mgr, mcpId, 'prompts/list');
}

/** Get a specific prompt with optional arguments */
export function zapGetPrompt(mgr: ZapManager, mcpId: string, name: string, args?: Record<string, string>): Promise<any> {
  return zapRequest(mgr, mcpId, 'prompts/get', { name, arguments: args });
}

/**
 * Ask the native messaging helper (ai.hanzo.zap_mdns) for a live mDNS browse
 * of `_hanzo._tcp.local.` services per HIP-0069. Returns ws:// URLs the
 * extension can connect to. Returns [] when the helper isn't installed or
 * the browse times out empty.
 */
async function discoverViaMdns(timeoutMs: number = 1500): Promise<string[]> {
  const api: any = (typeof browser !== 'undefined' ? browser : (chrome as any));
  const send = api?.runtime?.sendNativeMessage;
  if (typeof send !== 'function') {
    throw new Error(
      '[Hanzo/ZAP] runtime.sendNativeMessage unavailable — ai.hanzo.zap_mdns helper required for discovery',
    );
  }
  const resp: any = await new Promise((resolve, reject) => {
    // Two dialects:
    //   - Firefox / promise-returning Chrome (MV3): sendNativeMessage(name, msg) → Promise
    //   - Chrome MV2 callback API: sendNativeMessage(name, msg, callback)
    // Detect by whether the first call returns a thenable; only fall back to
    // the callback shape when it doesn't, so we never send the same browse
    // request twice.
    try {
      const result = send.call(api.runtime, 'ai.hanzo.zap_mdns', { op: 'browse', timeout_ms: timeoutMs }, (r: any) => {
        // Callback dialect: result of the call() above is undefined and the
        // helper response arrives here. Promise dialect ignores callbacks.
        if (r !== undefined) resolve(r);
      });
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      }
      // If result was undefined and the callback never fires, the discovery
      // loop's interval handles the retry — no need for a per-call timer.
    } catch (e) {
      reject(e);
    }
  });
  if (!resp || !resp.ok || !Array.isArray(resp.services)) return [];
  return resp.services
    .map((s: any) => s.url)
    .filter((u: any): u is string => typeof u === 'string');
}

/**
 * Discover and connect to ZAP servers. Tries mDNS (HIP-0069,
 * `_hanzo._tcp.local.`) first via the ``ai.hanzo.zap_mdns`` native-messaging
 * helper; when the helper is absent or finds nothing, falls back to
 * probing the localhost ``ZAP_PORTS`` range so a developer running
 * hanzo-mcp on the same machine is always reachable without extra
 * installation. Use ``startZapDiscoveryLoop`` for the always-on watchdog.
 */
export async function discoverZapServers(
  mgr: ZapManager,
  browserName: string,
  version: string,
  _ports: number[] | undefined = undefined,  // unused — retained for ABI continuity
  log: (msg: string) => void = console.log,
): Promise<void> {
  log('[Hanzo/ZAP] Discovering MCP via mDNS (_hanzo._tcp.local.)...');
  let mdnsUrls: string[] = [];
  let mdnsError = false;
  try {
    mdnsUrls = await discoverViaMdns(1500);
  } catch (e: any) {
    mdnsError = true;
    log(`[Hanzo/ZAP] mDNS browse failed: ${e?.message || e} — falling back to localhost probe.`);
  }

  // Skip URLs we're already connected to so a watchdog re-tick is a no-op
  // when everything is already wired.
  const known = new Set<string>();
  for (const m of mgr.state.mcps) known.add(m.url);

  const candidates = mdnsUrls.filter(u => !known.has(u));

  // mDNS-only per HIP-0069. A browser extension must NEVER open arbitrary
  // ws://localhost:* sockets — that is the ERR_CONNECTION_REFUSED spam.
  // Either the native helper advertises a server, or we are cleanly
  // unavailable. No localhost port probing, no fallback ladder.
  if (candidates.length === 0) {
    if (mdnsError) {
      log('[Hanzo/ZAP] unavailable: native mDNS helper ai.hanzo.zap_mdns missing/unreachable');
    }
    return;
  }
  log(`[Hanzo/ZAP] mDNS found ${candidates.length} new server(s): ${candidates.join(', ')}`);

  await Promise.all(candidates.map(url => connectZap(url, mgr, browserName, version, log)));
}

/**
 * Always-on discovery watchdog. Ticks every ``intervalMs`` and re-runs
 * discovery whenever the manager has zero live connections (or a fresh server
 * has appeared on mDNS that we're not yet connected to). This is the canonical
 * entry point — replaces the fragile setTimeout-on-failure chain that died
 * the moment any code-path missed a re-arm. Returns the interval handle so
 * tests can stop it; in production the page lives for the extension lifetime.
 */
export function startZapDiscoveryLoop(
  mgr: ZapManager,
  browserName: string,
  version: string,
  intervalMs: number = 5000,
  log: (msg: string) => void = console.log,
): { stop: () => void } {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await discoverZapServers(mgr, browserName, version, undefined, log);
    } catch (e: any) {
      log(`[Hanzo/ZAP] discovery tick failed: ${e?.message || e}`);
    } finally {
      inFlight = false;
    }
  };
  // Run an immediate first probe; then settle into the watchdog cadence.
  void tick();
  const handle = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(handle) };
}

// ── Message Handler Helpers ─────────────────────────────────────────────

/** Handle zap.* messages from sidebar/popup. Returns true if handled. */
export function handleZapMessage(
  action: string,
  request: any,
  sendResponse: (r: any) => void,
  mgr: ZapManager,
  browserName: string,
  version: string,
): boolean {
  switch (action) {
    case 'zap.status':
      sendResponse({
        success: true,
        zap: {
          connected: mgr.state.connected,
          mcps: mgr.state.mcps.map(m => ({
            id: m.id,
            name: m.name,
            url: m.url,
            toolCount: m.tools.length,
          })),
        },
      });
      return true;

    case 'zap.discover':
    case 'zap.connect':
      // Discovery/dialing is gone. The extension connects to the local zapd
      // router via the ai.hanzo.zap native host (see native-zap.ts) — there is
      // no URL/port to discover or dial.
      sendResponse({ success: false, error: 'native-zap: connection is via the ai.hanzo.zap native host (no discovery)' });
      return true;

    case 'zap.callTool': {
      const toolName = request.name || request.tool;
      const toolArgs = request.args || {};
      if (!toolName) {
        sendResponse({ success: false, error: 'Missing tool name' });
        return true;
      }
      zapCallTool(mgr, toolName, toolArgs, request.mcpId).then((result: any) => {
        sendResponse({ success: true, result });
      }).catch((e: any) => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    case 'zap.listTools': {
      const tools = mgr.state.mcps.flatMap(m =>
        m.tools.map(t => ({ name: t, mcpId: m.id, mcpName: m.name }))
      );
      sendResponse({ success: true, tools });
      return true;
    }

    case 'zap.listResources': {
      const mcpId = request.mcpId || mgr.state.mcps[0]?.id;
      if (!mcpId) { sendResponse({ success: false, error: 'No MCP connected' }); return true; }
      zapListResources(mgr, mcpId).then((result: any) => {
        sendResponse({ success: true, result });
      }).catch((e: any) => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    case 'zap.readResource': {
      const mcpId = request.mcpId || mgr.state.mcps[0]?.id;
      if (!mcpId) { sendResponse({ success: false, error: 'No MCP connected' }); return true; }
      if (!request.uri) { sendResponse({ success: false, error: 'Missing uri' }); return true; }
      zapReadResource(mgr, mcpId, request.uri).then((result: any) => {
        sendResponse({ success: true, result });
      }).catch((e: any) => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    case 'zap.listPrompts': {
      const mcpId = request.mcpId || mgr.state.mcps[0]?.id;
      if (!mcpId) { sendResponse({ success: false, error: 'No MCP connected' }); return true; }
      zapListPrompts(mgr, mcpId).then((result: any) => {
        sendResponse({ success: true, result });
      }).catch((e: any) => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    case 'zap.getPrompt': {
      const mcpId = request.mcpId || mgr.state.mcps[0]?.id;
      if (!mcpId) { sendResponse({ success: false, error: 'No MCP connected' }); return true; }
      if (!request.name) { sendResponse({ success: false, error: 'Missing prompt name' }); return true; }
      zapGetPrompt(mgr, mcpId, request.name, request.args).then((result: any) => {
        sendResponse({ success: true, result });
      }).catch((e: any) => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    default:
      return false;
  }
}
