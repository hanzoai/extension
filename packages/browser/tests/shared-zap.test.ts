import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startZap, type ZapStorage } from '../src/shared/zap';

const CODE = `ws://127.0.0.1:21000/#${'07'.repeat(32)}`;

function memory(init: Record<string, any> = {}): ZapStorage & { data: Record<string, any> } {
  const data = { ...init };
  return {
    data,
    async get(keys) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { Object.assign(data, items); },
    async remove(key) { delete data[key]; },
  };
}

const sockets: string[] = [];
class FakeSocket {
  static OPEN = 1;
  binaryType = '';
  constructor(url: string) { sockets.push(url); }
  send() {}
  close() {}
}

function start(storage = memory()) {
  const zap = startZap({ brand: 'hanzo', caps: [], engine: 'chrome', dispatch: () => null, log: () => {}, storage });
  return { zap, storage };
}

function ask(zap: ReturnType<typeof startZap>, action: string, extra: any = {}): Promise<any> {
  return new Promise((resolve) => {
    expect(zap.handle(action, { action, ...extra }, resolve)).toBe(true);
  });
}

beforeEach(() => {
  sockets.length = 0;
  (globalThis as any).WebSocket = FakeSocket;
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).WebSocket;
});

describe('startZap', () => {
  it('mints this install\'s node name once and keeps it', async () => {
    const { zap, storage } = start();
    await vi.waitFor(() => expect(storage.data.zapName).toMatch(/^chrome-[0-9a-f]{4}$/));
    const status = await ask(zap, 'zap.status');
    expect(status.zap.providerId).toBe(`browser/${storage.data.zapName}`);
    const again = start(memory({ zapName: storage.data.zapName }));
    await vi.waitFor(async () => expect((await ask(again.zap, 'zap.status')).zap.providerId).toBe(`browser/${storage.data.zapName}`));
  });

  it('does not dial until paired, and reports itself unpaired', async () => {
    const { zap } = start();
    const status = await ask(zap, 'zap.status');
    expect(status.zap).toMatchObject({ connected: false, paired: false });
    expect(sockets).toEqual([]);
  });

  it('refuses a code that is not one, and says where the code comes from', async () => {
    const { zap, storage } = start();
    const r = await ask(zap, 'zap.pair', { code: 'ws://evil.example:21000/#' + '07'.repeat(32) });
    expect(r.success).toBe(false);
    expect(r.error).toContain('hanzo-mcp pair');
    expect(storage.data.zapPairing).toBeUndefined();
  });

  it('pairs: keeps the code in storage.local and dials the loopback door', async () => {
    const { zap, storage } = start();
    expect((await ask(zap, 'zap.pair', { code: `  ${CODE}\n` })).success).toBe(true);
    expect(storage.data.zapPairing).toBe(CODE);
    // Unpaired at start it knocked on the well-known door; paired, it dials the code's.
    expect(sockets.at(-1)).toBe('ws://127.0.0.1:21000/');
    expect((await ask(zap, 'zap.status')).zap.paired).toBe(true);
  });

  it('a stored pairing dials at start; unpairing forgets it', async () => {
    const { zap, storage } = start(memory({ zapPairing: CODE, zapName: 'chrome-3fa2' }));
    await vi.waitFor(() => expect(sockets).toEqual(['ws://127.0.0.1:21000/']));
    expect((await ask(zap, 'zap.unpair')).success).toBe(true);
    expect(storage.data.zapPairing).toBeUndefined();
    expect((await ask(zap, 'zap.status')).zap.paired).toBe(false);
  });

  it('leaves every other action to the caller', () => {
    const { zap } = start();
    expect(zap.handle('bridge.status', {}, () => {})).toBe(false);
  });
});

describe('the door that answered', () => {
  it('is dialed first after a restart', async () => {
    start(memory({ zapName: 'chrome-3fa2', zapDoor: 21000 }));
    await vi.waitFor(() => expect(sockets[0]).toBe('ws://127.0.0.1:21000/'));
  });
});
