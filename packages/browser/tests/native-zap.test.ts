// The ONE transport had no test at all — which is how a browser provider that
// never registers shipped. These drive `ensureNativeZap` against a fake
// chrome.runtime port that speaks the real zapd frames.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureNativeZap, decodeProviderIds, type NativeZapState } from '../src/shared/native-zap';

const HELLO = 1, WELCOME = 2, PROVIDERS_LIST = 3, PROVIDERS = 4;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function putU16(a: number[], n: number) { a.push(n & 0xff, (n >> 8) & 0xff); }
function putStr(a: number[], s: string) {
  const b = new TextEncoder().encode(s);
  putU16(a, b.length);
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}

/** Encode a PROVIDERS body exactly as zapd's frame.rs does. */
function encodeProviders(ids: string[]): Uint8Array {
  const a: number[] = [];
  putU16(a, ids.length);
  for (const id of ids) {
    putStr(a, id);
    a.push(1);            // role = provider
    putStr(a, 'hanzo');   // brand
    putU16(a, 1);         // caps count
    putStr(a, 'browser.navigate');
  }
  return new Uint8Array(a);
}

interface FakePort {
  sent: any[];
  disconnected: boolean;
  postMessage(m: any): void;
  disconnect(): void;
  onMessage: { addListener(f: (m: any) => void): void };
  onDisconnect: { addListener(f: () => void): void };
  emit(m: any): void;
  drop(): void;
}

function makePort(): FakePort {
  const msg: ((m: any) => void)[] = [];
  const dis: (() => void)[] = [];
  return {
    sent: [],
    disconnected: false,
    postMessage(m: any) {
      if (this.disconnected) throw new Error('port closed');
      this.sent.push(m);
    },
    disconnect() { this.disconnected = true; },
    onMessage: { addListener: (f) => { msg.push(f); } },
    onDisconnect: { addListener: (f) => { dis.push(f); } },
    emit(m: any) { for (const f of msg) f(m); },
    drop() { this.disconnected = true; for (const f of dis) f(); },
  };
}

let ports: FakePort[];

beforeEach(() => {
  ports = [];
  (globalThis as any).chrome = {
    runtime: {
      connectNative: vi.fn(() => { const p = makePort(); ports.push(p); return p; }),
      lastError: undefined,
    },
  };
});

function freshState(): NativeZapState {
  return { connected: false, port: null, providerId: 'browser:chrome/default' };
}
const run = (s: NativeZapState) =>
  ensureNativeZap(s, 'hanzo', ['browser.navigate'], () => null, () => {});

/** Bring a state to the point the router has listed it. */
function register(s: NativeZapState, id = 'browser:chrome/dbc/default') {
  run(s);
  ports[ports.length - 1].emit({ t: WELCOME, from: 'zapd', to: id, payload: '' });
  ports[ports.length - 1].emit({ t: PROVIDERS, from: 'zapd', to: id, payload: b64encode(encodeProviders([id])) });
}

describe('registration handshake', () => {
  it('sends HELLO on the first tick', () => {
    const s = freshState();
    run(s);
    expect(ports).toHaveLength(1);
    expect(ports[0].sent[0]).toMatchObject({ t: HELLO, to: '', from: 'browser:chrome/default' });
  });

  it('adopts the device-stamped id the router names in WELCOME', () => {
    const s = freshState();
    run(s);
    ports[0].emit({ t: WELCOME, from: 'zapd', to: 'browser:chrome/dbc/default', payload: '' });
    expect(s.providerId).toBe('browser:chrome/dbc/default');
  });

  it('a WELCOME alone does NOT mean registered — it asks the registry', () => {
    const s = freshState();
    run(s);
    ports[0].emit({ t: WELCOME, from: 'zapd', to: 'browser:chrome/dbc/default', payload: '' });
    expect(s.connected).toBe(false);
    expect(ports[0].sent.some((m) => m.t === PROVIDERS_LIST)).toBe(true);
  });

  it('is connected only once the router lists it', () => {
    const s = freshState();
    register(s);
    expect(s.connected).toBe(true);
  });

  it('a registry that omits us leaves us disconnected', () => {
    const s = freshState();
    run(s);
    ports[0].emit({ t: WELCOME, from: 'zapd', to: 'browser:chrome/dbc/default', payload: '' });
    ports[0].emit({
      t: PROVIDERS, from: 'zapd', to: 'browser:chrome/dbc/default',
      payload: b64encode(encodeProviders(['browser:firefox/dbc/default'])),
    });
    expect(s.connected).toBe(false);
  });
});

describe('the wedge: an open port the router has forgotten', () => {
  // The measured failure — zapd reported 0 providers for hours while a native
  // host process stayed up and the extension believed it was connected.
  it('notices the router dropped it and re-registers on the live port', () => {
    const s = freshState();
    register(s);
    expect(s.connected).toBe(true);

    // The router evicted us (a racing host took the id, then closed).
    run(s); // probe
    ports[0].emit({
      t: PROVIDERS, from: 'zapd', to: s.providerId,
      payload: b64encode(encodeProviders([])),
    });
    expect(s.connected).toBe(false);

    // The pipe is healthy, so re-register over it rather than churn a host.
    const before = ports[0].sent.length;
    run(s);
    expect(ports).toHaveLength(1);
    expect(ports[0].sent.slice(before).some((m) => m.t === HELLO)).toBe(true);

    // …and once the router lists us again we are back.
    ports[0].emit({
      t: PROVIDERS, from: 'zapd', to: s.providerId,
      payload: b64encode(encodeProviders([s.providerId])),
    });
    expect(s.connected).toBe(true);
  });

  it('replaces a port that is open but deaf', () => {
    const s = freshState();
    register(s);

    run(s);                       // probe sent, no reply — port is deaf
    expect(s.probing).toBe(true);
    run(s);                       // second tick with the probe still outstanding
    expect(ports[0].disconnected).toBe(true);
    expect(ports).toHaveLength(2);
    expect(s.connected).toBe(false);
  });

  it('never leaves two native hosts racing for one provider id', () => {
    const s = freshState();
    run(s);
    run(s);
    run(s);
    const live = ports.filter((p) => !p.disconnected);
    expect(live).toHaveLength(1);
  });
});

describe('disconnect', () => {
  it('clears connected so the next tick reconnects', () => {
    const s = freshState();
    register(s);
    ports[0].drop();
    expect(s.connected).toBe(false);
    expect(s.port).toBeNull();
    run(s);
    expect(ports).toHaveLength(2);
  });

  it('a dead port does not wedge the reconciler', () => {
    const s = freshState();
    register(s);
    ports[0].disconnected = true; // postMessage will now throw
    run(s);
    expect(s.port).toBeNull();
    run(s);
    expect(ports).toHaveLength(2);
  });
});

describe('decodeProviderIds', () => {
  it('round-trips the zapd PROVIDERS body', () => {
    const ids = ['browser:chrome/dbc/default', 'browser:firefox/dbc/default'];
    expect(decodeProviderIds(encodeProviders(ids))).toEqual(ids);
  });

  it('reads an empty registry', () => {
    expect(decodeProviderIds(encodeProviders([]))).toEqual([]);
  });
});
