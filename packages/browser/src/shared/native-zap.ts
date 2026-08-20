// Native-ZAP transport — the extension's one connection to the local zapd
// router, via the ai.hanzo.zap native-messaging host. No WebSocket, no
// localhost ports, no mDNS probing. The browser can never get "connection
// refused": connectNative either attaches the host or fails once, cleanly.
//
// Frames are the ZAP router envelope (binary, in zapd). Over native messaging
// they ride as JSON `{t, flags, from, to, payload(base64)}` — the Chrome-forced
// inch — and the host re-frames 1:1 to binary on the UDS. The opaque command/
// result payload uses a compact binary codec below (no JSON in the contract).

const HELLO = 1, WELCOME = 2, PROVIDERS_LIST = 3, PROVIDERS = 4, ERROR = 7, ROUTE = 16, RESPONSE = 17;
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

export interface Provider {
  id: string;
  role: number;
  brand: string;
  caps: string[];
}

// PROVIDERS body: count(u16) + per entry id(str) + role(u8) + brand(str) +
// caps(u16 + str…). The registry is the router's own answer to both "am I
// reachable?" and "what does it say I serve?".
export function decodeProviders(p: Uint8Array): Provider[] {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const dec = new TextDecoder();
  let o = 0;
  const str = (): string => {
    const n = dv.getUint16(o, true); o += 2;
    const s = dec.decode(p.subarray(o, o + n)); o += n;
    return s;
  };
  const n = dv.getUint16(o, true); o += 2;
  const out: Provider[] = [];
  for (let i = 0; i < n; i++) {
    const id = str();
    const role = dv.getUint8(o); o += 1;
    const brand = str();
    const nc = dv.getUint16(o, true); o += 2;
    const caps: string[] = [];
    for (let c = 0; c < nc; c++) caps.push(str());
    out.push({ id, role, brand, caps });
  }
  return out;
}

export interface NativeZapState {
  /** The router lists us as a provider — not merely "a port is open". */
  connected: boolean;
  port: chrome.runtime.Port | null;
  /** Our id: proposed as `browser:<engine>/default`, refined to the router's
   *  device-stamped id once WELCOME names it. Re-stamping is idempotent, so
   *  reconnecting with the refined id yields the same id. */
  providerId: string;
  /** What the router's registry says this browser serves. Read from our own
   *  PROVIDERS entry, so it reports what other peers can actually reach. */
  caps: string[];
  /** A liveness probe is outstanding. Two ticks with no PROVIDERS reply means
   *  the port is open but deaf — the wedge this state exists to catch. */
  probing?: boolean;
}

export type Dispatch = (method: string, params: any) => Promise<any> | any;

/** Post one router frame on a native port. `payload` empty ⇒ no body. */
function send(port: chrome.runtime.Port, t: number, from: string, payload?: Uint8Array) {
  port.postMessage({ t, flags: 0, from, to: '', payload: payload ? b64encode(payload) : '' });
}

const helloBody = (brand: string, caps: string[]) => encodeHello(ROLE_PROVIDER, brand, caps);

/** Unregistered: nothing of ours is reachable through the router. */
function offline(state: NativeZapState) {
  state.connected = false;
  state.caps = [];
}

/** Connect to zapd via the native host, register as a browser provider, and
 *  dispatch inbound ROUTE commands to the browser.
 *
 *  Reconnection is NOT scheduled here — `ensureNativeZap` is the one
 *  reconciler. A second, self-scheduling retry inside this function is what
 *  raced two native hosts onto the same provider id (see ensureNativeZap). */
function connectNativeZap(
  state: NativeZapState,
  brand: string,
  caps: string[],
  dispatch: Dispatch,
  log: (m: string) => void = console.log,
): void {
  // Cross-browser: Firefox exposes `browser.runtime`, Chrome `chrome.runtime`;
  // both implement connectNative. One transport, both browsers.
  const rt: any = (typeof browser !== 'undefined' ? (browser as any) : chrome).runtime;
  // Singleton: never run two native ports. Tear down any prior port first — two
  // live hosts race to register the SAME provider id, and when the loser is
  // closed it can take the winner's registry entry with it, leaving the router
  // with 0 providers while the extension still holds an open port.
  const prior = state.port;
  state.port = null;
  if (prior) { try { prior.disconnect(); } catch {} }
  let port: chrome.runtime.Port;
  try {
    port = rt.connectNative('ai.hanzo.zap');
  } catch (e: any) {
    offline(state);
    log('[Hanzo/ZAP] native host ai.hanzo.zap is not installed');
    return;
  }
  state.port = port;
  offline(state);
  state.probing = false;

  // Register as a provider.
  send(port, HELLO, state.providerId, helloBody(brand, caps));

  port.onMessage.addListener(async (msg: any) => {
    const payload = msg.payload ? b64decode(msg.payload) : new Uint8Array(0);
    switch (msg.t) {
      case WELCOME:
        // WELCOME is addressed to the id the router VERIFIED — the native host
        // stamps the device into it, so this is the only way we learn our real
        // id. A WELCOME alone does not mean we are registered: another host for
        // this same id may evict us a moment later. Ask the registry.
        if (typeof msg.to === 'string' && msg.to) state.providerId = msg.to;
        state.probing = true;
        send(port, PROVIDERS_LIST, state.providerId);
        break;
      case PROVIDERS: {
        state.probing = false;
        const mine = decodeProviders(payload).find((p) => p.id === state.providerId);
        if (!!mine !== state.connected) {
          log(`[Hanzo/ZAP] ${mine ? 'registered' : 'dropped by router'}: ${state.providerId}`);
        }
        state.connected = !!mine;
        state.caps = mine ? mine.caps : [];
        break;
      }
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
        port.postMessage({ t: RESPONSE, flags: 0, from: state.providerId, to: msg.from, payload: b64encode(out) });
        break;
      }
      default:
        break; // PEER_* — a provider ignores presence chatter
    }
  });

  port.onDisconnect.addListener(() => {
    if (state.port !== port) return; // replaced by a newer port — nothing to do
    offline(state);
    state.probing = false;
    state.port = null;
    const err = rt.lastError?.message;
    log('[Hanzo/ZAP] native host disconnected' + (err ? ': ' + err : ''));
  });
}

/** The ONE reconciler: drive this on a timer. It brings the extension's
 *  registration in line with the router's registry, and is the only thing that
 *  opens a native port after the first.
 *
 *  It exists because `onDisconnect` is not a sufficient health signal. A native
 *  port stays "open" while its host process is wedged (the host blocks reading a
 *  pipe the browser never closes), so a port can be open, deaf, and unregistered
 *  forever — the observed failure: router reports 0 providers while a native host
 *  has been up for hours and the extension believes it is connected.
 *
 *  Each tick:
 *    no port                  → connect
 *    probe unanswered         → the port is deaf; drop it and reconnect
 *    port fine but unlisted   → re-send HELLO on it (the router does
 *                               evict-and-replace, so this is idempotent)
 *    always                   → probe the registry, which both refreshes
 *                               `connected` and proves the pipe round-trips
 */
export function ensureNativeZap(
  state: NativeZapState,
  brand: string,
  caps: string[],
  dispatch: Dispatch,
  log: (m: string) => void = console.log,
): void {
  const port = state.port;
  if (!port) {
    connectNativeZap(state, brand, caps, dispatch, log);
    return;
  }
  if (state.probing) {
    log('[Hanzo/ZAP] native host is not answering — reconnecting');
    offline(state);
    connectNativeZap(state, brand, caps, dispatch, log); // tears the deaf port down
    return;
  }
  try {
    // The port round-trips but the router does not list us — re-register
    // rather than churn a new native host.
    if (!state.connected) send(port, HELLO, state.providerId, helloBody(brand, caps));
    state.probing = true;
    send(port, PROVIDERS_LIST, state.providerId);
  } catch {
    // postMessage throws on an already-dead port: reconnect on the next tick.
    state.probing = false;
    offline(state);
    state.port = null;
  }
}
