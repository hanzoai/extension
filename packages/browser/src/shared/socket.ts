// The extension's one connection to this machine's ZAP router: a WebSocket to
// the router's loopback door, proven with the pairing token. No native
// messaging, no helper binary, no manifest on disk — so it works in snap and
// Flatpak browsers, which refuse to exec a native host, as in any other.
//
// The router is not a daemon: it is embedded in every process that speaks ZAP
// (hanzo-mcp, the dev CLI, the desktop app, the IDE), and one of them holds the
// door. When that process exits another takes the door over; this socket drops,
// and the reconciler below reconnects to the same address.
//
// Wire (HIP-0069): each WebSocket binary message is one ZAP router envelope,
// length prefix included —
//   u32 len · u8 type · u16 flags · u16 from_len · u16 to_len · u32 payload_len
//   · from · to · payload            (little-endian)
// — the same bytes every other node sends on the router's unix socket.
//
// Pairing: the code `ws://127.0.0.1:<port>/#<64 hex>` names the door and the
// token. The fragment never leaves the extension. On connect:
//   extension → AUTH nc                                    (32 random bytes)
//   router    → AUTH ns ‖ HMAC(token, "zap router" ‖ nc ‖ ns)
//   extension → AUTH HMAC(token, "zap client" ‖ nc ‖ ns)
// The router proves itself first; a process squatting on the port without the
// token is never sent a HELLO and never obeyed.

export const HELLO = 1, WELCOME = 2, PROVIDERS_LIST = 3, PROVIDERS = 4, ERROR = 7, AUTH = 8;
export const ROUTE = 16, RESPONSE = 17;
const ROLE_PROVIDER = 1;

/** A probe unanswered, or a proof unfinished, for this long means the socket
 *  is open but deaf. */
const DEAF_MS = 5_000;
/** Probe cadence while connected. Also what keeps an MV3 service worker alive:
 *  Chrome extends a worker's life for WebSocket traffic inside 30 s. */
export const HEARTBEAT_MS = 20_000;
const BACKOFF_MIN = 250, BACKOFF_MAX = 30_000;

export interface Frame { t: number; flags: number; from: string; to: string; payload: Uint8Array }

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(t: number, from: string, to: string, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const f = enc.encode(from), d = enc.encode(to);
  const len = 11 + f.length + d.length + payload.length;
  const b = new Uint8Array(4 + len);
  const v = new DataView(b.buffer);
  v.setUint32(0, len, true);
  v.setUint8(4, t);
  v.setUint16(5, 0, true);
  v.setUint16(7, f.length, true);
  v.setUint16(9, d.length, true);
  v.setUint32(11, payload.length, true);
  b.set(f, 15);
  b.set(d, 15 + f.length);
  b.set(payload, 15 + f.length + d.length);
  return b;
}

/** Decode exactly one whole frame; anything short, long or trailing throws. */
export function decodeFrame(b: Uint8Array): Frame {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 15 || v.getUint32(0, true) !== b.length - 4) throw new Error('not one whole frame');
  const fl = v.getUint16(7, true), tl = v.getUint16(9, true), pl = v.getUint32(11, true);
  if (15 + fl + tl + pl !== b.length) throw new Error('frame length disagrees with its fields');
  return {
    t: v.getUint8(4),
    flags: v.getUint16(5, true),
    from: dec.decode(b.subarray(15, 15 + fl)),
    to: dec.decode(b.subarray(15 + fl, 15 + fl + tl)),
    payload: b.slice(15 + fl + tl),
  };
}

function putU16(a: number[], n: number) { a.push(n & 0xff, (n >> 8) & 0xff); }
function putStr(a: number[], s: string) {
  const b = enc.encode(s);
  putU16(a, b.length);
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}

// HELLO body: role(u8) + brand(str) + caps(u16 + str…). Mirrors zapd frame.rs.
function encodeHello(role: number, brand: string, caps: string[]): Uint8Array {
  const a: number[] = [role];
  putStr(a, brand);
  putU16(a, caps.length);
  for (const c of caps) putStr(a, c);
  return new Uint8Array(a);
}

// Browser command body: method(str) + params(u16 count of key:str → value:u32-len bytes).
export function decodeCmd(p: Uint8Array): { method: string; params: Record<string, string> } {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  let o = 0;
  const ml = dv.getUint16(o, true); o += 2;
  const method = dec.decode(p.subarray(o, o + ml)); o += ml;
  const n = dv.getUint16(o, true); o += 2;
  const params: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const kl = dv.getUint16(o, true); o += 2;
    const k = dec.decode(p.subarray(o, o + kl)); o += kl;
    const vl = dv.getUint32(o, true); o += 4;
    params[k] = dec.decode(p.subarray(o, o + vl)); o += vl;
  }
  return { method, params };
}

export interface Provider { id: string; role: number; brand: string; caps: string[] }

// PROVIDERS body: count(u16) + per node id(str) + role(u8) + brand(str) +
// caps(u16 + str…). The router's own answer to "am I registered, and as what?"
export function decodeProviders(p: Uint8Array): Provider[] {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
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

export interface Pairing { url: string; key: Uint8Array<ArrayBuffer> }

/** Parse a pairing code. Loopback only: a code naming any other host is not
 *  one a router on this machine minted, and the extension never dials out. */
export function parsePairing(code: string): Pairing | null {
  const m = /^ws:\/\/127\.0\.0\.1:(\d{1,5})\/#([0-9a-f]{64})$/.exec(code.trim());
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null;
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = parseInt(m[2].slice(2 * i, 2 * i + 2), 16);
  return { url: `ws://127.0.0.1:${port}/`, key };
}

/** Bytes WebCrypto accepts: a view over a plain ArrayBuffer. */
type Bytes = Uint8Array<ArrayBuffer>;

async function hmacKey(key: Bytes, use: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [use]);
}

function labelled(label: string, nc: Uint8Array, ns: Uint8Array): Bytes {
  const l = enc.encode(label);
  const m = new Uint8Array(l.length + nc.length + ns.length);
  m.set(l, 0);
  m.set(nc, l.length);
  m.set(ns, l.length + nc.length);
  return m;
}

export async function proof(key: Bytes, label: string, nc: Uint8Array, ns: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), labelled(label, nc, ns)));
}

async function verify(key: Bytes, label: string, nc: Uint8Array, ns: Uint8Array, mac: Uint8Array): Promise<boolean> {
  return crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), new Uint8Array(mac), labelled(label, nc, ns));
}

/** Why the last attempt failed, for the popup. */
export type ZapError = '' | 'no-router' | 'refused' | 'mismatch';

export interface ZapState {
  /** The router lists us — not merely "a socket is open". */
  connected: boolean;
  socket: WebSocket | null;
  /** The router proved the token and we proved it back. */
  authed: boolean;
  /** When the current socket was opened. */
  since: number;
  /** Proposed as `browser/<engine>-<id>`; the router's full id
   *  `browser/<host>/<engine>-<id>` once WELCOME names it. */
  providerId: string;
  /** What the router's registry says this browser serves. */
  caps: string[];
  /** When the outstanding registry probe was sent, or 0. */
  probedAt: number;
  pairing: Pairing | null;
  error: ZapError;
  timer: ReturnType<typeof setTimeout> | null;
  backoff: number;
}

export function newZapState(providerId: string): ZapState {
  return {
    connected: false, socket: null, authed: false, since: 0, providerId, caps: [], probedAt: 0,
    pairing: null, error: '', timer: null, backoff: BACKOFF_MIN,
  };
}

export type Dispatch = (method: string, params: any) => Promise<any> | any;

export interface ZapOpts {
  brand: string;
  caps: string[];
  dispatch: Dispatch;
  log: (m: string) => void;
}

function send(ws: WebSocket, t: number, to: string, payload?: Uint8Array, from = '') {
  ws.send(encodeFrame(t, from, to, payload));
}

/** Unregistered: nothing of ours is reachable through the router. */
function offline(state: ZapState) {
  state.connected = false;
  state.caps = [];
}

/** Close the socket we hold, if any, and forget it. */
function drop(state: ZapState) {
  const ws = state.socket;
  state.socket = null;
  state.authed = false;
  state.probedAt = 0;
  offline(state);
  if (ws) { try { ws.close(); } catch {} }
}

/** The one clock: every tick reschedules the next, so there is never more than
 *  one pending. An alarm that restarts a killed service worker calls
 *  `ensureZap` too, and simply resets this clock. */
function schedule(state: ZapState, opts: ZapOpts, ms: number) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.timer = null; ensureZap(state, opts); }, ms);
}

/** Take a new pairing (or none): drop the old socket and reconcile at once. */
export function setPairing(state: ZapState, pairing: Pairing | null, opts: ZapOpts) {
  state.pairing = pairing;
  state.error = '';
  state.backoff = BACKOFF_MIN;
  drop(state);
  ensureZap(state, opts);
}

function connect(state: ZapState, opts: ZapOpts, pairing: Pairing) {
  let ws: WebSocket;
  try {
    ws = new WebSocket(pairing.url);
  } catch (e: any) {
    opts.log('[Hanzo/ZAP] cannot open ' + pairing.url + ': ' + (e?.message || e));
    return;
  }
  ws.binaryType = 'arraybuffer';
  state.socket = ws;
  state.since = Date.now();
  state.authed = false;
  state.probedAt = 0;
  offline(state);
  const nc = crypto.getRandomValues(new Uint8Array(32));
  let opened = false;
  let proven = false;

  ws.onopen = () => {
    opened = true;
    send(ws, AUTH, '', nc);
  };

  ws.onmessage = async (ev: MessageEvent) => {
    if (state.socket !== ws) return;
    let f: Frame;
    try {
      f = decodeFrame(new Uint8Array(ev.data as ArrayBuffer));
    } catch {
      drop(state);
      return;
    }
    if (!state.authed) {
      // The only frame before the proof is the router's own proof.
      if (f.t !== AUTH || f.payload.length !== 64) { drop(state); return; }
      const ns = f.payload.slice(0, 32);
      if (!(await verify(pairing.key, 'zap router', nc, ns, f.payload.slice(32)))) {
        state.error = 'mismatch';
        opts.log('[Hanzo/ZAP] the router on ' + pairing.url + ' does not hold our pairing token — pair again');
        drop(state);
        return;
      }
      if (state.socket !== ws) return;
      proven = true;
      send(ws, AUTH, '', await proof(pairing.key, 'zap client', nc, ns));
      state.authed = true;
      send(ws, HELLO, '', encodeHello(ROLE_PROVIDER, opts.brand, opts.caps), state.providerId);
      return;
    }
    switch (f.t) {
      case WELCOME:
        // WELCOME is addressed to the id the router registered — our proposal
        // with its host stamped in. Registration is confirmed by the registry.
        if (f.to) state.providerId = f.to;
        state.error = '';
        state.backoff = BACKOFF_MIN;
        state.probedAt = Date.now();
        send(ws, PROVIDERS_LIST, '');
        break;
      case PROVIDERS: {
        state.probedAt = 0;
        const mine = decodeProviders(f.payload).find((p) => p.id === state.providerId);
        if (!!mine !== state.connected) {
          opts.log(`[Hanzo/ZAP] ${mine ? 'registered' : 'dropped by router'}: ${state.providerId}`);
        }
        state.connected = !!mine;
        state.caps = mine ? mine.caps : [];
        break;
      }
      case ERROR:
        opts.log('[Hanzo/ZAP] ' + dec.decode(f.payload));
        break;
      case ROUTE:
        void answer(ws, f, opts);
        break;
      default:
        break; // presence chatter: a browser ignores it
    }
  };

  ws.onclose = () => {
    if (state.socket !== ws) return;
    // Never opened: nothing listens there (or the door refused our origin).
    // Opened but closed before the router's proof: the router refused us. A
    // mismatch has already said so above.
    if (!proven && state.error !== 'mismatch') state.error = opened ? 'refused' : 'no-router';
    drop(state);
    opts.log(`[Hanzo/ZAP] socket closed; retrying in ${state.backoff} ms`);
    schedule(state, opts, state.backoff);
    state.backoff = Math.min(state.backoff * 2, BACKOFF_MAX);
  };
}

/** Run one inbound command and answer it. */
async function answer(ws: WebSocket, f: Frame, opts: ZapOpts) {
  let out: Uint8Array;
  try {
    const { method, params } = decodeCmd(f.payload);
    const r = await opts.dispatch(method, params);
    // Structured results travel as UTF-8 JSON text; the router never reads them.
    out = enc.encode(typeof r === 'string' ? r : JSON.stringify(r ?? null));
  } catch (e: any) {
    out = enc.encode('ERR:' + (e?.message || String(e)));
  }
  if (ws.readyState === WebSocket.OPEN) send(ws, RESPONSE, f.from, out);
}

/** The ONE reconciler. Brings the extension's registration in line with the
 *  router's registry, and is the only thing that opens a socket.
 *
 *    no pairing              → nothing to connect to
 *    no socket               → connect (the proof and HELLO follow on open)
 *    not proven after 5 s    → the door is silent: drop it and retry
 *    probe unanswered (5 s)  → open but deaf: drop it and retry
 *    proven but unlisted     → re-send HELLO (the router replaces by id)
 *    proven                  → probe the registry, which both refreshes
 *                              `connected` and keeps the worker alive
 */
export function ensureZap(state: ZapState, opts: ZapOpts): void {
  const pairing = state.pairing;
  if (!pairing) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    drop(state);
    return;
  }
  const ws = state.socket;
  if (!ws) {
    connect(state, opts, pairing);
    schedule(state, opts, HEARTBEAT_MS);
    return;
  }
  const now = Date.now();
  if ((!state.authed && now - state.since > DEAF_MS) || (state.probedAt && now - state.probedAt > DEAF_MS)) {
    opts.log('[Hanzo/ZAP] router is not answering — reconnecting');
    drop(state);
    connect(state, opts, pairing);
    schedule(state, opts, HEARTBEAT_MS);
    return;
  }
  if (!state.authed) {
    schedule(state, opts, DEAF_MS);
    return;
  }
  try {
    if (!state.connected) send(ws, HELLO, '', encodeHello(ROLE_PROVIDER, opts.brand, opts.caps), state.providerId);
    if (!state.probedAt) state.probedAt = Date.now();
    send(ws, PROVIDERS_LIST, '');
  } catch {
    drop(state);
  }
  schedule(state, opts, HEARTBEAT_MS);
}
