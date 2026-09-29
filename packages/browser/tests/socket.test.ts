// The extension's one transport, driven against a fake WebSocket whose far end
// speaks the real router: the zapd envelope, the real HMAC-SHA256 pairing
// proof, WELCOME/PROVIDERS as frame.rs encodes them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH, ERROR, HELLO, PROVIDERS, PROVIDERS_LIST, RESPONSE, ROUTE, WELCOME,
  decodeFrame, encodeFrame, ensureZap, newZapState, parsePairing, proof, setPairing,
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
  for (const id of ids) { str(id); a.push(1); str('hanzo'); u16(caps.length); caps.forEach(str); }
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
  it('dials nothing until paired', () => {
    const s = newZapState('browser/chrome-3fa2');
    ensureZap(s, opts());
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(0);
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
    expect(s.connected).toBe(false);

    await ws.recv(WELCOME, 'zapd', ID);
    expect(s.providerId).toBe(ID);
    expect(ws.last(PROVIDERS_LIST)).toBeTruthy();
    await ws.recv(PROVIDERS, 'zapd', ID, providers([ID, 'agent/dgx/hanzo-1']));
    expect(s.connected).toBe(true);
    expect(s.caps).toEqual(['browser.navigate']);
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

  it('unpairing closes the socket and stops the clock', async () => {
    const s = paired();
    const ws = await register(s);
    setPairing(s, null, opts());
    expect(ws.closed).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
