/**
 * Running code in a tab without a debugger: scripting.executeScript, one way,
 * both browsers.
 *
 * Firefox has no chrome.debugger, so this is how it evaluates and presses keys
 * at all. Chrome drives a tab over CDP and comes here when the debugger cannot
 * attach — which happens on ordinary pages: another extension's
 * chrome-extension:// frame inside the page (a password manager's field icon)
 * makes Chromium refuse the attach outright. Each function takes the API
 * namespace (`chrome` / `browser`), as drive.ts does.
 *
 *   execute  a code string, through a `Function(code)()` trampoline (MAIN world)
 *   call     a real function reference plus serializable args (no eval: CSP-proof)
 *   evaluate Runtime.evaluate semantics, CDP-shaped result
 *   press    one key press, with the legacy keyCode/which a real keystroke carries
 */

import { pickEvaluable, wrapEvaluable } from './evaluable.js';
import { codeOf, legacy, parseKey, text } from './keys.js';

// URLs no extension may script. executeScript returns no frames for these,
// which used to surface as a mystery `{}`; refusing up front names the cause.
const PRIVILEGED = [
  /^about:/i,                     // about:debugging, about:addons, about:config…
  /^moz-extension:/i,             // any extension's own pages
  /^chrome(-extension)?:/i,       // chrome://…, chrome-extension://…
  /^(devtools|edge):/i,
  /^view-source:/i,
  /^resource:/i,
  /^file:/i,                      // local files unless explicit perm granted
];

// Each browser's own extension store blocks extensions by policy; the other
// browser's store is an ordinary site.
const AMO = /^https?:\/\/addons\.mozilla\.org\b/i;
const WEBSTORE = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\b/i;

async function refusePrivileged(api: any, tabId: number): Promise<void> {
  let tab: any;
  try { tab = await api.tabs.get(tabId); } catch { return; }
  // Some Firefox builds redact url for privileged tabs; an empty one is one.
  const url = tab?.url || tab?.pendingUrl || '';
  const store = String(api.runtime?.getURL?.('') ?? '').startsWith('moz-extension:') ? AMO : WEBSTORE;
  if (!url || store.test(url) || PRIVILEGED.some((rx) => rx.test(url))) {
    throw new Error(
      `Cannot run JS in privileged tab ${tabId} (${url || 'url hidden'}). ` +
      `Activate a regular http(s) tab via tabId/tab_id parameter.`,
    );
  }
}

function deadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timeout`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The raw per-frame results of running a code string, in the MAIN world, where
 * page globals are visible. Building the function and calling it fail
 * separately: a page CSP without 'unsafe-eval' refuses the build, and that is
 * reported as such — never a throw from the caller's own code. No ISOLATED
 * retry: MV3 refuses `Function()` there in Chromium and Firefox alike, so
 * strings cannot run on such a page at all; `call` (a function reference) can.
 */
async function trampoline(api: any, tabId: number, code: string): Promise<any[]> {
  if (!api.scripting?.executeScript) throw new Error('scripting.executeScript not available (need MV3 scripting permission)');
  const results = await api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [code],
    func: (codeStr: string) => {
      let f: () => unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        f = Function(codeStr) as () => unknown;
      } catch (e: any) {
        // EvalError is the CSP refusal; a SyntaxError is the caller's own code.
        if (e?.name !== 'EvalError') return { __hanzo_error: e?.message || String(e) };
        return { __hanzo_error: `The page's Content Security Policy refuses evaluating a string (${e.message}). Verbs that inject a function still work: press, click, fill, snapshot.` };
      }
      try {
        return f();
      } catch (e: any) {
        return { __hanzo_error: e?.message || String(e) };
      }
    },
  });
  return Array.isArray(results) ? results.map((r: any) => r?.result) : [results];
}

/**
 * Run a code string (a function body: `return` hands back its value) and
 * return the top frame's result. Throws on a privileged tab, a page-side
 * throw, and an empty result — `undefined` would serialize to `{}` and hide
 * which of those happened.
 */
export async function execute(api: any, tabId: number, code: string, timeoutMs = 10_000): Promise<any> {
  await refusePrivileged(api, tabId);
  // An explicit top-level `return`: the trampoline is `Function(c)()`, so
  // without one the value of an IIFE is discarded and the caller sees {}.
  const wrapped = `
    try {
      var __r = (function() { ${code} })();
      return __r === undefined ? null : __r;
    } catch(__e) {
      return { __hanzo_error: __e.message || String(__e) };
    }
  `;
  const results = await deadline(trampoline(api, tabId, wrapped), timeoutMs, 'executeScript');
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(
      `executeScript returned no frames for tab ${tabId} — page may be ` +
      `privileged, in a process the extension can't access, or unloaded.`,
    );
  }
  // An `undefined` slot means the frame threw outside our try/catch — most
  // often a CSP that refuses Function() in both worlds.
  const result = results[0];
  if (result === undefined) {
    throw new Error(
      `executeScript ran but returned no value (frame errored outside the ` +
      `wrapped try/catch — most often page CSP blocking Function()). Tab ${tabId}.`,
    );
  }
  if (result && typeof result === 'object' && result.__hanzo_error) throw new Error(result.__hanzo_error);
  return result;
}

/**
 * Run a real function in the page with serializable args. No Function() or
 * eval() is built at runtime, so a CSP without 'unsafe-eval' does not stop it.
 * `fn` must be self-contained: executeScript ships its source, not its
 * closure. MAIN world, ISOLATED if MAIN refuses the injection.
 */
export async function call<R = any>(
  api: any,
  tabId: number,
  fn: (...args: any[]) => R,
  args: any[] = [],
  timeoutMs = 10_000,
): Promise<R> {
  await refusePrivileged(api, tabId);
  if (!api.scripting?.executeScript) throw new Error('scripting.executeScript not available (need MV3 scripting permission)');
  const runIn = async (world: 'MAIN' | 'ISOLATED'): Promise<any[]> => {
    const results = await api.scripting.executeScript({ target: { tabId }, world, args, func: fn });
    // The whole InjectionResult ({result, error, frameId}): `error` is how a
    // page-side throw comes back, and dropping it read as a silent null.
    return Array.isArray(results) ? results : [results];
  };
  return deadline((async () => {
    let out: any[];
    try {
      out = await runIn('MAIN');
    } catch {
      out = await runIn('ISOLATED');
    }
    if (!Array.isArray(out) || out.length === 0) {
      throw new Error(`executeScript returned no frames for tab ${tabId} — page may be privileged or unloaded.`);
    }
    const first = out[0] || {};
    if (first.error) throw new Error(`page-side error: ${first.error}`);
    const result = first.result;
    if (result && typeof result === 'object' && (result as any).__hanzo_error) throw new Error((result as any).__hanzo_error);
    return result === undefined ? (null as any) : result;
  })(), timeoutMs, 'executeScript');
}

/**
 * Runtime.evaluate through executeScript. The caller's JS takes every alias
 * and statement form wrapEvaluable accepts; promises settle in the page, since
 * structured clone cannot carry one. The result is CDP-shaped —
 * `{result: {type, value}}` — plus a top-level `value`, and on a throw
 * `exceptionDetails` and `error`, so a CDP caller and a plain one both read it.
 */
export async function evaluate(api: any, tabId: number, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  // 30 s: pages with thousands of nodes routinely need more than 10 s for a
  // first query. `timeout` arrives as a string over ZAP, or null from the MCP schema.
  const timeout = Number(params.timeout) || 30_000;
  const code = `
    return Promise.resolve(${wrapEvaluable(pickEvaluable(params))}).then(function(__v){
      if (__v === undefined || __v === null) return null;
      try { return JSON.parse(JSON.stringify(__v)); } catch(e) { return String(__v); }
    }, function(__e){
      return { __hanzo_error: (__e && __e.message) || String(__e) };
    });
  `;
  let value: unknown = null;
  let error: string | null = null;
  try {
    value = (await execute(api, tabId, code, timeout)) ?? null;
  } catch (e: any) {
    error = e?.message || String(e);
  }
  if (error !== null) {
    return {
      result: { type: 'object', value: null, subtype: 'error', description: error },
      value: null,
      error,
      exceptionDetails: { text: error },
    };
  }
  return { result: { type: value === null || Array.isArray(value) ? 'object' : typeof value, value }, value };
}

/**
 * The page half of a press. Self-contained — executeScript ships its source —
 * so the event fields arrive precomputed from keys.ts. keypress follows only an
 * uncancelled keydown, and Enter in a form's input submits only if nothing
 * cancelled the press: a chip input that takes Enter must not also submit.
 */
function strike(selector: string | null, down: any, typed: any, up: any) {
  let el: any;
  try {
    el = selector ? document.querySelector(selector) : document.activeElement;
  } catch (e: any) {
    return { __hanzo_error: `Bad selector ${selector}: ${e?.message || e}` };
  }
  if (!el && selector) return { __hanzo_error: `No element matches ${selector}` };
  el = el || document.body;
  if (selector) el.focus();
  else while (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  const fire = (type: string, init: any): boolean => {
    const e: any = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
    // The init dict sets the legacy fields in Chromium and Firefox; an
    // engine that drops them gets them as own properties.
    for (const f of ['keyCode', 'which', 'charCode']) {
      if (e[f] !== init[f]) Object.defineProperty(e, f, { get: () => init[f] });
    }
    return el.dispatchEvent(e);
  };
  const go = fire('keydown', down);
  if (go && typed && fire('keypress', typed) && down.key === 'Enter' && el.localName === 'input' && el.form) {
    if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
    else el.form.submit();
  }
  fire('keyup', up);
  return { delivered: true, target: el.tagName, key: down.key, keyCode: down.keyCode, prevented: !go };
}

/**
 * Focus `selector` so real keystrokes land on it. Self-contained, like strike.
 * Errors come back as values: Chromium hands a page-side throw back as a null
 * result with no error, which would read as success.
 */
export function focus(selector: string) {
  let el: any;
  try {
    el = document.querySelector(selector);
  } catch (e: any) {
    return { __hanzo_error: `Bad selector ${selector}: ${e?.message || e}` };
  }
  if (!el) return { __hanzo_error: `No element matches ${selector}` };
  el.focus();
  let active: any = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  // Up from the focused node, across shadow roots, to the element or the top.
  for (let n: any = active; n; n = n.parentNode ?? n.host) if (n === el) return true;
  return { __hanzo_error: `${selector} did not take focus, so keys would land elsewhere` };
}

/**
 * One key press in the page — keydown, keypress when the key types, keyup —
 * on `selector` (focused first) or the focused element. `key` is a
 * KeyboardEvent.key or a chord ("Enter", ",", "Control+a"); `modifiers`
 * ({ctrl, shift, alt, meta}) adds to the chord.
 */
export async function press(api: any, tabId: number, params: Record<string, unknown>): Promise<any> {
  const { key, mods } = parseKey(String(params.key ?? ''), params.modifiers);
  const init = (type: string) => ({ key, code: codeOf(key), ...mods, ...legacy(type, key) });
  const selector = params.selector ? String(params.selector) : null;
  return call(api, tabId, strike, [selector, init('keydown'), text(key, mods) === undefined ? null : init('keypress'), init('keyup')]);
}
