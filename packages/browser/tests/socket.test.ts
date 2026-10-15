// The extension's one transport, driven against a fake WebSocket whose far end
// speaks the real router: the zapd envelope, the real HMAC-SHA256 pairing
// proof, WELCOME/PROVIDERS as frame.rs encodes them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH, ERROR, HELLO, PROVIDERS, PROVIDERS_LIST, RESPONSE, ROUTE, WELCOME,
  decodeFrame, decodeProviders, encodeFrame, ensureZap, newZapState, parsePairing, proof, setPairing,
  type Frame, type ZapOpts, type ZapState,
} from '../src/shared/socket';

const KEY_HEX = '07'.repeat(32);
const CODE = `ws://127.0.0.1:21000/#${KEY_HEX}`;
const KEY = parsePairing(CODE)!.key;

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: Frame[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => Promise<void> | void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(b: Uint8Array) { this.sent.push(decodeFrame(b)); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  // The router's side.
  open() { this.readyState = 1; this.onopen?.(); }
  async recv(t: number, from: string, to: string, payload = new Uint8Array(0)) {
    const b = encodeFrame(t, from, to, payload);
    await this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
  }
  last(t: number) { return [...this.sent].reverse().find((f) => f.t === t); }
}

function providers(ids: string[], caps: string[] = ['browser.navigate']): Uint8Array {
  const a: number[] = [];
  const u16 = (n: number) => a.push(n & 0xff, (n >> 8) & 0xff);
  const str = (s: string) => { const b = new TextEncoder().encode(s); u16(b.length); b.forEach((x) => a.push(x)); };
  u16(ids.length);
  for (const id of ids) { str(id); a.push(1); str('hanzo'); u16(caps.length); caps.forEach(str); u16(1); str('leasable'); str('true'); }
  return new Uint8Array(a);
}

const ID = 'browser/dgx/chrome-3fa2';
let logs: string[];
let dispatched: Array<[string, any]>;
const opts = (): ZapOpts => ({
  brand: 'hanzo',
  caps: ['browser.navigate'],
  dispatch: (method, params) => { dispatched.push([method, params]); return { ok: true }; },
  log: (m) => logs.push(m),
});

function paired(): ZapState {
  const s = newZapState('browser/chrome-3fa2');
  s.pairing = parsePairing(CODE);
  return s;
}

/** Play the router through the proof. `key` is what the router holds. */
async function prove(ws: FakeSocket, key = KEY) {
  ws.open();
  const nc = ws.sent[0].payload;
  const ns = crypto.getRandomValues(new Uint8Array(32));
  const reply = new Uint8Array(64);
  reply.set(ns, 0);
  reply.set(await proof(key, 'zap router', nc, ns), 32);
  await ws.recv(AUTH, '', '', reply);
  return { nc, ns };
}

async function register(s: ZapState, o = opts()) {
  ensureZap(s, o);
  const ws = FakeSocket.all.at(-1)!;
  await prove(ws);
  await ws.recv(WELCOME, 'zapd', ID);
  await ws.recv(PROVIDERS, 'zapd', ID, providers([ID]));
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  logs = [];
  dispatched = [];
  (globalThis as any).WebSocket = FakeSocket;
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).WebSocket;
});

describe('pairing codes', () => {
  it('name a loopback door and a 32-byte token', () => {
    const p = parsePairing(`  ${CODE}\n`)!;
    expect(p.url).toBe('ws://127.0.0.1:21000/');
    expect(Array.from(p.key)).toEqual(new Array(32).fill(7));
  });

  it('never point off this machine, and never carry a malformed token', () => {
    for (const bad of [
      `ws://evil.example:21000/#${KEY_HEX}`,
      `ws://localhost:21000/#${KEY_HEX}`,
      `wss://127.0.0.1:21000/#${KEY_HEX}`,
      `ws://127.0.0.1:0/#${KEY_HEX}`,
      `ws://127.0.0.1:70000/#${KEY_HEX}`,
      `ws://127.0.0.1:21000/#${'0A'.repeat(32)}`,
      'ws://127.0.0.1:21000/#short',
      'ws://127.0.0.1:21000/',
    ]) expect(parsePairing(bad), bad).toBeNull();
  });
});

describe('frames', () => {
  it('are one whole envelope each', () => {
    const b = encodeFrame(ROUTE, 'agent/dgx/hanzo-1', ID, new Uint8Array([0, 1, 2]));
    const f = decodeFrame(b);
    expect([f.t, f.from, f.to, Array.from(f.payload)]).toEqual([ROUTE, 'agent/dgx/hanzo-1', ID, [0, 1, 2]]);
    expect(() => decodeFrame(b.slice(0, -1))).toThrow();
    const two = new Uint8Array(b.length * 2);
    two.set(b); two.set(b, b.length);
    expect(() => decodeFrame(two)).toThrow();
  });
});

describe('ensureZap', () => {
  it('with no pairing, joins the well-known door on origin alone: HELLO, no AUTH', async () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    const ws = FakeSocket.all[0];
    expect(ws.url).toBe('ws://127.0.0.1:9998/');
    ws.open();
    expect(ws.sent.map((f) => f.t)).toEqual([HELLO]);
    await ws.recv(WELCOME, 'zapd', ID);
    await ws.recv(PROVIDERS, 'zapd', ID, providers([ID]));
    expect(s.connected).toBe(true);
    expect(s.socket?.kind).toBe('door');
  });

  it('with no pairing, sweeps the well-known ports before backing off', () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    for (let i = 0; i < 9; i++) FakeSocket.all.at(-1)!.close();
    expect(FakeSocket.all.map((w) => w.url)).toEqual(
      [9998, 21000, 21001, 21002, 21003, 21004, 21005, 21006, 21007].map((p) => `ws://127.0.0.1:${p}/`),
    );
    expect(s.error).toBe('no-router');
  });

  it('starts the next sweep at the port that answered, and still tries every port once', () => {
    const s = newZapState('browser/chrome-3fa2');
    const doors: number[] = [];
    const o = { ...opts(), door: (p: number) => doors.push(p) };
    ensureZap(s, o);
    FakeSocket.all.at(-1)!.close();          // 9998 refused
    FakeSocket.all.at(-1)!.open();           // 21000 answers
    expect(doors).toEqual([21000]);
    FakeSocket.all.at(-1)!.close();          // the router goes away before registering us
    for (let i = 0; i < 8; i++) FakeSocket.all.at(-1)!.close();
    expect(FakeSocket.all.slice(2).map((w) => w.url)).toEqual(
      [21001, 21002, 21003, 21004, 21005, 21006, 21007, 9998].map((p) => `ws://127.0.0.1:${p}/`),
    );
    expect(s.error).toBe('no-router');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.at(-1)!.url).toBe('ws://127.0.0.1:21000/');
  });

  it('checks the router\'s proof before it says anything else, then registers', async () => {
    const s = paired();
    ensureZap(s, opts());
    const ws = FakeSocket.all[0];
    expect(ws.url).toBe('ws://127.0.0.1:21000/');
    const { nc, ns } = await prove(ws);
    // Our proof, then HELLO under our proposed id.
    const [, ours, hello] = ws.sent;
    expect(ours.t).toBe(AUTH);
    expect(Array.from(ours.payload)).toEqual(Array.from(await proof(KEY, 'zap client', nc, ns)));
    expect([hello.t, hello.from]).toEqual([HELLO, 'browser/chrome-3fa2']);
    // The descriptor ends with its attrs count: the browser declares none.
    expect(Array.from(hello.payload.slice(-2))).toEqual([0, 0]);
    expect(s.connected).toBe(false);

    await ws.recv(WELCOME, 'zapd', ID);
    expect(s.providerId).toBe(ID);
    expect(ws.last(PROVIDERS_LIST)).toBeTruthy();
    await ws.recv(PROVIDERS, 'zapd', ID, providers([ID, 'agent/dgx/hanzo-1']));
    expect(s.connected).toBe(true);
    expect(s.caps).toEqual(['browser.navigate']);
    expect(decodeProviders(providers([ID]))[0].attrs).toEqual({ leasable: 'true' });
  });

  it('never registers with a router that cannot prove the token', async () => {
    const s = paired();
    ensureZap(s, opts());
    const ws = FakeSocket.all[0];
    await prove(ws, new Uint8Array(32).fill(8));
    expect(ws.sent.map((f) => f.t)).toEqual([AUTH]); // our nonce, and nothing after it
    expect(ws.closed).toBe(true);
    expect(s.error).toBe('mismatch');
    expect(s.connected).toBe(false);
  });

  it('with no router listening, says so and retries with backoff', async () => {
    const s = paired();
    ensureZap(s, opts());
    FakeSocket.all[0].close(); // refused before it opened
    expect(s.error).toBe('no-router');
    vi.advanceTimersByTime(249);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].close();
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(2); // doubled
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('follows the router to another process: the socket drops, the next one registers', async () => {
    const s = paired();
    const ws = await register(s);
    expect(s.connected).toBe(true);
    ws.close(); // the router's process exited
    expect(s.connected).toBe(false);
    vi.advanceTimersByTime(250);
    const next = FakeSocket.all[1];
    await prove(next);
    await next.recv(WELCOME, 'zapd', ID);
    await next.recv(PROVIDERS, 'zapd', ID, providers([ID]));
    expect(s.connected).toBe(true);
    expect(s.error).toBe('');
  });

  it('holds one socket, however often it is ticked', async () => {
    const s = paired();
    ensureZap(s, opts());
    ensureZap(s, opts());
    ensureZap(s, opts());
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('replaces a socket whose registry probe goes unanswered', async () => {
    const s = paired();
    const ws = await register(s);
    vi.advanceTimersByTime(20_000); // heartbeat: probe sent
    expect(s.probedAt).toBeGreaterThan(0);
    vi.advanceTimersByTime(20_000); // next heartbeat, still no answer: deaf
    expect(ws.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('a heartbeat keeps probing while registered, and re-sends HELLO when unlisted', async () => {
    const s = paired();
    const ws = await register(s);
    const probes = () => ws.sent.filter((f) => f.t === PROVIDERS_LIST).length;
    const before = probes();
    vi.advanceTimersByTime(20_000);
    expect(probes()).toBe(before + 1);
    await ws.recv(PROVIDERS, 'zapd', ID, providers([])); // the router forgot us
    expect(s.connected).toBe(false);
    const hellos = ws.sent.filter((f) => f.t === HELLO).length;
    vi.advanceTimersByTime(20_000);
    expect(ws.sent.filter((f) => f.t === HELLO).length).toBe(hellos + 1);
  });

  it('answers a ROUTE to its sender', async () => {
    const s = paired();
    const ws = await register(s);
    const a: number[] = [];
    const put = (x: string) => { const b = new TextEncoder().encode(x); a.push(b.length & 0xff, b.length >> 8); b.forEach((c) => a.push(c)); };
    put('Page.navigate'); a.push(1, 0); put('url');
    const v = new TextEncoder().encode('https://example.com');
    a.push(v.length, 0, 0, 0); v.forEach((c) => a.push(c));
    await ws.recv(ROUTE, 'agent/dgx/hanzo-1', ID, new Uint8Array(a));
    await vi.waitFor(() => expect(ws.last(RESPONSE)).toBeTruthy());
    expect(dispatched).toEqual([['Page.navigate', { url: 'https://example.com' }]]);
    const r = ws.last(RESPONSE)!;
    expect([r.to, new TextDecoder().decode(r.payload)]).toEqual(['agent/dgx/hanzo-1', '{"ok":true}']);
  });

  it('logs a router ERROR and stays registered', async () => {
    const s = paired();
    const ws = await register(s);
    await ws.recv(ERROR, 'zapd', ID, new TextEncoder().encode('no_route:agent/dgx/gone-1'));
    expect(logs.at(-1)).toContain('no_route');
    expect(s.connected).toBe(true);
  });

  it('unpairing closes the paired socket and goes back to the well-known door', async () => {
    const s = paired();
    const ws = await register(s);
    setPairing(s, null, opts());
    expect(ws.closed).toBe(true);
    const next = FakeSocket.all.at(-1)!;
    expect(next).not.toBe(ws);
    expect(next.url).toBe('ws://127.0.0.1:9998/');
  });
});

// The local way: Chrome native messaging to `hanzo-zap-host`, which relays the
// same envelopes to the router's unix socket. No pairing, no AUTH.
class FakePort {
  static last: FakePort | null = null;
  sent: Frame[] = [];
  disconnected = false;
  private onMsg: ((m: any) => void) | null = null;
  private onDisc: (() => void) | null = null;
  onMessage = { addListener: (f: (m: any) => void) => { this.onMsg = f; } };
  onDisconnect = { addListener: (f: () => void) => { this.onDisc = f; } };
  constructor(public name: string) { FakePort.last = this; }
  postMessage(m: { z: string }) {
    const bin = atob(m.z);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    this.sent.push(decodeFrame(b));
  }
  disconnect() { this.disconnected = true; }
  // The host's side.
  recv(t: number, from: string, to: string, payload = new Uint8Array(0)) {
    const b = encodeFrame(t, from, to, payload);
    let s = '';
    b.forEach((x) => { s += String.fromCharCode(x); });
    this.onMsg?.({ z: btoa(s) });
  }
  gone(message?: string) {
    (globalThis as any).chrome.runtime.lastError = message ? { message } : undefined;
    this.onDisc?.();
  }
}

describe('native messaging', () => {
  beforeEach(() => {
    FakePort.last = null;
    (globalThis as any).chrome = { runtime: { connectNative: (n: string) => new FakePort(n) } };
  });
  afterEach(() => { delete (globalThis as any).chrome; });

  it('joins with no pairing: HELLO at once, registered once the router lists us', () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    const port = FakePort.last!;
    expect(port.name).toBe('ai.hanzo.zap');
    expect(port.sent[0].t).toBe(HELLO);
    expect(port.sent[0].from).toBe('browser/chrome-3fa2');
    expect(FakeSocket.all).toHaveLength(0);
    port.recv(WELCOME, 'zapd', ID);
    port.recv(PROVIDERS, 'zapd', ID, providers([ID]));
    expect(s.connected).toBe(true);
    expect(s.native).toBe(true);
    expect(s.socket?.kind).toBe('native');
  });

  it('answers a routed command on the same port', async () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    const port = FakePort.last!;
    port.recv(WELCOME, 'zapd', ID);
    const cmd: number[] = [];
    const put = (x: string) => { const b = new TextEncoder().encode(x); cmd.push(b.length & 0xff, b.length >> 8, ...b); };
    put('navigate');
    cmd.push(0, 0);
    port.recv(ROUTE, 'mcp/dgx/hanzo-1', ID, new Uint8Array(cmd));
    await vi.runOnlyPendingTimersAsync();
    expect(dispatched[0][0]).toBe('navigate');
    expect(port.sent.find((f) => f.t === RESPONSE)?.to).toBe('mcp/dgx/hanzo-1');
  });

  it('falls back to the paired door when the browser has no native host', () => {
    const s = paired();
    ensureZap(s, opts());
    FakePort.last!.gone('Specified native messaging host not found.');
    expect(s.native).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0].url).toBe('ws://127.0.0.1:21000/');
  });

  it('joins the door when the host starts and exits before saying anything', () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    FakePort.last!.gone('Native host has exited.');
    expect(s.native).toBe(false);
    expect(FakeSocket.all.at(-1)!.url).toBe('ws://127.0.0.1:9998/');
  });

  it('asks for the host again after the door finds no router, so one installed since joins', () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    const first = FakePort.last!;
    first.gone('Specified native messaging host not found.');
    expect(s.native).toBe(false);
    for (let i = 0; i < 9; i++) FakeSocket.all.at(-1)!.close(); // nothing on any well-known port
    expect(FakeSocket.all).toHaveLength(9);
    expect(s.error).toBe('no-router');
    vi.advanceTimersByTime(250);
    const next = FakePort.last!;
    expect(next).not.toBe(first);
    expect(FakeSocket.all).toHaveLength(9);
    next.recv(WELCOME, 'zapd', ID);
    next.recv(PROVIDERS, 'zapd', ID, providers([ID]));
    expect(s.connected).toBe(true);
    expect(s.socket?.kind).toBe('native');
  });

  it('retries the host when it exits after it was working', () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    const first = FakePort.last!;
    first.recv(WELCOME, 'zapd', ID);
    first.gone();
    expect(s.native).toBe(true);
    expect(s.socket).toBeNull();
    vi.advanceTimersByTime(300);
    expect(FakePort.last).not.toBe(first);
  });
});
