// Native-ZAP transport — the extension's one connection to the local zapd
// router, via the ai.hanzo.zap native-messaging host. No WebSocket, no
// localhost ports, no mDNS probing. The browser can never get "connection
// refused": connectNative either attaches the host or fails once, cleanly.
//
// Frames are the ZAP router envelope (binary, in zapd). Over native messaging
// they ride as JSON `{t, flags, from, to, payload(base64)}` — the Chrome-forced
// inch — and the host re-frames 1:1 to binary on the UDS. The opaque command/
// result payload uses a compact binary codec below (no JSON in the contract).

const HELLO = 1, WELCOME = 2, ERROR = 7, ROUTE = 16, RESPONSE = 17;
const ROLE_PROVIDER = 1;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function putU16(a: number[], n: number) { a.push(n & 0xff, (n >> 8) & 0xff); }
function putStr(a: number[], s: string) {
  const b = new TextEncoder().encode(s);
  putU16(a, b.length);
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}

// HELLO body: role(u8) + brand(str) + caps(u16 + str…). Mirrors frame.rs.
function encodeHello(role: number, brand: string, caps: string[]): Uint8Array {
  const a: number[] = [role];
  putStr(a, brand);
  putU16(a, caps.length);
  for (const c of caps) putStr(a, c);
  return new Uint8Array(a);
}

// Command body: method(str) + params(u16 count of key:str → value:bytes).
function decodeCmd(p: Uint8Array): { method: string; params: Record<string, string> } {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  let o = 0;
  const ml = dv.getUint16(o, true); o += 2;
  const method = new TextDecoder().decode(p.subarray(o, o + ml)); o += ml;
  const n = dv.getUint16(o, true); o += 2;
  const params: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const kl = dv.getUint16(o, true); o += 2;
    const k = new TextDecoder().decode(p.subarray(o, o + kl)); o += kl;
    const vl = dv.getUint32(o, true); o += 4;
    params[k] = new TextDecoder().decode(p.subarray(o, o + vl)); o += vl;
  }
  return { method, params };
}

export interface NativeZapState {
  connected: boolean;
  port: chrome.runtime.Port | null;
  providerId: string;
}

export type Dispatch = (method: string, params: any) => Promise<any> | any;

// Gentle safe poll: with no MCP client running there is no router to reach, so
// the host connects-then-exits; probe every 30s instead of hammering (and
// re-launching the native host) every 3s. A live consumer is picked up within
// one interval.
const RECONNECT_MS = 30_000;

/** Connect to zapd via the native host, register as a browser provider, and
 *  dispatch inbound ROUTE commands to the browser. Self-heals on disconnect. */
export function connectNativeZap(
  state: NativeZapState,
  brand: string,
  caps: string[],
  dispatch: Dispatch,
  log: (m: string) => void = console.log,
): void {
  // Cross-browser: Firefox exposes `browser.runtime`, Chrome `chrome.runtime`;
  // both implement connectNative. One transport, both browsers.
  const rt: any = (typeof browser !== 'undefined' ? (browser as any) : chrome).runtime;
  // Singleton: never run two native ports. Tear down any prior port first — its
  // onDisconnect below is guarded so a replaced port never schedules a reconnect.
  // Without this, repeated connectNativeZap() calls (startup + events + the 3s
  // reconnect) accumulate ports, each spawning a native host → a host-spawn storm.
  const prior = state.port;
  state.port = null;
  if (prior) { try { prior.disconnect(); } catch {} }
  let port: chrome.runtime.Port;
  try {
    port = rt.connectNative('ai.hanzo.zap');
  } catch (e: any) {
    state.connected = false;
    log('[Hanzo/ZAP] native host ai.hanzo.zap is not installed');
    return;
  }
  state.port = port;
  const id = state.providerId;

  const post = (t: number, to: string, payload: Uint8Array) =>
    port.postMessage({ t, flags: 0, from: id, to, payload: b64encode(payload) });

  // Register as a provider.
  post(HELLO, '', encodeHello(ROLE_PROVIDER, brand, caps));

  port.onMessage.addListener(async (msg: any) => {
    const payload = msg.payload ? b64decode(msg.payload) : new Uint8Array(0);
    switch (msg.t) {
      case WELCOME:
        state.connected = true;
        log(`[Hanzo/ZAP] native host connected; registered ${id}`);
        break;
      case ERROR:
        log('[Hanzo/ZAP] ' + new TextDecoder().decode(payload));
        break;
      case ROUTE: {
        const { method, params } = decodeCmd(payload);
        let out: Uint8Array;
        try {
          const r = await dispatch(method, params);
          // browser.zap stopgap: structured results travel as utf-8 text until
          // the typed browser schema lands. Router/host never see this — opaque.
          const s = typeof r === 'string' ? r : JSON.stringify(r ?? null);
          out = new TextEncoder().encode(s);
        } catch (e: any) {
          out = new TextEncoder().encode('ERR:' + (e?.message || String(e)));
        }
        port.postMessage({ t: RESPONSE, flags: 0, from: id, to: msg.from, payload: b64encode(out) });
        break;
      }
      default:
        break; // PROVIDERS / PEER_* — a provider ignores these
    }
  });

  port.onDisconnect.addListener(() => {
    if (state.port !== port) return; // replaced by a newer port — do not reconnect
    state.connected = false;
    state.port = null;
    const err = rt.lastError?.message;
    log('[Hanzo/ZAP] native host disconnected' + (err ? ': ' + err : ''));
    setTimeout(() => connectNativeZap(state, brand, caps, dispatch, log), RECONNECT_MS);
  });
}
