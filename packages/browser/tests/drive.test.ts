/**
 * shared/drive.ts: the background router both browsers share.
 *
 * The fake API runs the injected `func` for real, against this test's global,
 * so what is asserted is the function the browser serializes into the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVE, drive, driveMessage } from '../src/shared/drive.js';

const g = globalThis as any;

function fakeApi(engine: (req: any) => any) {
  const calls: any[] = [];
  const listeners: Array<(id: number, info: any) => void> = [];
  const tab = { id: 7, windowId: 1, active: true, status: 'complete', url: 'https://a.test/', title: 'A' };
  const api = {
    calls,
    tab,
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
      update: vi.fn(async (_id: number, u: any) => {
        if (u.url) {
          tab.status = 'loading';
          setTimeout(() => {
            Object.assign(tab, { status: 'complete', url: u.url, title: 'B' });
            for (const l of [...listeners]) l(7, { status: 'complete' });
          }, 5);
        }
        return tab;
      }),
      onUpdated: {
        addListener: (l: any) => listeners.push(l),
        removeListener: (l: any) => listeners.splice(listeners.indexOf(l), 1),
      },
    },
    scripting: {
      executeScript: vi.fn(async (o: any) => {
        calls.push(o);
        if (o.files) {
          g.__hanzoPage = engine;
          return [{ result: undefined }];
        }
        return [{ result: o.func(...o.args) }];
      }),
    },
  };
  return api;
}

afterEach(() => {
  delete g.__hanzoPage;
});

describe('drive', () => {
  it('injects page.js the first time, then calls the engine in place', async () => {
    const engine = vi.fn((req: any) => ({ ok: true, tree: '- button "Go" [ref=e1]', refs: 1, last: 1, url: 'u', title: 't', seen: req }));
    const api = fakeApi(engine);
    const out = await drive(api, 7, 'hanzo.snapshot', { interactive: 'True', depth: '3', compact: 'false' });
    expect(out).toMatchObject({ tree: '- button "Go" [ref=e1]', refs: 1 });
    expect(out).not.toHaveProperty('last');
    expect(out).not.toHaveProperty('ok');
    expect(api.calls.map((c) => (c.files ? 'files' : 'func'))).toEqual(['func', 'files', 'func']);
    expect(api.calls[1].files).toEqual(['page.js']);
    expect(engine.mock.calls[0][0]).toEqual({ op: 'snapshot', interactive: true, compact: false, depth: 3, urls: false });
    await drive(api, 7, 'hanzo.snapshot', {});
    expect(api.calls.map((c) => (c.files ? 'files' : 'func'))).toEqual(['func', 'files', 'func', 'func']);
    // The tab's highest ref rides along, so the next document starts past it.
    expect(engine.mock.calls[1][0].base).toBe(1);
  });

  it('turns an engine refusal into a thrown error carrying its message', async () => {
    const api = fakeApi(() => ({ ok: false, error: 'Stale ref @e4: its element is no longer in the page. Run snapshot again for fresh refs.' }));
    await expect(drive(api, 7, 'hanzo.act', { op: 'click', selector: '@e4' })).rejects.toThrow(/Stale ref @e4/);
  });

  it('says so when a page cannot be scripted', async () => {
    const api = fakeApi(() => null);
    api.scripting.executeScript.mockImplementation(async (o: any) => (o.files ? [{}] : [{ result: null }]));
    await expect(drive(api, 7, 'hanzo.read', {})).rejects.toThrow(/cannot be scripted/);
  });

  it('passes act params through typed', async () => {
    const engine = vi.fn(() => ({ ok: true, clicked: '@e2 (button "Go")' }));
    const api = fakeApi(engine);
    g.__hanzoPage = engine;
    await drive(api, 7, 'hanzo.act', { op: 'scroll', dx: '0', dy: '400', text: '' });
    expect(engine).toHaveBeenCalledWith({ op: 'scroll', text: '', dx: 0, dy: 400 });
  });

  it('navigate resolves after the load completes', async () => {
    const api = fakeApi(() => ({ ok: true }));
    const out = await drive(api, 7, 'hanzo.navigate', { url: 'https://b.test/' });
    expect(out).toEqual({ url: 'https://b.test/', title: 'B', loaded: true });
  });

  it('wait polls until the condition holds, and times out naming it', async () => {
    let n = 0;
    const api = fakeApi(() => ({ ok: true, met: ++n >= 3 }));
    await expect(drive(api, 7, 'hanzo.wait', { selector: '#done', timeout: '5000' })).resolves.toMatchObject({ met: true });
    expect(n).toBe(3);
    delete g.__hanzoPage;
    const never = fakeApi(() => ({ ok: true, met: false }));
    await expect(drive(never, 7, 'hanzo.wait', { text: 'Welcome', timeout: '250' }))
      .rejects.toThrow(/Timed out after 250ms waiting for text "Welcome" to be visible/);
  });

  it('lists exactly the methods it answers', () => {
    expect([...DRIVE].sort()).toEqual(['hanzo.act', 'hanzo.annotate', 'hanzo.navigate', 'hanzo.read', 'hanzo.snapshot', 'hanzo.wait']);
  });
});

describe('driveMessage', () => {
  const api = { runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` } };

  it('answers the extension\'s own pages through the given dispatcher', async () => {
    const dispatch = vi.fn(async () => ({ tree: 't' }));
    const out = await driveMessage(api, { url: 'chrome-extension://abc/popup.html' }, { method: 'hanzo.snapshot', params: { tabId: 3 } }, dispatch);
    expect(out).toEqual({ success: true, result: { tree: 't' } });
    expect(dispatch).toHaveBeenCalledWith('hanzo.snapshot', { tabId: 3 });
  });

  it('refuses web pages and methods outside the engine', async () => {
    const dispatch = vi.fn();
    expect(await driveMessage(api, { url: 'https://evil.test/' }, { method: 'hanzo.act' }, dispatch))
      .toEqual({ success: false, error: 'drive answers extension pages only' });
    expect(await driveMessage(api, { url: 'chrome-extension://abc/popup.html' }, { method: 'Runtime.evaluate' }, dispatch))
      .toEqual({ success: false, error: 'drive: unknown method Runtime.evaluate' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
