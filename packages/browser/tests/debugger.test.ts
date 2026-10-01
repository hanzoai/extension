// @vitest-environment jsdom
/**
 * Chrome without a debugger.
 *
 * Chromium refuses chrome.debugger.attach on a page that holds another
 * extension's chrome-extension:// frame — a password manager's icon inside an
 * input is enough. Every CDP verb used to die there on a bare "Cannot attach
 * to tab N". Now the reason travels in the error, evaluate and key presses run
 * through scripting.executeScript (shared/script.ts, the path Firefox always
 * takes), and listing tabs never touches the debugger.
 *
 * executeScript is emulated by running the injected function here, against
 * jsdom's document: the code under test is the code the page would run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REFUSED = 'Cannot access a chrome-extension:// URL of different extension';

let attachable = false;
const sent: { method: string; params: any }[] = [];
const injected: { world: string }[] = [];

beforeEach(() => {
  attachable = false;
  sent.length = 0;
  injected.length = 0;
  document.body.innerHTML = '';
  const runtime: any = { lastError: undefined, id: 'test' };
  (globalThis as any).chrome = {
    runtime,
    debugger: {
      onEvent: { addListener() {} },
      onDetach: { addListener() {} },
      attach: vi.fn((_d: unknown, _v: string, cb: () => void) => {
        runtime.lastError = attachable ? undefined : { message: REFUSED };
        cb();
        runtime.lastError = undefined;
      }),
      detach: (_d: unknown, cb: () => void) => cb(),
      sendCommand: (_t: unknown, method: string, params: any, cb: (r: any) => void) => {
        sent.push({ method, params });
        cb(method === 'Runtime.evaluate' ? { result: { type: 'number', value: 2 } } : {});
      },
    },
    scripting: {
      executeScript: vi.fn(async ({ world, func, args }: any) => {
        injected.push({ world });
        return [{ frameId: 0, result: await func(...args) }];
      }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: {
      get: async (id: number) => ({ id, url: 'https://console.cloud.google.com/auth/branding' }),
      query: vi.fn(async (q: any) => (q?.active ? [] : [{ id: 7, url: 'https://console.cloud.google.com/', title: 'Branding', active: true }])),
    },
  };
});

async function bridge() {
  const { CDPBridge } = await import('../src/browser-dispatch.js');
  return new CDPBridge();
}

/** A Material-style chip input: commits on keydown keyCode 13 or 188, cancelling it. */
function chipInput() {
  document.body.innerHTML = '<form id="f"><input id="email"></form>';
  const input = document.getElementById('email') as HTMLInputElement;
  const seen: { type: string; key: string; keyCode: number; which: number; charCode: number }[] = [];
  const chips: string[] = [];
  let submitted = 0;
  for (const type of ['keydown', 'keypress', 'keyup']) {
    input.addEventListener(type, (e) => {
      const k = e as KeyboardEvent;
      seen.push({ type, key: k.key, keyCode: k.keyCode, which: k.which, charCode: k.charCode });
      if (type === 'keydown' && (k.keyCode === 13 || k.keyCode === 188)) {
        chips.push(input.value);
        input.value = '';
        e.preventDefault();
      }
    });
  }
  (document.getElementById('f') as HTMLFormElement).addEventListener('submit', (e) => { submitted++; e.preventDefault(); });
  input.value = 'ops@hanzo.ai';
  input.focus();
  return { seen, chips, submitted: () => submitted };
}

describe('attach refused', () => {
  it('names the reason in the error', async () => {
    const b = await bridge();
    await expect(b.dispatchMethod('Page.getLayoutMetrics', { tabId: 7 }))
      .rejects.toThrow(`Cannot attach to tab 7: ${REFUSED}`);
  });

  it('evaluate falls back to executeScript, MAIN world, CDP-shaped', async () => {
    const b = await bridge();
    document.title = 'Branding';
    const out = await b.dispatchMethod('Runtime.evaluate', { tabId: 7, expression: 'document.title' });
    expect(out).toMatchObject({ result: { type: 'string', value: 'Branding' }, value: 'Branding' });
    expect(out).not.toHaveProperty('exceptionDetails');
    expect(injected[0].world).toBe('MAIN');
    expect(sent).toEqual([]);
  });

  it('evaluate settles an async body and reports a throw as exceptionDetails', async () => {
    const b = await bridge();
    expect(await b.dispatchMethod('Runtime.evaluate', { tabId: 7, code: 'const x = await Promise.resolve(40); x + 2' }))
      .toMatchObject({ value: 42 });
    const bad = await b.dispatchMethod('Runtime.evaluate', { tabId: 7, expression: 'nope.nope' });
    expect(bad.exceptionDetails.text).toMatch(/nope/);
  });

  it("a throw in the caller's code is that throw, not a CSP diagnosis", async () => {
    const b = await bridge();
    const out = await b.dispatchMethod('Runtime.evaluate', { tabId: 7, expression: '({}).track()' });
    expect(out.exceptionDetails.text).toMatch(/track is not a function/);
    expect(out.exceptionDetails.text).not.toMatch(/Content Security/);
    expect(injected).toEqual([{ world: 'MAIN' }]);
  });

  it('a syntax error is the syntax error', async () => {
    const b = await bridge();
    const out = await b.dispatchMethod('Runtime.evaluate', { tabId: 7, expression: 'const a = ;' });
    expect(out.exceptionDetails.text).toMatch(/Unexpected token/);
    expect(out.exceptionDetails.text).not.toMatch(/Content Security/);
  });

  it('a CSP that refuses the string says so, once, in the MAIN world', async () => {
    const b = await bridge();
    const real = globalThis.Function;
    globalThis.Function = (() => { throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed"); }) as any;
    let out: any;
    try {
      out = await b.dispatchMethod('Runtime.evaluate', { tabId: 7, expression: 'document.title' });
    } finally {
      globalThis.Function = real;
    }
    expect(out.exceptionDetails.text).toMatch(/Content Security Policy refuses evaluating a string.*unsafe-eval/);
    expect(injected).toEqual([{ world: 'MAIN' }]);
  });

  it('press Enter dispatches keydown with keyCode 13, and the chip input takes it', async () => {
    const page = chipInput();
    const b = await bridge();
    const out = await b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter' });
    expect(out).toMatchObject({ delivered: true, key: 'Enter', keyCode: 13, prevented: true });
    expect(page.seen[0]).toEqual({ type: 'keydown', key: 'Enter', keyCode: 13, which: 13, charCode: 0 });
    expect(page.chips).toEqual(['ops@hanzo.ai']);
    // Cancelled keydown: no keypress, and the form is not submitted under the chip.
    expect(page.seen.map((e) => e.type)).toEqual(['keydown', 'keyup']);
    expect(page.submitted()).toBe(0);
    expect(injected[0].world).toBe('MAIN');
  });

  it('press_key (Input.dispatchKeyEvent, no type) is a press too: Comma is 188', async () => {
    const page = chipInput();
    const b = await bridge();
    await b.dispatchMethod('Input.dispatchKeyEvent', { tabId: 7, key: ',' });
    expect(page.seen[0]).toMatchObject({ type: 'keydown', key: ',', keyCode: 188, which: 188 });
    expect(page.chips).toEqual(['ops@hanzo.ai']);
  });

  it('a raw keyDown, char, keyUp sequence is one press, and a CDP modifiers bitmask holds', async () => {
    document.body.innerHTML = '<form id="f"><input id="q"></form>';
    const downs: boolean[] = [];
    let submitted = 0;
    const q = document.getElementById('q') as HTMLInputElement;
    q.addEventListener('keydown', (e) => downs.push((e as KeyboardEvent).ctrlKey));
    (document.getElementById('f') as HTMLFormElement).addEventListener('submit', (e) => { submitted++; e.preventDefault(); });
    q.focus();
    const b = await bridge();
    for (const type of ['keyDown', 'char', 'keyUp']) {
      await b.dispatchMethod('Input.dispatchKeyEvent', { tabId: 7, type, key: 'Enter', text: '\r', modifiers: '2' });
    }
    expect(downs).toEqual([true]);
    expect(submitted).toBe(1);
  });

  it('an uncancelled Enter fires keypress with charCode 13 and submits the form', async () => {
    document.body.innerHTML = '<form id="f"><input id="q"></form>';
    const seen: number[] = [];
    let submitted = 0;
    const q = document.getElementById('q') as HTMLInputElement;
    q.addEventListener('keypress', (e) => seen.push((e as KeyboardEvent).charCode));
    (document.getElementById('f') as HTMLFormElement).addEventListener('submit', (e) => { submitted++; e.preventDefault(); });
    const b = await bridge();
    await b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter', selector: '#q' });
    expect(document.activeElement).toBe(q);
    expect(seen).toEqual([13]);
    expect(submitted).toBe(1);
  });
});

describe('tabs', () => {
  it('Target.getTargets lists chrome.tabs and never attaches, even with no active tab', async () => {
    const b = await bridge();
    const out = await b.dispatchMethod('Target.getTargets', {});
    expect(out.targetInfos).toEqual([expect.objectContaining({ targetId: 'tab-7', url: 'https://console.cloud.google.com/' })]);
    expect((globalThis as any).chrome.debugger.attach).not.toHaveBeenCalled();
  });
});

describe('attach allowed', () => {
  it('press is a real CDP keystroke with windowsVirtualKeyCode', async () => {
    attachable = true;
    const b = await bridge();
    await b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter' });
    const keys = sent.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => c.params);
    expect(keys).toEqual([
      expect.objectContaining({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }),
      expect.objectContaining({ type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 }),
    ]);
    expect(injected).toEqual([]);
  });

  it('a press on a selector that cannot take focus fails instead of typing elsewhere', async () => {
    attachable = true;
    document.body.innerHTML = '<input id="other"><div id="plain">x</div>';
    (document.getElementById('other') as HTMLInputElement).focus();
    const b = await bridge();
    await expect(b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter', selector: '#missing' })).rejects.toThrow(/No element matches #missing/);
    await expect(b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter', selector: '[' })).rejects.toThrow(/Bad selector/);
    await expect(b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter', selector: '#plain' })).rejects.toThrow(/did not take focus/);
    expect(sent.filter((c) => c.method === 'Input.dispatchKeyEvent')).toEqual([]);
  });

  it('focus that lands two shadow roots down counts as taken', async () => {
    attachable = true;
    document.body.innerHTML = '<div id="host"></div>';
    const outer = (document.getElementById('host') as HTMLElement).attachShadow({ mode: 'open' });
    outer.innerHTML = '<div id="mid"></div>';
    const inner = (outer.getElementById('mid') as HTMLElement).attachShadow({ mode: 'open' });
    inner.innerHTML = '<input id="deep">';
    const deep = inner.getElementById('deep') as HTMLInputElement;
    (document.getElementById('host') as HTMLElement).focus = () => deep.focus();
    const b = await bridge();
    await b.dispatchMethod('hanzo.press', { tabId: 7, key: 'Enter', selector: '#host' });
    expect(sent.filter((c) => c.method === 'Input.dispatchKeyEvent')).toHaveLength(2);
  });
});
