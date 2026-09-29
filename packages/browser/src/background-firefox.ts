/**
 * Firefox-specific Background Script for Hanzo Browser Extension
 *
 * This script connects to the CDP bridge server as a WebSocket CLIENT
 * and handles commands from hanzo-mcp to control the browser.
 *
 * Firefox differences from Chrome:
 * - Uses `browser.*` APIs (with Promises) instead of `chrome.*` (callbacks)
 * - Cannot use ES module exports at top level
 * - Cannot run WebSocket servers, only clients
 * - MV3 109+ uses `browser.scripting.executeScript({world,func,args})`,
 *   NOT the removed MV2 `tabs.executeScript`. See `executeScriptWithTimeout`.
 *
 * The webextension-polyfill import is a no-op on Firefox (browser.* is
 * native) but keeping it as the first import here mirrors the Chrome
 * background's structure and avoids divergence.
 */
import 'webextension-polyfill';

import type { ControlSession, RagSnippet, RagQueryParams } from './shared/types.js';
import { startZap } from './shared/zap.js';
import { fetchAllUsage } from './shared/usage.js';
import { pickEvaluable, wrapEvaluable } from './shared/evaluable.js';
import {
  getRagConfig,
  normalizeRagSnippets,
  queryRagFromEndpoint,
} from './shared/rag.js';
import {
  login as sharedLogin,
  signup as sharedSignup,
  logout as sharedLogout,
  getValidAccessToken as sharedGetValidAccessToken,
  getAuthStatus as sharedGetAuthStatus,
  firefoxAdapter,
  type BrowserAdapter,
} from './shared/auth.js';
import { parseTabId, unwrapEvaluateResult } from './shared/tab-id.js';
import { detail, shrink } from './shared/shrink.js';
import { DRIVE, drive, driveMessage } from './shared/drive.js';

// Declare browser API for TypeScript
declare const browser: typeof chrome;

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const BROWSER_NAME = 'firefox';
const VERSION = typeof browser !== 'undefined' ? browser.runtime.getManifest().version : '0';

// URLs the extension can never run scripts in. browser.scripting.executeScript
// silently returns no frames for these, which used to surface as a mystery
// `{}` to the caller. We detect upfront and raise an actionable error.
const PRIVILEGED_URL_PATTERNS: RegExp[] = [
  /^about:/i,                     // about:debugging, about:addons, about:config…
  /^moz-extension:/i,             // any extension's own pages
  /^chrome:/i,                    // chrome://… (Firefox accepts these too)
  /^view-source:/i,
  /^resource:/i,
  /^file:/i,                      // local files unless explicit perm granted
  /^https?:\/\/addons\.mozilla\.org\b/i, // AMO blocks WebExtensions by policy
];

function isPrivilegedTab(tab: chrome.tabs.Tab | undefined): boolean {
  if (!tab) return false;
  const url = tab.url || (tab as any).pendingUrl || '';
  if (!url) {
    // Some Firefox builds redact url for privileged tabs; treat as privileged.
    return true;
  }
  return PRIVILEGED_URL_PATTERNS.some((rx) => rx.test(url));
}

const controlSession: ControlSession = {
  active: false,
  tabId: null,
  task: null,
  startedAt: null,
};

// The ZAP registration lives at the bottom of the file: it dispatches inbound
// commands through the extension class, so it waits for that instance.

// =============================================================================

class HanzoFirefoxExtension {

  constructor() {
    console.log('[Hanzo] Firefox extension initializing...');
  }

  /**
   * Run JS in a page tab and return its result, with a hard timeout.
   *
   * Firefox MV3 removed `browser.tabs.executeScript` (the string-based
   * MV2 API). The replacement is `browser.scripting.executeScript({...})`
   * which only accepts a function (or files), not a code string. To keep
   * the existing call sites that pass dynamic strings working, we inject
   * a one-line trampoline `(c) => Function(c)()` and forward the user's
   * code as an argument, executing in the page's MAIN world (so the
   * page's own CSP applies and `Function` is allowed on most sites).
   *
   * Falls back to MV2 `tabs.executeScript` on browsers / runtimes that
   * still have it (older Firefox, Chrome MV2 which we don't ship but
   * don't want to break).
   */
  private executeScriptWithTimeout(
    tabId: number,
    code: string,
    timeoutMs: number = 10000
  ): Promise<any[]> {
    const exec: Promise<any[]> = (async () => {
      // MV3 path — preferred on every modern build (Chrome 88+, FF 109+).
      const scripting = (browser as any).scripting;
      if (scripting?.executeScript) {
        const runIn = async (world: 'MAIN' | 'ISOLATED'): Promise<any[]> => {
          const results = await scripting.executeScript({
            target: { tabId },
            world,
            args: [code],
            func: (codeStr: string) => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
                return Function(codeStr)();
              } catch (e: any) {
                return { __hanzo_error: e?.message || String(e) };
              }
            },
          });
          // scripting.executeScript returns an array of {result, frameId}.
          return Array.isArray(results) ? results.map((r: any) => r?.result) : [results];
        };

        // Try MAIN (page CSP applies — see page-internal vars). If the page
        // CSP blocks Function() the inner func returns __hanzo_error;
        // ISOLATED world has its own CSP and almost always allows
        // Function(), so we silently fall back. This rescues e.g. GitHub,
        // Google Docs, banking sites with strict 'script-src self'.
        const main = await runIn('MAIN');
        const blocked = main.length > 0 && main.every((r) =>
          r && typeof r === 'object' && r.__hanzo_error &&
          /CSP|unsafe-eval|Content Security|Function|eval/i.test(String(r.__hanzo_error))
        );
        if (!blocked) return main;
        return runIn('ISOLATED');
      }
      // MV2 fallback — only Firefox <109 reaches this branch.
      const legacy = (browser as any).tabs?.executeScript;
      if (legacy) return legacy.call(browser.tabs, tabId, { code });
      throw new Error('No executeScript API available (need MV3 scripting permission)');
    })();
    return Promise.race([
      exec,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('executeScript timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Resolve the tab ID to operate on. Order of precedence:
   *
   *   1. params.tabId — number, or "tab-NNN" string from getTargets, or "NNN".
   *   2. params.targetId — same as tabId but kept for CDP-style callers.
   *   3. params.tabIndex — index into the current window's tab list.
   *   4. Fall back to the active tab in the current window.
   *
   * Without (1) or (2) the bridge always picks the OS-active tab, which is
   * almost never what an automation client wants when many windows are open.
   */
  private async resolveTab(params: Record<string, unknown>): Promise<chrome.tabs.Tab> {
    const rawId = params.tabId ?? params.targetId;
    if (rawId !== undefined && rawId !== null) {
      const id = parseTabId(rawId);
      if (id !== null) {
        try { return await browser.tabs.get(id); } catch { /* fall through */ }
      }
    }
    if (typeof params.tabIndex === 'number') {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const tab = tabs[params.tabIndex as number];
      if (tab) return tab;
    }
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab) return activeTab;
    throw new Error('No active tab');
  }

  /**
   * Run JS in the page via executeScript and return the serialized result.
   * Bumped to throw on empty/missing results so undefined → {} can no
   * longer hide a privileged-tab or CSP failure (1.9.2).
   */
  private async runInPage(tabId: number, code: string, timeoutMs: number = 10000): Promise<any> {
    // Privileged URLs (about:, moz-extension:, view-source:, …) silently
    // refuse executeScript. Detect upfront with an actionable error rather
    // than letting the caller see a mystery `{}` response.
    let tab: chrome.tabs.Tab | undefined;
    try { tab = await browser.tabs.get(tabId); } catch { /* best-effort */ }
    if (tab && isPrivilegedTab(tab)) {
      throw new Error(
        `Cannot run JS in privileged tab ${tabId} (${tab.url}). ` +
        `Activate a regular http(s) tab via tabId/tab_id parameter.`,
      );
    }

    // Wrap the user's code in a function body that ALWAYS has a top-level
    // `return`. Without this `Function(body)()` discards the IIFE result and
    // hands back undefined → JSON serializes to {} → caller can't tell
    // success from failure. The trampoline we use is `Function(c)()`, so
    // `c` itself must `return` whatever the page produced.
    const wrappedCode = `
      try {
        var __r = (function() { ${code} })();
        return __r === undefined ? null : __r;
      } catch(__e) {
        return { __hanzo_error: __e.message || String(__e) };
      }
    `;
    const results = await this.executeScriptWithTimeout(tabId, wrappedCode, timeoutMs);
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(
        `executeScript returned no frames for tab ${tabId} — page may be ` +
        `privileged, in a process the extension can't access, or unloaded.`,
      );
    }
    // results is the per-frame mapped array of `r?.result`. With world: MAIN
    // an `undefined` slot means a frame errored *outside* our try/catch
    // (typical CSP `script-src 'self'` blocking `Function()`). Surface that
    // explicitly instead of returning a silent `undefined`.
    const result = results[0];
    if (result === undefined) {
      throw new Error(
        `executeScript ran but returned no value (frame errored outside the ` +
        `wrapped try/catch — most often page CSP blocking Function()). Tab ${tabId}.`,
      );
    }
    if (result && typeof result === 'object' && result.__hanzo_error) {
      throw new Error(result.__hanzo_error);
    }
    return result;
  }

  /**
   * CSP-safe alternative to runInPage. Passes a real function reference
   * (and serializable args) to scripting.executeScript. Because no
   * Function() or eval() is constructed at runtime, page CSP that
   * blocks 'unsafe-eval' does NOT block this path. Works on .gov, on
   * sites that ship strict default-src 'self', and on github.com.
   *
   * Use this for any DOM read/write the bridge needs to do. The
   * `fn` argument is a normal JS function — it is serialized by
   * Firefox/Chrome's scripting API and executed in the MAIN world.
   *
   * Added in 1.9.16 alongside the CDP-shaped decomplected surface.
   */
  private async runFunc<R = any>(
    tabId: number,
    fn: (...args: any[]) => R,
    args: any[] = [],
    timeoutMs: number = 10000,
  ): Promise<R> {
    let tab: chrome.tabs.Tab | undefined;
    try { tab = await browser.tabs.get(tabId); } catch { /* best-effort */ }
    if (tab && isPrivilegedTab(tab)) {
      throw new Error(
        `Cannot run JS in privileged tab ${tabId} (${tab.url}).`,
      );
    }
    const scripting = (browser as any).scripting;
    if (!scripting?.executeScript) {
      throw new Error('scripting.executeScript not available (need MV3 scripting permission)');
    }
    const exec = (async () => {
      const runIn = async (world: 'MAIN' | 'ISOLATED'): Promise<any[]> => {
        const results = await scripting.executeScript({
          target: { tabId },
          world,
          args,
          func: fn,
        });
        // Keep the full InjectionResult shape ({result, error, frameId}) so
        // we can propagate page-side throws (1.9.18). Previously we mapped
        // to r?.result which silently dropped errors → callers saw null.
        return Array.isArray(results) ? results : [results];
      };
      let out: any[];
      try {
        out = await runIn('MAIN');
      } catch (e) {
        out = await runIn('ISOLATED');
      }
      if (!Array.isArray(out) || out.length === 0) {
        throw new Error(
          `runFunc returned no frames for tab ${tabId} — page may be privileged or unloaded.`,
        );
      }
      const first = out[0] || {};
      if (first.error) {
        throw new Error(`runFunc page-side error: ${first.error}`);
      }
      const result = first.result;
      if (result && typeof result === 'object' && (result as any).__hanzo_error) {
        throw new Error((result as any).__hanzo_error);
      }
      return result === undefined ? (null as any) : result;
    })();
    return Promise.race([
      exec,
      new Promise<R>((_, reject) => setTimeout(() => reject(new Error('runFunc timeout')), timeoutMs)),
    ]);
  }

  /**
   * Public dispatcher for ZAP-server-initiated requests. Mirrors
   * `CDPBridge.dispatchMethod` on the Chrome side so background-ZAP wiring
   * is symmetric across browsers. Calls into the same canonical
   * ``executeMethod`` switch already used by the legacy WS path.
   */
  async dispatchMethod(method: string, params: Record<string, unknown>): Promise<any> {
    const result = await this.executeMethod(method, params || {});
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      const err: any = new Error(String(result.error));
      throw err;
    }
    return result;
  }

  private async executeMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Resolve tab early — most methods need it
    let tab: chrome.tabs.Tab;
    try {
      tab = await this.resolveTab(params);
    } catch {
      // Some methods don't need a tab
      tab = null as any;
    }
    const tabId: number | undefined = tab?.id ?? undefined;

    // The snapshot → ref engine: the same code Chrome runs (shared/drive.ts).
    if (DRIVE.has(method)) {
      if (!tabId) throw new Error('No active tab');
      return drive(browser, tabId, method, params);
    }

    switch (method) {
      // =====================================================================
      // Target / Tab management
      // =====================================================================
      case 'Target.getTargets': {
        const allTabs = await browser.tabs.query({});
        return {
          targetInfos: allTabs.map(t => ({
            targetId: `tab-${t.id}`,
            type: 'page',
            title: t.title || '',
            url: t.url || ''
          }))
        };
      }

      case 'Target.createTarget': {
        const newTab = await browser.tabs.create({ url: (params.url as string) || 'about:blank' });
        return { targetId: `tab-${newTab.id}`, tabId: newTab.id };
      }

      case 'Target.closeTarget': {
        // Use shared parseTabId for safety: rejects URLs / strings that
        // happen to end with digits (e.g. an ad URL with ?tab=123 in it).
        const closeId = parseTabId(params.targetId ?? params.tabId);
        if (closeId !== null) await browser.tabs.remove(closeId);
        return { success: true };
      }

      case 'Target.activateTarget': {
        const activateId = parseTabId(params.targetId ?? params.tabId);
        if (activateId !== null) await browser.tabs.update(activateId, { active: true });
        return { success: true };
      }

      // =====================================================================
      // Tab info — native APIs, never block on page content
      // =====================================================================
      case 'hanzo.url': {
        return { result: { value: tab?.url || '' } };
      }

      case 'hanzo.title': {
        return { result: { value: tab?.title || '' } };
      }

      case 'hanzo.tabInfo': {
        return {
          result: {
            value: {
              id: tab?.id,
              url: tab?.url,
              title: tab?.title,
              status: tab?.status,
              favIconUrl: tab?.favIconUrl
            }
          }
        };
      }

      case 'hanzo.getTabs':
      case 'hanzo.listTabs': {
        const tabs = await browser.tabs.query({});
        return {
          tabs: tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: t.active
          }))
        };
      }

      case 'hanzo.getHistory': {
        const maxResults = (params.maxResults as number) || 25;
        try {
          const items = await browser.history.search({ text: '', maxResults, startTime: 0 });
          return { history: items.map(h => ({ url: h.url, title: h.title, lastVisitTime: h.lastVisitTime })) };
        } catch {
          return { history: [], error: 'history API not available' };
        }
      }

      // =====================================================================
      // Navigation
      // =====================================================================
      case 'Page.navigate': {
        if (!tabId) throw new Error('No active tab');
        this.notifyOverlay(tabId, 'ai.control.status', { text: `Navigating to ${params.url}` });
        await browser.tabs.update(tabId, { url: params.url as string });
        return { frameId: 'main' };
      }

      case 'Page.reload': {
        if (!tabId) throw new Error('No active tab');
        await browser.tabs.reload(tabId);
        return { success: true };
      }

      case 'Page.goBack': {
        if (!tabId) throw new Error('No active tab');
        await browser.tabs.goBack(tabId);
        return { success: true };
      }

      case 'Page.goForward': {
        if (!tabId) throw new Error('No active tab');
        await browser.tabs.goForward(tabId);
        return { success: true };
      }

      case 'hanzo.waitForNavigation': {
        if (!tabId) throw new Error('No active tab');
        const navTimeout = (params.timeout as number) || 30000;
        return new Promise((resolve) => {
          let done = false;
          const timer = setTimeout(() => {
            if (!done) { done = true; browser.webNavigation.onCompleted.removeListener(onNav); resolve({ success: false, error: 'timeout' }); }
          }, navTimeout);
          function onNav(details: any) {
            if (details.tabId === tabId && details.frameId === 0) {
              done = true; clearTimeout(timer); browser.webNavigation.onCompleted.removeListener(onNav);
              resolve({ success: true, url: details.url });
            }
          }
          browser.webNavigation.onCompleted.addListener(onNav);
        });
      }

      case 'Page.waitForLoadState': {
        if (!tabId) throw new Error('No active tab');
        // Poll tab status until 'complete'
        const loadTimeout = (params.timeout as number) || 30000;
        const start = Date.now();
        while (Date.now() - start < loadTimeout) {
          const t = await browser.tabs.get(tabId);
          if (t.status === 'complete') return { success: true };
          await new Promise(r => setTimeout(r, 200));
        }
        return { success: false, error: 'timeout' };
      }

      // =====================================================================
      // JavaScript evaluation
      // =====================================================================
      case 'Runtime.evaluate':
      case 'evaluate': {
        if (!tabId) throw new Error('No active tab');
        // Default 30s — Porkbun-class pages with 1500+ DOM nodes routinely
        // need more than 10s for first-paint queries. Caller can override.
        const timeout = (params.timeout as number) || 30000;

        // pickEvaluable accepts every code-param alias (expression / code /
        // script / function / js); wrapEvaluable is the ONE cross-browser
        // rule that turns statement bodies (`const b=…; b.click()`) into an
        // async IIFE with the trailing value auto-returned — the previous
        // `return (${code})` wrap was a SyntaxError on any multi-statement
        // body. Always resolve in-page so executeScript's structured-clone
        // serialization sees the settled value, never a Promise; rejections
        // ride the __hanzo_error channel runInPage already throws on.
        const evalCode = `
          return Promise.resolve(${wrapEvaluable(pickEvaluable(params))}).then(function(__v){
            if (__v === undefined || __v === null) return null;
            try { return JSON.parse(JSON.stringify(__v)); } catch(e) { return String(__v); }
          }, function(__e){
            return { __hanzo_error: (__e && __e.message) || String(__e) };
          });
        `;

        let value: unknown;
        let evalError: string | null = null;
        try {
          value = await this.runInPage(tabId, evalCode, timeout);
        } catch (e: any) {
          evalError = e?.message || String(e);
          value = null;
        }

        // CDP-shape: { result: { type, value } } plus a top-level `value`
        // alias for ergonomic callers. Coerce `undefined` → `null` so the
        // JSON-encoded ZAP frame keeps the keys. If evaluation errored,
        // surface CDP-style `exceptionDetails` AND a top-level `error` so
        // both flavors of caller can see what happened.
        const safeValue = value === undefined ? null : value;
        const cdpType = safeValue === null
          ? 'object'
          : Array.isArray(safeValue)
            ? 'object'
            : typeof safeValue;
        const out: Record<string, unknown> = {
          result: { type: cdpType, value: safeValue },
          value: safeValue,
        };
        if (evalError !== null) {
          out.error = evalError;
          out.result = {
            type: 'object',
            value: null,
            subtype: 'error',
            description: evalError,
          };
          out.exceptionDetails = { text: evalError };
        }
        return out;
      }

      // =====================================================================
      // Screenshots
      //
      // Firefox is strict about the captureVisibleTab signature: it wants
      // `(windowId, options)`. The Chrome MV3 polyfill accepted just
      // `(options)` so a lot of cross-browser code passes opts as the first
      // arg, which Firefox interprets as a windowId integer and silently
      // returns the empty string. Resolve the *target* tab's windowId
      // explicitly so the screenshot is always of the right window.
      // =====================================================================
      case 'Page.captureScreenshot':
      case 'hanzo.screenshot': {
        const { format, quality, max } = detail(params);
        const opts: any = { format };
        if (format === 'jpeg') opts.quality = quality;
        // tab is the resolved target (already set via resolveTab at top of
        // executeMethod). If the caller targeted a non-foreground tab we
        // briefly activate it so captureVisibleTab can render it. We
        // restore focus right after.
        let activatedFor: number | null = null;
        let prevActiveId: number | undefined;
        if (tab && !tab.active) {
          const [prev] = await browser.tabs.query({ active: true, windowId: tab.windowId });
          prevActiveId = prev?.id;
          await browser.tabs.update(tab.id!, { active: true });
          activatedFor = tab.id ?? null;
          // Give the tab one tick to actually compose.
          await new Promise(r => setTimeout(r, 50));
        }
        let dataUrl: string;
        try {
          dataUrl = await browser.tabs.captureVisibleTab(tab?.windowId ?? null as any, opts) as unknown as string;
        } finally {
          if (activatedFor !== null && prevActiveId) {
            await browser.tabs.update(prevActiveId, { active: true }).catch(() => {});
          }
        }
        if (!dataUrl) throw new Error('captureVisibleTab returned empty result');
        const raw = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const base64 = await shrink(raw, max, quality, `image/${format}`);
        return { data: base64, format: max > 0 ? 'jpeg' : format, size: base64.length };
      }

      // =====================================================================
      // Accessibility snapshot
      // =====================================================================
      case 'Accessibility.getFullAXTree': {
        if (!tabId) throw new Error('No active tab');
        const tree = await this.runInPage(tabId, `
          function buildTree(el, depth) {
            if (depth > 5 || !el) return null;
            var role = el.getAttribute && el.getAttribute('role') || el.tagName?.toLowerCase() || '';
            var name = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.textContent?.trim()?.slice(0, 80)) || '';
            var node = { role: role, name: name };
            if (el.children && el.children.length > 0 && depth < 5) {
              node.children = [];
              for (var i = 0; i < Math.min(el.children.length, 50); i++) {
                var child = buildTree(el.children[i], depth + 1);
                if (child) node.children.push(child);
              }
            }
            return node;
          }
          return buildTree(document.body, 0);
        `);
        return { tree };
      }

      // =====================================================================
      // Click / Interaction
      // =====================================================================
            case 'hanzo.click': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        this.notifyOverlay(tabId, 'ai.control.highlight', { selector: params.selector as string });
        this.notifyOverlay(tabId, 'ai.control.status', { text: `Clicking ${params.selector}` });
        const result = await this.runFunc<any>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return { clicked: false, reason: 'not-found' };
          try { el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); } catch (e) {}
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const init: MouseEventInit = {
            bubbles: true, cancelable: true, composed: true, view: window,
            button: 0, buttons: 1, clientX: x, clientY: y, screenX: x, screenY: y, detail: 1,
          };
          try {
            el.dispatchEvent(new MouseEvent('mouseover', init));
            el.dispatchEvent(new MouseEvent('mouseenter', init));
            el.dispatchEvent(new MouseEvent('mousemove', init));
            el.dispatchEvent(new MouseEvent('mousedown', init));
            try { el.focus({ preventScroll: true }); } catch (e) {}
            el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
            el.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
            return { clicked: true, tag: el.tagName, x, y, isTrusted: false };
          } catch (e) {
            try { (el as HTMLElement).click(); return { clicked: true, fallback: 'el.click()', isTrusted: false }; }
            catch (e2) { return { clicked: false, error: String(e2) }; }
          }
        }, [params.selector as string]);
        return { success: !!(result && (result as any).clicked), detail: result };
      }

      case 'hanzo.dblclick': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        this.notifyOverlay(tabId, 'ai.control.highlight', { selector: params.selector as string });
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) {
            el.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
          }
        `);
        return { success: true };
      }

      case 'hanzo.hover': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        this.notifyOverlay(tabId, 'ai.control.highlight', { selector: params.selector as string });
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) {
            el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
            el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
            el.dispatchEvent(new MouseEvent('mousemove', {bubbles: true}));
          }
        `);
        return { success: true };
      }

      // =====================================================================
      // Form input
      // =====================================================================
      case 'hanzo.fill': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        this.notifyOverlay(tabId, 'ai.control.highlight', { selector: params.selector as string });
        this.notifyOverlay(tabId, 'ai.control.status', { text: `Filling ${params.selector}` });
        const ok = await this.runFunc<boolean>(tabId, (selector: string, value: string) => {
          const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
          if (!el) return false;
          try { (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); } catch (e) {}
          try { (el as HTMLElement).focus(); } catch (e) {}
          const tag = (el as HTMLElement).tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            // React-compatible: per-tag native setter. Calling
            // HTMLInputElement's setter on a TEXTAREA throws "Illegal
            // invocation" — was the silent failure on SEC TCR (1.9.18 fix).
            let setter: any = null;
            try {
              if (tag === 'TEXTAREA') {
                setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              } else if (tag === 'INPUT') {
                setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              } else if (tag === 'SELECT') {
                setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
              }
            } catch (e) { setter = null; }
            try {
              if (setter) setter.call(el, value);
              else (el as HTMLInputElement).value = value;
            } catch (e) { (el as HTMLInputElement).value = value; }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          if ((el as HTMLElement).isContentEditable) {
            (el as HTMLElement).textContent = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          return false;
        }, [params.selector as string, (params.value as string) || '']);
        return { success: !!ok };
      }

      case 'hanzo.type': {
        if (!tabId) throw new Error('No active tab');
        const text = this.escapeValue(params.text as string || '');
        const typeSel = params.selector ? this.escapeSelector(params.selector as string) : null;
        await this.runInPage(tabId, `
          var el = ${typeSel ? `document.querySelector('${typeSel}')` : 'document.activeElement'};
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            el.focus();
            if (el.isContentEditable) {
              document.execCommand('insertText', false, '${text}');
            } else {
              el.value += '${text}';
              el.dispatchEvent(new Event('input', {bubbles: true}));
            }
          }
        `);
        return { success: true };
      }

      case 'hanzo.clear': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const ok = await this.runFunc<boolean>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, ''); else (el as HTMLInputElement).value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, [params.selector as string]);
        return { success: !!ok };
      }

      case 'hanzo.select': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const optVal = this.escapeValue((params.value as string) || '');
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el && el.tagName === 'SELECT') {
            el.value = '${optVal}';
            el.dispatchEvent(new Event('change', {bubbles: true}));
          }
        `);
        return { success: true };
      }

      case 'hanzo.check': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const ok = await this.runFunc<boolean>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el) return false;
          try { el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); } catch (e) {}
          if (!el.checked) el.click();
          return true;
        }, [params.selector as string]);
        return { success: !!ok };
      }

      case 'hanzo.uncheck': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const ok = await this.runFunc<boolean>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el) return false;
          try { el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); } catch (e) {}
          if (el.checked) el.click();
          return true;
        }, [params.selector as string]);
        return { success: !!ok };
      }

      case 'Input.dispatchKeyEvent': {
        if (!tabId) throw new Error('No active tab');
        const key = (params.key as string) || '';
        const keyType = (params.type as string) || 'keyDown';
        await this.runInPage(tabId, `
          var el = document.activeElement || document.body;
          el.dispatchEvent(new KeyboardEvent('${keyType}', {key: '${this.escapeValue(key)}', bubbles: true}));
          if ('${keyType}' === 'keyDown') {
            el.dispatchEvent(new KeyboardEvent('keypress', {key: '${this.escapeValue(key)}', bubbles: true}));
            el.dispatchEvent(new KeyboardEvent('keyup', {key: '${this.escapeValue(key)}', bubbles: true}));
          }
        `);
        return { success: true };
      }

      // =====================================================================
      // DOM Read
      // =====================================================================
      case 'hanzo.getText': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const text = await this.runFunc<string | null>(tabId, (selector: string) => {
          const el = document.querySelector(selector);
          return el ? (el.textContent || '') : null;
        }, [params.selector as string]);
        return { result: { value: text } };
      }

      case 'hanzo.getHTML': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const outer = params.outer !== false;
        const html = await this.runFunc<string | null>(tabId, (selector: string, useOuter: boolean) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          return useOuter ? el.outerHTML : el.innerHTML;
        }, [params.selector as string, outer]);
        return { result: { value: html } };
      }

      case 'hanzo.getAttribute': {
        if (!tabId || !params.selector || !params.attr) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const attr = this.escapeValue(params.attr as string);
        const val = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          return el ? el.getAttribute('${attr}') : null;
        `);
        return { result: { value: val } };
      }

      case 'hanzo.getElementInfo': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const info = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          return {
            tagName: el.tagName, id: el.id, className: el.className,
            textContent: (el.textContent || '').trim().slice(0, 200),
            value: el.value, type: el.type, href: el.href, src: el.src,
            checked: el.checked, disabled: el.disabled,
            visible: !!(rect.width && rect.height),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        `);
        return { result: { value: info } };
      }

      case 'hanzo.getPageInfo': {
        if (!tabId) throw new Error('No active tab');
        const pageInfo = await this.runInPage(tabId, `
          return {
            title: document.title,
            url: location.href,
            readyState: document.readyState,
            contentType: document.contentType,
            characterSet: document.characterSet,
            documentElement: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
            body: { scrollWidth: document.body?.scrollWidth, scrollHeight: document.body?.scrollHeight },
            viewport: { width: window.innerWidth, height: window.innerHeight }
          };
        `);
        return { result: { value: pageInfo } };
      }

      case 'hanzo.querySelectorAll': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const elements = await this.runFunc<any[]>(tabId, (selector: string, limit: number) => {
          const els = document.querySelectorAll(selector);
          const out: any[] = [];
          const n = Math.min(els.length, limit);
          for (let i = 0; i < n; i++) {
            const el = els[i] as HTMLElement;
            const rect = el.getBoundingClientRect();
            out.push({
              index: i,
              tagName: el.tagName,
              id: el.id || '',
              className: typeof el.className === 'string' ? el.className : '',
              name: el.getAttribute('name') || '',
              type: el.getAttribute('type') || '',
              role: el.getAttribute('role') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              value: (el as HTMLInputElement).value || '',
              href: (el as HTMLAnchorElement).href || '',
              textContent: (el.textContent || '').trim().slice(0, 200),
              visible: !!(rect.width && rect.height),
            });
          }
          return out;
        }, [params.selector as string, (params.limit as number) || 100]);
        return { elements: elements || [] };
      }

      // ─────────────────────────────────────────────────────────────────
      // CDP-shaped decomplected surface (1.9.16+). See dist/API.md for the
      // canonical reference. Three orthogonal layers:
      //   1) Wire transport (JSON over WS/HTTP)
      //   2) CDP-shaped canonical primitives (Page.* DOM.* Input.* ...)
      //   3) hanzo.* ergonomic aliases that compose canonical primitives
      // Every DOM-touching method goes through runFunc → executeScript with
      // a direct function reference. NEVER Function() / eval(). That is what
      // makes them CSP-safe on .gov, github.com, and any strict-CSP SPA.
      // ─────────────────────────────────────────────────────────────────

      case 'Input.dispatchMouseEvent': {
        if (!tabId) throw new Error('No active tab');
        const result = await this.runFunc<any>(tabId, (p: any) => {
          const { type, x, y, button = 0, clickCount = 1, modifiers = 0 } = p;
          const target = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!target) return { delivered: false, reason: 'no element at point' };
          const mods = {
            altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2),
            metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8),
          };
          const init: MouseEventInit = {
            bubbles: true, cancelable: true, view: window,
            button, buttons: type === 'mousePressed' ? 1 : 0,
            clientX: x, clientY: y, screenX: x, screenY: y, detail: clickCount,
            ...mods,
          };
          const map: Record<string, string> = { mouseMoved: 'mousemove', mousePressed: 'mousedown', mouseReleased: 'mouseup' };
          target.dispatchEvent(new MouseEvent(map[type] || type.toLowerCase(), init));
          if (type === 'mousePressed' && clickCount >= 1) {
            target.dispatchEvent(new MouseEvent('click', init));
          }
          return { delivered: true, target: target.tagName, x, y };
        }, [params]);
        return result;
      }

      case 'Input.scrollWheel': {
        if (!tabId) throw new Error('No active tab');
        const result = await this.runFunc<any>(tabId, (p: any) => {
          const { x = 0, y = 0, deltaX = 0, deltaY = 0 } = p;
          const target = (x || y)
            ? (document.elementFromPoint(x, y) as HTMLElement | null)
            : ((document.scrollingElement || document.body) as HTMLElement | null);
          if (!target) return { delivered: false };
          target.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, deltaX, deltaY, clientX: x, clientY: y,
          }));
          if (target === document.scrollingElement || target === document.body) {
            window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' as ScrollBehavior });
          }
          return { delivered: true };
        }, [params]);
        return result;
      }

      case 'Page.printToPDF': {
        if (!tabId) throw new Error('No active tab');
        await this.runFunc<boolean>(tabId, () => { window.print(); return true; }, []);
        return {
          opened: true,
          note: 'Firefox extension cannot programmatically save PDF. ' +
                'For headless PDF export use Page.captureScreenshot with fullPage=true ' +
                'and convert PNG→PDF on the client side.',
        };
      }

      case 'DOM.querySelector': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const element = await this.runFunc<any>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            tagName: el.tagName, id: el.id || '',
            className: typeof el.className === 'string' ? el.className : '',
            textContent: (el.textContent || '').trim().slice(0, 200),
            value: (el as HTMLInputElement).value || '',
            visible: !!(rect.width && rect.height),
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          };
        }, [params.selector as string]);
        return { element };
      }

      case 'DOM.scrollIntoView': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const ok = await this.runFunc<boolean>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return false;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return true;
        }, [params.selector as string]);
        return { success: !!ok };
      }

      case 'DOM.focus': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const ok = await this.runFunc<boolean>(tabId, (selector: string) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return false;
          el.focus();
          return true;
        }, [params.selector as string]);
        return { success: !!ok };
      }

      case 'hanzo.clickByText': {
        if (!tabId || !params.text) throw new Error('No active tab or text');
        const result = await this.runFunc<any>(tabId, (text: string, scope: string) => {
          const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const want = norm(text);
          const tags = scope === 'all'
            ? 'button, a, input[type=button], input[type=submit], input[type=radio], input[type=checkbox], label, [role=button], [role=radio], [role=checkbox], [role=tab], [role=menuitem]'
            : 'button, a, label, [role=button], [role=radio], [role=checkbox], [role=tab], [role=menuitem]';
          const els = Array.from(document.querySelectorAll(tags)) as HTMLElement[];
          const matches = els.filter((el) => {
            const t = norm(el.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '');
            return t === want || t.includes(want);
          });
          const exact = matches.find((el) => norm(el.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '') === want) || matches[0];
          if (!exact) return { clicked: false, candidates: matches.length };
          try { exact.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); } catch (e) {}
          exact.click();
          return { clicked: true, tag: exact.tagName, text: (exact.innerText || (exact as HTMLInputElement).value || '').slice(0, 100) };
        }, [params.text as string, (params.scope as string) || 'default']);
        return result || { clicked: false };
      }

      case 'hanzo.fillByLabel': {
        if (!tabId || !params.label) throw new Error('No active tab or label');
        const result = await this.runFunc<any>(tabId, (labelText: string, value: string) => {
          const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const want = norm(labelText);
          const labels = Array.from(document.querySelectorAll('label')) as HTMLLabelElement[];
          const lbl = labels.find((l) => norm(l.innerText) === want) || labels.find((l) => norm(l.innerText).includes(want));
          let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null = null;
          if (lbl) {
            const forId = lbl.getAttribute('for');
            if (forId) input = document.getElementById(forId) as any;
            if (!input) input = lbl.querySelector('input, textarea, select');
          }
          if (!input) {
            const all = Array.from(document.querySelectorAll('input, textarea, select')) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
            input = all.find((el) =>
              norm(el.getAttribute('aria-label') || '') === want
              || norm(el.getAttribute('placeholder') || '') === want
              || norm(el.getAttribute('name') || '') === want
              || norm(el.getAttribute('id') || '') === want
            ) || null;
          }
          if (!input) return { filled: false };
          try { input.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); } catch (e) {}
          input.focus();
          const tag = input.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA') {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
              || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (setter) setter.call(input, value); else (input as HTMLInputElement).value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { filled: true, name: input.name || input.id };
          }
          if (tag === 'SELECT') {
            (input as HTMLSelectElement).value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { filled: true, name: input.name || input.id };
          }
          return { filled: false };
        }, [params.label as string, (params.value as string) || '']);
        return result || { filled: false };
      }

      case 'hanzo.findByText': {
        if (!tabId || !params.text) throw new Error('Missing text');
        const result = await this.runFunc<any[]>(tabId, (text: string, scope: string, limit: number) => {
          const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const want = norm(text);
          const tagSel = scope === 'all' ? '*' : 'button, a, label, input, select, textarea, [role=button], [role=radio], [role=checkbox], [role=tab], [role=menuitem], h1, h2, h3, h4, h5, h6, p, span, li, td';
          const els = Array.from(document.querySelectorAll(tagSel)) as HTMLElement[];
          const matches: any[] = [];
          for (let i = 0; i < els.length && matches.length < limit; i++) {
            const el = els[i];
            const t = norm(el.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '');
            if (!t) continue;
            if (t === want || t.includes(want)) {
              const rect = el.getBoundingClientRect();
              matches.push({
                index: i, tag: el.tagName,
                id: el.id || '',
                className: typeof el.className === 'string' ? el.className : '',
                text: t.slice(0, 200), exact: t === want,
                rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                visible: !!(rect.width && rect.height),
              });
            }
          }
          matches.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
          return matches;
        }, [params.text as string, (params.scope as string) || 'default', (params.limit as number) || 50]);
        return { matches: result || [] };
      }

      case 'hanzo.listForm': {
        if (!tabId) throw new Error('No active tab');
        const inputs = await this.runFunc<any[]>(tabId, () => {
          const all = Array.from(document.querySelectorAll('input, textarea, select, button, label, [role=radio], [role=checkbox], [role=button]')) as HTMLElement[];
          return all.slice(0, 200).map((el, i) => {
            const rect = el.getBoundingClientRect();
            const lblFor = el.id ? document.querySelector(`label[for="${el.id}"]`) as HTMLElement | null : null;
            return {
              i,
              tag: el.tagName,
              type: el.getAttribute('type') || '',
              name: el.getAttribute('name') || '',
              id: el.id || '',
              role: el.getAttribute('role') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              placeholder: el.getAttribute('placeholder') || '',
              value: (el as HTMLInputElement).value || '',
              checked: !!(el as HTMLInputElement).checked,
              labelText: (lblFor?.innerText || '').trim().slice(0, 200),
              innerText: (el.innerText || '').trim().slice(0, 200),
              visible: !!(rect.width && rect.height),
            };
          });
        }, []);
        return { inputs: inputs || [] };
      }

      case 'hanzo.press': {
        if (!tabId || !params.key) throw new Error('Missing key');
        const result = await this.runFunc<any>(tabId, (key: string, modifiers: any) => {
          const el = (document.activeElement || document.body) as HTMLElement;
          const mods = {
            altKey: !!modifiers?.alt, ctrlKey: !!modifiers?.ctrl,
            metaKey: !!modifiers?.meta, shiftKey: !!modifiers?.shift,
          };
          const keyCodeMap: Record<string, number> = {
            Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
            ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
            Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32,
          };
          const keyCode = keyCodeMap[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
          const init: any = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, ...mods };
          el.dispatchEvent(new KeyboardEvent('keydown', init));
          if (key.length === 1) el.dispatchEvent(new KeyboardEvent('keypress', init));
          el.dispatchEvent(new KeyboardEvent('keyup', init));
          if (key === 'Enter' && el.tagName === 'INPUT') {
            const form = (el as HTMLInputElement).form;
            if (form) { try { (form as any).requestSubmit?.() || form.submit?.(); } catch (e) {} }
          }
          return { delivered: true, target: el.tagName, keyCode };
        }, [params.key as string, params.modifiers || {}]);
        return result;
      }

      case 'hanzo.scroll': {
        if (!tabId) throw new Error('No active tab');
        const result = await this.runFunc<any>(tabId, (target: any, amount: any) => {
          if (target === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return { scrolled: 'top' }; }
          if (target === 'bottom') { window.scrollTo({ top: document.body?.scrollHeight || 0, behavior: 'smooth' }); return { scrolled: 'bottom' }; }
          if (typeof target === 'string' && target) {
            const el = document.querySelector(target) as HTMLElement | null;
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return { scrolled: 'into-view', selector: target }; }
            return { scrolled: null, error: 'selector not found', selector: target };
          }
          if (amount && (amount.x || amount.y)) {
            window.scrollBy({ left: amount.x || 0, top: amount.y || 0, behavior: 'smooth' });
            return { scrolled: 'by', ...amount };
          }
          return { scrolled: null, error: 'no target or amount' };
        }, [params.target || params.selector || null, params.amount || null]);
        return result;
      }

      case 'hanzo.waitForText': {
        if (!tabId || !params.text) throw new Error('Missing text');
        const timeoutMs = (params.timeout as number) || 15000;
        const interval = (params.interval as number) || 250;
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const found = await this.runFunc<boolean>(tabId, (text: string) => {
            const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return norm(document.body?.innerText || '').includes(norm(text));
          }, [params.text as string]);
          if (found) return { found: true, elapsed: Date.now() - start };
          await new Promise((r) => setTimeout(r, interval));
        }
        return { found: false, timedOut: true, elapsed: Date.now() - start };
      }

      case 'hanzo.waitForMutation': {
        if (!tabId || !params.selector) throw new Error('Missing selector');
        const timeoutMs = (params.timeout as number) || 15000;
        const result = await this.runFunc<any>(tabId, (selector: string, timeout: number) => {
          return new Promise((resolve) => {
            const existing = document.querySelector(selector);
            if (existing) { resolve({ found: true, immediate: true }); return; }
            const observer = new MutationObserver(() => {
              const el = document.querySelector(selector);
              if (el) { observer.disconnect(); resolve({ found: true, immediate: false }); }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            setTimeout(() => { observer.disconnect(); resolve({ found: false, timedOut: true }); }, timeout);
          });
        }, [params.selector as string, timeoutMs]);
        return result;
      }

      case 'hanzo.submitForm': {
        if (!tabId) throw new Error('No active tab');
        const result = await this.runFunc<any>(tabId, (hint: string | null) => {
          const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const intents = hint ? [hint] : ['submit', 'continue', 'next', 'save', 'send', 'agree', 'accept', 'ok'];
          const wantList = intents.map(norm);
          const candidates = Array.from(document.querySelectorAll(
            'button, input[type=submit], input[type=button], a[role=button], [role=button], a.btn'
          )) as HTMLElement[];
          for (const want of wantList) {
            for (const c of candidates) {
              const t = norm(c.innerText || (c as HTMLInputElement).value || c.getAttribute('aria-label') || '');
              if (t === want) {
                try { c.scrollIntoView({ block: 'center' }); } catch (e) {}
                c.click();
                return { submitted: true, intent: want, tag: c.tagName, text: t.slice(0, 100), exact: true };
              }
            }
            for (const c of candidates) {
              const t = norm(c.innerText || (c as HTMLInputElement).value || c.getAttribute('aria-label') || '');
              if (t.includes(want)) {
                try { c.scrollIntoView({ block: 'center' }); } catch (e) {}
                c.click();
                return { submitted: true, intent: want, tag: c.tagName, text: t.slice(0, 100), exact: false };
              }
            }
          }
          return { submitted: false, candidates: candidates.length, intents };
        }, [(params.intent as string) || null]);
        return result;
      }

      case 'hanzo.uploadFile': {
        if (!tabId || !params.selector || !params.content || !params.name) {
          throw new Error('Need selector, name, content (base64)');
        }
        const result = await this.runFunc<any>(tabId, (selector: string, name: string, mimeType: string, contentB64: string) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el) return { uploaded: false, error: 'selector not found' };
          if (el.tagName !== 'INPUT' || el.type !== 'file') return { uploaded: false, error: 'not a file input' };
          const binStr = atob(contentB64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
          const file = new File([bytes], name, { type: mimeType });
          const dt = new DataTransfer();
          dt.items.add(file);
          el.files = dt.files;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { uploaded: true, name, size: bytes.byteLength };
        }, [params.selector as string, params.name as string, (params.mimeType as string) || 'application/octet-stream', params.content as string]);
        return result;
      }

      case 'hanzo.dialogAccept': {
        if (!tabId) throw new Error('No active tab');
        await this.runFunc<boolean>(tabId, (acceptText: string) => {
          const W = window as any;
          W.__hanzo_dialogText = acceptText || '';
          W.alert = () => true;
          W.confirm = () => true;
          W.prompt = () => W.__hanzo_dialogText || '';
          return true;
        }, [(params.text as string) || '']);
        return { armed: true };
      }

      case 'hanzo.observe': {
        if (!tabId || !params.name) throw new Error('Missing name');
        await this.runFunc<boolean>(tabId, (name: string, selector: string | null, opts: any) => {
          const W = window as any;
          W.__hanzo_obs = W.__hanzo_obs || {};
          if (W.__hanzo_obs[name]?.observer) W.__hanzo_obs[name].observer.disconnect();
          W.__hanzo_obs[name] = { events: [], observer: null };
          const target = selector ? document.querySelector(selector) : document.documentElement;
          if (!target) return false;
          const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
              W.__hanzo_obs[name].events.push({
                type: m.type,
                target: (m.target as Element)?.tagName || '',
                added: m.addedNodes?.length || 0,
                removed: m.removedNodes?.length || 0,
                attr: m.attributeName || null,
                ts: Date.now(),
              });
              if (W.__hanzo_obs[name].events.length > 500) W.__hanzo_obs[name].events.shift();
            }
          });
          obs.observe(target, opts || { childList: true, subtree: true, attributes: true });
          W.__hanzo_obs[name].observer = obs;
          return true;
        }, [params.name as string, (params.selector as string) || null, params.options || null]);
        return { started: true, name: params.name };
      }

      case 'hanzo.observeRead': {
        if (!tabId || !params.name) throw new Error('Missing name');
        const events = await this.runFunc<any[]>(tabId, (name: string, clear: boolean) => {
          const W = window as any;
          const entry = W.__hanzo_obs?.[name];
          if (!entry) return [];
          const out = entry.events.slice();
          if (clear !== false) entry.events.length = 0;
          return out;
        }, [params.name as string, params.clear !== false]);
        return { events: events || [] };
      }

      case 'hanzo.observeStop': {
        if (!tabId || !params.name) throw new Error('Missing name');
        await this.runFunc<boolean>(tabId, (name: string) => {
          const W = window as any;
          const entry = W.__hanzo_obs?.[name];
          if (entry?.observer) entry.observer.disconnect();
          if (W.__hanzo_obs) delete W.__hanzo_obs[name];
          return true;
        }, [params.name as string]);
        return { stopped: true, name: params.name };
      }

      case 'hanzo.getComputedStyles': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const props = (params.properties as string[]) || ['display', 'visibility', 'opacity', 'position', 'color', 'backgroundColor', 'fontSize'];
        const propsStr = JSON.stringify(props);
        const styles = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (!el) return null;
          var cs = window.getComputedStyle(el);
          var props = ${propsStr};
          var result = {};
          props.forEach(function(p) { result[p] = cs.getPropertyValue(p) || cs[p]; });
          return result;
        `);
        return { result: { value: styles } };
      }

      case 'hanzo.getBoundingRects': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const rects = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
        `);
        return { result: { value: rects } };
      }

      // =====================================================================
      // DOM Write
      // =====================================================================
      case 'hanzo.setText': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const txt = this.escapeValue((params.text as string) || '');
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.textContent = '${txt}';
        `);
        return { success: true };
      }

      case 'hanzo.setHTML': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const html = this.escapeValue((params.html as string) || '');
        const outer = params.outer === true;
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) ${outer ? `el.outerHTML = '${html}'` : `el.innerHTML = '${html}'`};
        `);
        return { success: true };
      }

      case 'hanzo.setAttribute': {
        if (!tabId || !params.selector || !params.attr) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const attr = this.escapeValue(params.attr as string);
        const val = this.escapeValue((params.value as string) || '');
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.setAttribute('${attr}', '${val}');
        `);
        return { success: true };
      }

      case 'hanzo.removeAttribute': {
        if (!tabId || !params.selector || !params.attr) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const attr = this.escapeValue(params.attr as string);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.removeAttribute('${attr}');
        `);
        return { success: true };
      }

      case 'hanzo.setStyle': {
        if (!tabId || !params.selector || !params.styles) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const stylesJson = JSON.stringify(params.styles);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) {
            var styles = ${stylesJson};
            for (var k in styles) { if (styles.hasOwnProperty(k)) el.style[k] = styles[k]; }
          }
        `);
        return { success: true };
      }

      case 'hanzo.addClass': {
        if (!tabId || !params.selector || !params.classNames) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const classes = Array.isArray(params.classNames) ? params.classNames : [(params.classNames as string)];
        const classesJson = JSON.stringify(classes);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.classList.add.apply(el.classList, ${classesJson});
        `);
        return { success: true };
      }

      case 'hanzo.removeClass': {
        if (!tabId || !params.selector || !params.classNames) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const classes = Array.isArray(params.classNames) ? params.classNames : [(params.classNames as string)];
        const classesJson = JSON.stringify(classes);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.classList.remove.apply(el.classList, ${classesJson});
        `);
        return { success: true };
      }

      case 'hanzo.insertElement': {
        if (!tabId || !params.selector || !params.html) throw new Error('Missing params');
        const sel = this.escapeSelector(params.selector as string);
        const html = this.escapeValue(params.html as string);
        const position = (params.position as string) || 'beforeend';
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.insertAdjacentHTML('${position}', '${html}');
        `);
        return { success: true };
      }

      case 'hanzo.removeElement': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) el.remove();
        `);
        return { success: true };
      }

      // =====================================================================
      // DOM Observation
      // =====================================================================
      case 'hanzo.observeMutations': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const duration = (params.duration as number) || 3000;
        const mutations = await this.runInPage(tabId, `
          return new Promise(function(resolve) {
            var el = document.querySelector('${sel}') || document.body;
            var records = [];
            var obs = new MutationObserver(function(muts) {
              muts.forEach(function(m) {
                records.push({
                  type: m.type,
                  target: m.target.tagName + (m.target.id ? '#' + m.target.id : ''),
                  addedNodes: m.addedNodes.length,
                  removedNodes: m.removedNodes.length,
                  attributeName: m.attributeName
                });
              });
            });
            obs.observe(el, { childList: true, attributes: true, subtree: true, characterData: true });
            setTimeout(function() { obs.disconnect(); resolve(records.slice(0, 50)); }, ${Math.min(duration, 10000)});
          });
        `, duration + 2000);
        return { mutations: mutations || [] };
      }

      // =====================================================================
      // Wait for selector
      // =====================================================================
      case 'hanzo.waitForSelector': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const waitTimeout = (params.timeout as number) || 10000;
        const found = await this.runInPage(tabId, `
          return new Promise(function(resolve) {
            var el = document.querySelector('${sel}');
            if (el) { resolve(true); return; }
            var obs = new MutationObserver(function() {
              var el = document.querySelector('${sel}');
              if (el) { obs.disconnect(); resolve(true); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(function() { obs.disconnect(); resolve(false); }, ${Math.min(waitTimeout, 30000)});
          });
        `, waitTimeout + 2000);
        return { found: !!found };
      }

      // =====================================================================
      // Inject script / CSS
      // =====================================================================
      case 'hanzo.injectScript': {
        if (!tabId || !params.url) throw new Error('No active tab or url');
        const scriptUrl = this.escapeValue(params.url as string);
        await this.runInPage(tabId, `
          return new Promise(function(resolve) {
            var s = document.createElement('script');
            s.src = '${scriptUrl}';
            s.onload = function() { resolve(true); };
            s.onerror = function() { resolve(false); };
            document.head.appendChild(s);
          });
        `, 15000);
        return { success: true };
      }

      case 'hanzo.injectCSS': {
        if (!tabId || !params.css) throw new Error('No active tab or css');
        const css = this.escapeValue(params.css as string);
        await this.runInPage(tabId, `
          var style = document.createElement('style');
          style.textContent = '${css}';
          document.head.appendChild(style);
        `);
        return { success: true };
      }

      // =====================================================================
      // Storage / Cookies
      // =====================================================================
      case 'hanzo.getLocalStorage': {
        if (!tabId) throw new Error('No active tab');
        const key = params.key ? this.escapeValue(params.key as string) : null;
        const storageVal = await this.runInPage(tabId, key
          ? `return localStorage.getItem('${key}');`
          : `
            var result = {};
            for (var i = 0; i < localStorage.length; i++) {
              var k = localStorage.key(i);
              result[k] = localStorage.getItem(k);
            }
            return result;
          `
        );
        return { result: { value: storageVal } };
      }

      case 'hanzo.setLocalStorage': {
        if (!tabId || !params.key) throw new Error('No active tab or key');
        const key = this.escapeValue(params.key as string);
        const val = this.escapeValue((params.value as string) || '');
        await this.runInPage(tabId, `localStorage.setItem('${key}', '${val}');`);
        return { success: true };
      }

      case 'hanzo.getCookies': {
        try {
          const url = tab?.url || '';
          const cookies = await browser.cookies.getAll({ url });
          return { cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly })) };
        } catch {
          return { cookies: [], error: 'cookies API not available' };
        }
      }

      // =====================================================================
      // Fetch through page context (uses page cookies/auth)
      // =====================================================================
      case 'hanzo.fetch': {
        if (!tabId || !params.url) throw new Error('No active tab or url');
        const fetchUrl = this.escapeValue(params.url as string);
        const fetchOpts = params.options || {};
        const optsJson = JSON.stringify(fetchOpts);
        const fetchResult = await this.runInPage(tabId, `
          return fetch('${fetchUrl}', ${optsJson}).then(function(r) {
            return r.text().then(function(body) {
              return { status: r.status, statusText: r.statusText, ok: r.ok, body: body.slice(0, 50000) };
            });
          });
        `, 30000);
        return fetchResult || { error: 'fetch failed' };
      }

      // =====================================================================
      // Control session
      // =====================================================================
      case 'hanzo.control.start': {
        const targetTabId = await this.resolveControlTabId(params.tabId as number | undefined);
        if (targetTabId) {
          await this.startControlSession(targetTabId, params.task as string | undefined);
          return { success: true };
        }
        throw new Error('No active tab');
      }

      case 'hanzo.control.stop': {
        await this.stopControlSession();
        return { success: true };
      }

      // =====================================================================
      // Browser info
      // =====================================================================
      case 'Browser.getVersion': {
        return {
          protocolVersion: '1.3',
          product: 'Hanzo Firefox Extension',
          userAgent: navigator.userAgent
        };
      }

      default:
        console.warn('[Hanzo] Unknown method:', method);
        return { error: `Unknown method: ${method}` };
    }
  }

  /**
   * Handle extension-request messages (monitor, audit, ollama, hub, etc.)
   * These are routed via sendToExtension() from the CDP bridge.
   */
  private async handleExtensionRequest(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const tabId = params.tabId as number | undefined || (await this.getActiveTabId()) || undefined;

    // Console / Network monitoring
    if (action.startsWith('monitor.')) {
      if (!tabId) return { error: 'No active tab for monitoring' };
      switch (action) {
        case 'monitor.consoleLogs':
          return this.runInPage(tabId, `
            return (window.__hanzo_console_logs || []).slice(-50);
          `).then(logs => ({ logs: logs || [] })).catch(() => ({ logs: [] }));

        case 'monitor.consoleErrors':
          return this.runInPage(tabId, `
            return (window.__hanzo_console_errors || []).slice(-50);
          `).then(errors => ({ errors: errors || [] })).catch(() => ({ errors: [] }));

        case 'monitor.networkLogs':
        case 'monitor.networkErrors':
        case 'monitor.networkSuccess':
          return { logs: [], note: 'Network monitoring requires devtools API (not available in MV3 extensions)' };

        case 'monitor.wipeLogs':
          return this.runInPage(tabId, `
            window.__hanzo_console_logs = [];
            window.__hanzo_console_errors = [];
          `).then(() => ({ success: true })).catch(() => ({ success: false }));

        case 'monitor.start':
          return this.runInPage(tabId, `
            if (!window.__hanzo_monitor_active) {
              window.__hanzo_console_logs = [];
              window.__hanzo_console_errors = [];
              var origLog = console.log, origErr = console.error, origWarn = console.warn;
              console.log = function() { window.__hanzo_console_logs.push({type:'log', args: Array.from(arguments).map(String), ts: Date.now()}); origLog.apply(console, arguments); };
              console.error = function() { window.__hanzo_console_errors.push({type:'error', args: Array.from(arguments).map(String), ts: Date.now()}); origErr.apply(console, arguments); };
              console.warn = function() { window.__hanzo_console_logs.push({type:'warn', args: Array.from(arguments).map(String), ts: Date.now()}); origWarn.apply(console, arguments); };
              window.__hanzo_monitor_active = true;
            }
          `).then(() => ({ success: true })).catch(() => ({ success: false }));

        case 'monitor.stop':
          return { success: true };

        case 'monitor.status':
          return { active: false };

        default:
          return { error: `Unknown monitor action: ${action}` };
      }
    }

    // Audit actions — run lightweight checks via page JS
    if (action.startsWith('audit.')) {
      if (!tabId) return { error: 'No active tab for audit' };
      switch (action) {
        case 'audit.accessibility':
          return this.runInPage(tabId, `
            var issues = [];
            document.querySelectorAll('img').forEach(function(img) { if (!img.alt) issues.push({type:'missing-alt', el:img.tagName, src:img.src?.slice(0,80)}); });
            document.querySelectorAll('a').forEach(function(a) { if (!a.textContent?.trim() && !a.getAttribute('aria-label')) issues.push({type:'empty-link', href:a.href?.slice(0,80)}); });
            document.querySelectorAll('input,textarea,select').forEach(function(el) {
              if (!el.getAttribute('aria-label') && !el.labels?.length && !el.placeholder) issues.push({type:'unlabeled-input', name:el.name, id:el.id});
            });
            return { issues: issues.slice(0, 50), total: issues.length };
          `).then(r => ({ audit: r })).catch(e => ({ error: e.message }));

        case 'audit.performance':
          return this.runInPage(tabId, `
            var p = performance;
            var nav = p.getEntriesByType('navigation')[0] || {};
            return {
              domContentLoaded: nav.domContentLoadedEventEnd,
              load: nav.loadEventEnd,
              resources: p.getEntriesByType('resource').length,
              domNodes: document.querySelectorAll('*').length
            };
          `).then(r => ({ audit: r })).catch(e => ({ error: e.message }));

        case 'audit.seo':
          return this.runInPage(tabId, `
            return {
              title: document.title,
              metaDescription: document.querySelector('meta[name="description"]')?.content || null,
              h1Count: document.querySelectorAll('h1').length,
              canonical: document.querySelector('link[rel="canonical"]')?.href || null,
              ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
              ogDescription: document.querySelector('meta[property="og:description"]')?.content || null
            };
          `).then(r => ({ audit: r })).catch(e => ({ error: e.message }));

        default:
          return { error: `Audit type not implemented: ${action}` };
      }
    }

    // Debugger
    if (action === 'debugger.mode') {
      return { error: 'Debugger mode requires devtools API (not available in MV3)' };
    }

    // Ollama / Local LLM — not yet implemented in Firefox
    if (action.startsWith('ollama.') || action.startsWith('local.') || action.startsWith('hub.')) {
      return { error: `${action} not yet implemented in Firefox extension` };
    }

    // ─────────────────────────────────────────────────────────────────
    // 1.9.17: fall back to the canonical executeMethod dispatcher.
    // Without this, HTTP-API callers using {action: "hanzo.scroll", ...}
    // silently failed because handleExtensionRequest only handled
    // monitor.*/audit.* — every Page.* / DOM.* / Input.* / hanzo.* method
    // fell off the end. The canonical dispatcher (executeMethod) holds
    // the full CDP-shaped surface added in 1.9.16+.
    // ─────────────────────────────────────────────────────────────────
    try {
      return await this.executeMethod(action, params || {});
    } catch (e: any) {
      return { error: (e && e.message) || String(e) };
    }
  }

  private notifyOverlay(tabId: number, action: string, data: Record<string, unknown>): void {
    browser.tabs.sendMessage(tabId, { action, ...data }).catch(() => {});
  }

  async getActiveTabId(): Promise<number | null> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  }

  async resolveControlTabId(tabId?: number): Promise<number | null> {
    if (typeof tabId === 'number') return tabId;
    if (controlSession.active && controlSession.tabId !== null) return controlSession.tabId;
    return this.getActiveTabId();
  }

  async startControlSession(tabId: number, task?: string): Promise<void> {
    if (controlSession.active && controlSession.tabId !== null && controlSession.tabId !== tabId) {
      this.notifyOverlay(controlSession.tabId, 'ai.control.stop', {});
    }
    controlSession.active = true;
    controlSession.tabId = tabId;
    controlSession.task = task || 'AI is controlling this page';
    controlSession.startedAt = Date.now();
    this.notifyOverlay(tabId, 'ai.control.start', { task: controlSession.task });
  }

  async stopControlSession(): Promise<void> {
    if (controlSession.active && controlSession.tabId !== null) {
      this.notifyOverlay(controlSession.tabId, 'ai.control.stop', {});
    }
    controlSession.active = false;
    controlSession.tabId = null;
    controlSession.task = null;
    controlSession.startedAt = null;
  }

  private escapeSelector(selector: string): string {
    return selector.replace(/'/g, "\\'");
  }

  private escapeValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n');
  }

}

// =============================================================================
// Auth + Chat Message Handlers (Firefox)
// Uses browser.identity.launchWebAuthFlow for OAuth
// =============================================================================

// Config from shared module (single source of truth)
import {
  IAM_LOGIN_URL as IAM_LOGIN,
  IAM_API_URL as IAM_API,
  IAM_API_PATH,
  API_BASE_URL as API_BASE,
  STORAGE_KEYS,
  LOCAL_PROVIDER_DEFAULTS,
} from './shared/config.js';

// Hanzo convention: api.hanzo.ai/v1/<service>/<endpoint>. Never `/api/`.
// Use IAM_V1 everywhere instead of `${IAM_API}/api/...`.
const IAM_V1 = `${IAM_API}${IAM_API_PATH}`;

// Auth: all PKCE, token storage, and IAM logic lives in shared/auth.ts
const ffAdapter: BrowserAdapter = firefoxAdapter();

async function getValidAccessToken(): Promise<string | null> {
  return sharedGetValidAccessToken(ffAdapter.storage);
}

// =============================================================================
// Message Handler
// =============================================================================

browser.runtime.onMessage.addListener((request: any, sender: any, sendResponse: (r: any) => void) => {
  (async () => {
    // --- ZAP Protocol (handled by shared module) ---
    if (typeof request.action === 'string' && zap.handle(request.action, request, sendResponse)) {
      return;
    }

    switch (request.action) {
      // Snapshot → ref engine, for the extension's own pages
      case 'drive':
        sendResponse(await driveMessage(browser, sender, request, (m, p) => hanzoExtension.dispatchMethod(m, p)));
        break;

      // =======================================================================
      // Auth (Hanzo IAM OAuth2 + PKCE)
      // =======================================================================
      case 'auth.login':
        try {
          const user = await sharedLogin(ffAdapter);
          sendResponse({ success: true, user });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;

      case 'auth.signup':
        try {
          await sharedSignup(ffAdapter);
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;

      case 'auth.logout':
        await sharedLogout(ffAdapter.storage);
        sendResponse({ success: true });
        break;

      case 'auth.status': {
        const status = await sharedGetAuthStatus(ffAdapter.storage);
        sendResponse({
          success: true,
          authenticated: status.authenticated,
          user: status.user,
        });
        break;
      }

      case 'auth.getToken': {
        const r = await browser.storage.local.get([STORAGE_KEYS.accessToken]);
        sendResponse({ success: !!r[STORAGE_KEYS.accessToken], token: r[STORAGE_KEYS.accessToken] || null });
        break;
      }

      // =======================================================================
      // RAG (uses shared module — now with ZAP memory support)
      // =======================================================================
      case 'rag.query': {
        try {
          const config = await getRagConfig(browser.storage.local);
          const topKInput = Number.parseInt(String(request.topK ?? config.topK), 10);
          const params: RagQueryParams = {
            query: String(request.query || '').trim(),
            topK: Number.isFinite(topKInput) ? Math.max(1, Math.min(topKInput, 20)) : 5,
            knowledgeBase: String(request.knowledgeBase ?? config.knowledgeBase ?? '').trim(),
            includeTabContext: request.includeTabContext !== undefined
              ? !!request.includeTabContext
              : config.includeTabContext,
            endpoint: String(request.endpoint ?? config.endpoint ?? '').trim(),
            apiKey: String(request.apiKey ?? config.apiKey ?? '').trim(),
            pageContext: request.pageContext && typeof request.pageContext === 'object'
              ? {
                  url: request.pageContext.url ? String(request.pageContext.url) : undefined,
                  title: request.pageContext.title ? String(request.pageContext.title) : undefined,
                }
              : undefined,
          };

          if (!params.query) {
            sendResponse({ success: false, error: 'Query is required' });
            break;
          }

          const snippets = params.endpoint ? await queryRagFromEndpoint(params) : [];
          const source = snippets.length ? 'rag-endpoint' : 'none';

          sendResponse({
            success: true,
            source,
            snippets: snippets.slice(0, params.topK),
          });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Cloud Chat
      // =======================================================================
      case 'chat.listModels': {
        try {
          const token = await getValidAccessToken();
          if (!token) { sendResponse({ success: false, error: 'Not authenticated' }); break; }
          const resp = await fetch(`${API_BASE}/v1/models`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
          });
          const data = await resp.json();
          sendResponse({ success: true, models: data.data || data.models || data || [] });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'chat.complete': {
        try {
          const token = await getValidAccessToken();
          if (!token) { sendResponse({ success: false, error: 'Not authenticated' }); break; }

          const messages = (Array.isArray(request.messages) ? request.messages : [])
            .filter((m: any) => m && typeof m.content === 'string' && typeof m.role === 'string')
            .map((m: any) => ({
              role: (m.role === 'system' || m.role === 'assistant') ? m.role : 'user',
              content: String(m.content),
            }));
          if (!messages.length) { sendResponse({ success: false, error: 'messages are required' }); break; }

          const model = String(request.model || 'auto');
          const body: any = { model, messages, stream: false };
          if (typeof request.temperature === 'number') body.temperature = request.temperature;
          if (typeof request.max_tokens === 'number') body.max_tokens = Math.max(64, Math.min(request.max_tokens, 16384));

          const resp = await fetch(`${API_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
          });
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Chat API error ${resp.status}: ${text}`);
          }
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || '';
          sendResponse({ success: true, content, model: data.model || model });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'chat.cancel':
        sendResponse({ success: true });
        break;

      // =======================================================================
      // Models
      // =======================================================================
      case 'models.list': {
        try {
          const token = await getValidAccessToken();
          if (!token) {
            // Not authenticated — try public model list from API
            try {
              const pubResp = await fetch(`${API_BASE}/v1/models`, { signal: AbortSignal.timeout(5000) });
              const pubData = await pubResp.json();
              sendResponse({ success: true, models: pubData.data || [], authenticated: false });
            } catch {
              sendResponse({ success: true, models: [], authenticated: false });
            }
            break;
          }
          const resp = await fetch(`${API_BASE}/v1/models`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
          });
          const data = await resp.json();
          sendResponse({ success: true, models: data.data || data.models || [], authenticated: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // WebGPU / Local AI
      // =======================================================================
      case 'checkWebGPU': {
        try {
          if (typeof navigator === 'undefined' || !navigator.gpu) {
            sendResponse({ available: false });
            break;
          }
          const adapter = await navigator.gpu.requestAdapter();
          sendResponse({
            available: !!adapter,
            adapter: (adapter as any)?.name || 'Unknown GPU',
            models: [],
          });
        } catch {
          sendResponse({ available: false });
        }
        break;
      }

      case 'runLocalAI':
        sendResponse({ success: false, error: 'WebGPU inference not available in Firefox background' });
        break;

      case 'listAgents':
        sendResponse({ success: true, agents: [] });
        break;

      case 'stopAgent':
        sendResponse({ success: false, error: 'Agent workers are not available in Firefox background mode' });
        break;

      case 'launchAIWorker':
        sendResponse({ success: false, error: 'launchAIWorker not implemented in Firefox background mode' });
        break;

      // =======================================================================
      // Ollama / Local LLM (portable — pure HTTP)
      // =======================================================================
      case 'ollama.discover': {
        try {
          const urls = ['http://localhost:11434', 'http://127.0.0.1:11434'];
          let found = false;
          let ollamaUrl = '';
          for (const u of urls) {
            try {
              const resp = await fetch(u, { signal: AbortSignal.timeout(2000) });
              if (resp.ok) { found = true; ollamaUrl = u; break; }
            } catch { /* next */ }
          }
          sendResponse({ success: true, discovered: found, url: ollamaUrl, available: found });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'ollama.health': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
          sendResponse({ success: true, available: resp.ok, url });
        } catch (e: any) {
          sendResponse({ success: false, available: false, error: e.message });
        }
        break;
      }

      case 'ollama.models': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          sendResponse({ success: true, models: data.models || [] });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'ollama.chat': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          const resp = await fetch(`${url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: request.model,
              messages: request.messages,
              stream: false,
              ...(request.options || {}),
            }),
            signal: AbortSignal.timeout(120000),
          });
          if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
          const data = await resp.json();
          sendResponse({ success: true, content: data.message?.content || '' });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'ollama.generate': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          const resp = await fetch(`${url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: request.model,
              prompt: request.prompt,
              stream: false,
              ...(request.options || {}),
            }),
            signal: AbortSignal.timeout(120000),
          });
          if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
          const data = await resp.json();
          sendResponse({ success: true, content: data.response || '' });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'ollama.embed': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          const resp = await fetch(`${url}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: request.model, prompt: request.input }),
            signal: AbortSignal.timeout(30000),
          });
          if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
          const data = await resp.json();
          sendResponse({ success: true, embedding: data.embedding || [] });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'ollama.status': {
        const stored = await browser.storage.local.get(['ollamaUrl']);
        sendResponse({ success: true, url: stored.ollamaUrl || 'http://localhost:11434', available: false });
        break;
      }

      case 'ollama.setUrl': {
        await browser.storage.local.set({ ollamaUrl: request.url });
        sendResponse({ success: true });
        break;
      }

      case 'ollama.pull': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          // Start pull — non-streaming for simplicity in Firefox
          fetch(`${url}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: request.model, stream: false }),
          }).then(() => {
            browser.storage.local.set({ 'ollama.pull.progress': { model: request.model, status: 'done', timestamp: Date.now() } });
          }).catch((e: any) => {
            browser.storage.local.set({ 'ollama.pull.progress': { model: request.model, status: 'error', error: e.message, timestamp: Date.now() } });
          });
          sendResponse({ success: true, started: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'ollama.delete': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          await fetch(`${url}/api/delete`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: request.model }),
          });
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Local LLM Provider (unified — Ollama / LM Studio / Hanzo Desktop)
      // =======================================================================
      case 'local.chat': {
        try {
          const provider = request.provider || 'ollama';
          const endpoint = request.endpoint;
          const model = request.model;
          const messages = request.messages;
          const options = request.options || {};
          let result: string;

          if (provider === 'ollama' && !endpoint) {
            const stored = await browser.storage.local.get(['ollamaUrl']);
            const url = stored.ollamaUrl || 'http://localhost:11434';
            const resp = await fetch(`${url}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, messages, stream: false, ...options }),
              signal: AbortSignal.timeout(120000),
            });
            if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
            const data = await resp.json();
            result = data.message?.content || '';
          } else if (provider === 'anthropic') {
            const baseUrl = endpoint || 'https://api.anthropic.com';
            const systemMsg = messages.find((m: any) => m.role === 'system');
            const chatMsgs = messages.filter((m: any) => m.role !== 'system');
            const body: any = { model, max_tokens: options.num_predict || 4096, messages: chatMsgs, stream: false };
            if (systemMsg) body.system = systemMsg.content;
            if (options.temperature !== undefined) body.temperature = options.temperature;
            const resp = await fetch(`${baseUrl}/v1/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': request.apiKey || '', 'anthropic-version': '2023-06-01' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(120000),
            });
            if (!resp.ok) throw new Error(`Anthropic: ${resp.status} ${await resp.text()}`);
            const data = await resp.json();
            result = data.content?.[0]?.text || '';
          } else {
            const lpCfg = LOCAL_PROVIDER_DEFAULTS[provider as keyof typeof LOCAL_PROVIDER_DEFAULTS];
            const baseUrl = endpoint || (lpCfg ? `${lpCfg.url}/v1` : 'http://localhost:8080/v1');
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (request.apiKey) headers['Authorization'] = `Bearer ${request.apiKey}`;
            const body: any = { model, messages, stream: false };
            if (options.temperature !== undefined) body.temperature = options.temperature;
            if (options.num_predict !== undefined) body.max_tokens = options.num_predict;
            const resp = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
            });
            if (!resp.ok) throw new Error(`${provider}: ${resp.status} ${await resp.text()}`);
            const data = await resp.json();
            result = data.choices?.[0]?.message?.content || '';
          }

          sendResponse({ success: true, content: result });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'local.models': {
        try {
          const lpCfg2 = LOCAL_PROVIDER_DEFAULTS[request.provider as keyof typeof LOCAL_PROVIDER_DEFAULTS];
          const endpoint = request.endpoint || (
            request.provider === 'ollama' ? null :
            lpCfg2 ? `${lpCfg2.url}/v1` :
            request.endpoint || 'http://localhost:8080/v1'
          );
          if (!endpoint) {
            const stored = await browser.storage.local.get(['ollamaUrl']);
            const url = stored.ollamaUrl || LOCAL_PROVIDER_DEFAULTS.ollama.url;
            const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            sendResponse({ success: true, models: (data.models || []).map((m: any) => ({ id: m.name, name: m.name, size: m.size, details: m.details })) });
            break;
          }
          const headers: Record<string, string> = {};
          if (request.apiKey) headers['Authorization'] = `Bearer ${request.apiKey}`;
          const resp = await fetch(`${endpoint}/models`, { headers, signal: AbortSignal.timeout(5000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          sendResponse({ success: true, models: data.data || data.models || [] });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'local.discover': {
        const providers: { name: string; url: string; available: boolean; models?: string[] }[] = [];
        // Ollama (configurable URL from storage, fallback from shared config)
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || LOCAL_PROVIDER_DEFAULTS.ollama.url;
          const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
          if (resp.ok) {
            const data = await resp.json();
            providers.push({ name: 'ollama', url, available: true, models: (data.models || []).map((m: any) => m.name) });
          } else {
            providers.push({ name: 'ollama', url, available: false });
          }
        } catch {
          providers.push({ name: 'ollama', url: LOCAL_PROVIDER_DEFAULTS.ollama.url, available: false });
        }
        // LM Studio (configurable from shared config)
        {
          const lmsCfg = LOCAL_PROVIDER_DEFAULTS.lmstudio;
          try {
            const resp = await fetch(`${lmsCfg.url}/models`, { signal: AbortSignal.timeout(2000) });
            if (resp.ok) {
              const data = await resp.json();
              providers.push({ name: 'lmstudio', url: lmsCfg.url, available: true, models: (data.data || []).map((m: any) => m.id) });
            } else {
              providers.push({ name: 'lmstudio', url: lmsCfg.url, available: false });
            }
          } catch {
            providers.push({ name: 'lmstudio', url: lmsCfg.url, available: false });
          }
        }
        // Hanzo Desktop (configurable probe ports from shared config)
        {
          const hdCfg = LOCAL_PROVIDER_DEFAULTS['hanzo-desktop'];
          for (const port of hdCfg.probePorts) {
            try {
              const resp = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(2000) });
              if (resp.ok) {
                const data = await resp.json();
                providers.push({ name: 'hanzo-desktop', url: `http://localhost:${port}`, available: true, models: (data.models || []).map((m: any) => m.name) });
                break;
              }
            } catch { /* next */ }
          }
          if (!providers.find(p => p.name === 'hanzo-desktop')) {
            providers.push({ name: 'hanzo-desktop', url: hdCfg.url, available: false });
          }
        }
        // Custom endpoints
        const stored = await browser.storage.local.get(['customLLMEndpoints']);
        const customs: { name: string; url: string; apiKey?: string }[] = stored.customLLMEndpoints || [];
        for (const c of customs) {
          try {
            const headers: Record<string, string> = {};
            if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`;
            const resp = await fetch(`${c.url}/models`, { headers, signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              const data = await resp.json();
              providers.push({ name: c.name || 'custom', url: c.url, available: true, models: (data.data || data.models || []).map((m: any) => m.id || m.name) });
            } else {
              providers.push({ name: c.name || 'custom', url: c.url, available: false });
            }
          } catch {
            providers.push({ name: c.name || 'custom', url: c.url, available: false });
          }
        }
        sendResponse({ success: true, providers });
        break;
      }

      // =======================================================================
      // Provider Management
      // =======================================================================
      case 'provider.save': {
        try {
          const stored = await browser.storage.local.get(['customLLMEndpoints']);
          const endpoints: any[] = stored.customLLMEndpoints || [];
          const existing = endpoints.findIndex((e: any) => e.name === request.name || e.url === request.url);
          const entry = { name: request.name, url: request.url, apiKey: request.apiKey };
          if (existing >= 0) endpoints[existing] = entry;
          else endpoints.push(entry);
          await browser.storage.local.set({ customLLMEndpoints: endpoints });
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'provider.remove': {
        try {
          const stored = await browser.storage.local.get(['customLLMEndpoints']);
          const endpoints = (stored.customLLMEndpoints || []).filter(
            (e: any) => e.name !== request.name && e.url !== request.url
          );
          await browser.storage.local.set({ customLLMEndpoints: endpoints });
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'provider.test': {
        try {
          const headers: Record<string, string> = {};
          if (request.apiKey) headers['Authorization'] = `Bearer ${request.apiKey}`;
          const resp = await fetch(`${request.url}/models`, { headers, signal: AbortSignal.timeout(5000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          sendResponse({ success: true, models: (data.data || data.models || []).map((m: any) => m.id || m.name) });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Settings (browser.storage.local)
      // =======================================================================
      case 'settings.get': {
        try {
          const keys = request.keys || [
            'selectedProvider', 'selectedModel', 'customLLMEndpoints', 'ollamaUrl',
            'anthropicApiKey', 'openaiApiKey', 'hanzoApiKey',
            'mcpPort', 'cdpPort',
            'activeOrgId', 'browserBackend',
          ];
          const result = await browser.storage.local.get(keys);
          sendResponse({ success: true, settings: result });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings.set': {
        try {
          await browser.storage.local.set(request.settings);
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings.export': {
        try {
          const all = await browser.storage.local.get(null);
          const safe: Record<string, any> = {};
          for (const [k, v] of Object.entries(all)) {
            if (k.startsWith('hanzo_iam_')) continue;
            safe[k] = v;
          }
          sendResponse({ success: true, settings: safe });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings.import': {
        try {
          const settings = request.settings || {};
          delete settings.hanzo_iam_access_token;
          delete settings.hanzo_iam_refresh_token;
          delete settings.hanzo_iam_id_token;
          await browser.storage.local.set(settings);
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'settings.sync':
        sendResponse({ success: true });
        break;

      case 'config.save': {
        // Save config to browser storage (Firefox doesn't have CDP bridge)
        try {
          if (request.key) {
            await browser.storage.local.set({ [request.key]: request.value });
          }
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // API Key Management
      // =======================================================================
      case 'apikey.save': {
        try {
          await browser.storage.local.set({ [`apikey_${request.provider}`]: request.apiKey });
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'apikey.get': {
        try {
          const key = `apikey_${request.provider}`;
          const stored = await browser.storage.local.get([key]);
          sendResponse({ success: true, apiKey: stored[key] || null });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'apikey.list': {
        try {
          const all = await browser.storage.local.get(null);
          const keys: { provider: string; hasKey: boolean }[] = [];
          for (const [k] of Object.entries(all)) {
            if (k.startsWith('apikey_')) {
              keys.push({ provider: k.replace('apikey_', ''), hasKey: true });
            }
          }
          sendResponse({ success: true, keys });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Organization Switcher
      // =======================================================================
      case 'org.list': {
        try {
          const token = await getValidAccessToken();
          if (!token) { sendResponse({ success: false, error: 'Not authenticated' }); break; }

          const resp = await fetch(`${IAM_V1}/account`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) throw new Error(`IAM: ${resp.status}`);
          const data = await resp.json();
          const user = data.data || data;

          const orgs: { id: string; name: string; displayName?: string }[] = [];
          if (user.owner) {
            orgs.push({ id: user.owner, name: user.owner, displayName: user.owner });
          }
          try {
            const orgsResp = await fetch(`${IAM_V1}/organizations`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(5000),
            });
            if (orgsResp.ok) {
              const orgsData = await orgsResp.json();
              for (const org of (orgsData.organizations || [])) {
                if (!orgs.find(o => o.id === org.name)) {
                  orgs.push({ id: org.name, name: org.name, displayName: org.displayName || org.name });
                }
              }
            }
          } catch { /* user may not have permission */ }

          const stored = await browser.storage.local.get(['activeOrgId']);
          sendResponse({
            success: true,
            orgs,
            activeOrgId: stored.activeOrgId || orgs[0]?.id || null,
            user: { name: user.displayName || user.name, email: user.email, avatar: user.avatar },
          });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'org.switch': {
        try {
          await browser.storage.local.set({ activeOrgId: request.orgId });
          sendResponse({ success: true, activeOrgId: request.orgId });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Model Hub (portable — pure HTTP/fetch)
      // =======================================================================
      case 'hub.search': {
        try {
          const query = encodeURIComponent(request.query || '');
          const limit = request.limit || 10;
          const resp = await fetch(
            `https://huggingface.co/api/models?search=${query}&limit=${limit}&sort=downloads&direction=-1`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (!resp.ok) throw new Error(`HuggingFace ${resp.status}`);
          sendResponse({ success: true, models: await resp.json() });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'hub.model': {
        try {
          const resp = await fetch(`https://huggingface.co/api/models/${request.modelId}`, { signal: AbortSignal.timeout(10000) });
          if (!resp.ok) throw new Error(`HuggingFace ${resp.status}`);
          sendResponse({ success: true, model: await resp.json() });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'hub.recommended':
        sendResponse({ success: true, models: [] });
        break;

      case 'hub.searchOllama': {
        try {
          // Ollama library search — use their API
          const resp = await fetch(`https://ollama.com/api/tags?q=${encodeURIComponent(request.query || '')}`, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            sendResponse({ success: true, models: await resp.json() });
          } else {
            sendResponse({ success: true, models: [] });
          }
        } catch {
          sendResponse({ success: true, models: [] });
        }
        break;
      }

      case 'hub.searchGGUF':
      case 'hub.searchMLX':
      case 'hub.modelCard':
      case 'hub.modelStats':
      case 'hub.allModels':
        // Stub — these need the model-hub module which isn't bundled for Firefox yet
        sendResponse({ success: true, models: [], card: null, stats: null, cloud: [], local: [], recommended: [] });
        break;

      case 'hub.downloadOllama': {
        try {
          const stored = await browser.storage.local.get(['ollamaUrl']);
          const url = stored.ollamaUrl || 'http://localhost:11434';
          fetch(`${url}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: request.modelName, stream: false }),
          }).catch(() => {});
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Element Selected (content script overlay picker)
      // =======================================================================
      case 'elementSelected':
        sendResponse({ success: true });
        break;

      // =======================================================================
      // Page Overlay (forwarded to content script)
      // =======================================================================
      case 'page.overlay.toggle':
      case 'page.overlay.show':
      case 'page.overlay.hide':
      case 'page.overlay.status': {
        try {
          const tabId = typeof request.tabId === 'number'
            ? request.tabId
            : (sender?.tab?.id ?? await hanzoExtension.getActiveTabId());
          if (!tabId) {
            sendResponse({ success: false, error: 'No target tab found' });
            break;
          }
          const response = await browser.tabs.sendMessage(tabId, { action: request.action }).catch(() => ({}));
          sendResponse({ success: true, tabId, ...(response || {}) });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // =======================================================================
      // Takeover (control session management)
      // =======================================================================
      case 'hanzo.takeover.start': {
        const takeoverTabId = request.tabId || controlSession.tabId || await hanzoExtension.getActiveTabId();
        if (!takeoverTabId) {
          sendResponse({ success: false, error: 'No target tab found' });
          break;
        }
        await hanzoExtension.startControlSession(takeoverTabId, request.task);
        sendResponse({ success: true });
        break;
      }

      case 'hanzo.takeover.end': {
        await hanzoExtension.stopControlSession();
        sendResponse({ success: true });
        break;
      }

      case 'hanzo.takeover.cursor': {
        const cursorTabId = controlSession.tabId || await hanzoExtension.getActiveTabId();
        if (cursorTabId) {
          browser.tabs.sendMessage(cursorTabId, {
            action: 'ai.control.cursor',
            x: request.x,
            y: request.y,
          }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      // =======================================================================
      // Bridge & Usage
      // =======================================================================
      case 'bridge.status': {
        // Connected means the router LISTS us, which is what
        // `zap.state.connected` holds. An open socket is not the same claim.
        const bridgeConnected = zap.state.connected;
        sendResponse({
          success: true,
          connected: bridgeConnected,
          browsers: bridgeConnected ? ['firefox'] : [],
        });
        break;
      }

      case 'usage.metrics':
        sendResponse({ success: true, metrics: { chatRequests: 0, inputTokens: 0, outputTokens: 0, dedupeHits: 0, canceledRequests: 0 } });
        break;

      case 'inspector.pickResult':
        sendResponse({ success: true });
        break;

      // =======================================================================
      // AI Control Overlay (forwarded to content script)
      // =======================================================================
      case 'ai.control.start':
      case 'ai.control.cursor':
      case 'ai.control.highlight':
      case 'ai.control.status': {
        const targetTabId = request.tabId || controlSession.tabId || await hanzoExtension.getActiveTabId();
        if (!targetTabId) {
          sendResponse({ success: false, error: 'No target tab found' });
          break;
        }
        if (request.action !== 'ai.control.start' && controlSession.active && controlSession.tabId && targetTabId !== controlSession.tabId) {
          sendResponse({ success: false, error: `Control locked to tab ${controlSession.tabId}` });
          break;
        }
        if (request.action === 'ai.control.start') {
          await hanzoExtension.startControlSession(targetTabId, request.task);
        } else {
          browser.tabs.sendMessage(targetTabId, request).catch(() => {});
        }
        sendResponse({ success: true, tabId: targetTabId });
        break;
      }

      case 'ai.control.stop':
        await hanzoExtension.stopControlSession();
        sendResponse({ success: true });
        break;

      case 'ai.control.cancel':
        await hanzoExtension.stopControlSession();
        sendResponse({ success: true });
        break;

      // =======================================================================
      // CDP-specific stubs (not available in Firefox — chrome.debugger is Chrome-only)
      // =======================================================================
      case 'cdp.attach':
      case 'cdp.detach':
      case 'cdp.send':
      case 'cdp.screenshot':
      case 'cdp.click':
      case 'cdp.fill':
      case 'cdp.navigate':
      case 'cdp.evaluate':
        sendResponse({ success: false, error: 'CDP debugger is not available in Firefox. Use browser automation methods instead.' });
        break;

      // Monitor stubs (CDP-dependent in Chrome, limited in Firefox)
      case 'monitor.start':
      case 'monitor.stop':
      case 'monitor.consoleLogs':
      case 'monitor.consoleErrors':
      case 'monitor.networkLogs':
      case 'monitor.networkErrors':
      case 'monitor.networkSuccess':
      case 'monitor.allNetwork':
      case 'monitor.wipeLogs':
      case 'monitor.config':
      case 'monitor.status':
        sendResponse({ success: false, error: 'Page monitoring requires CDP (Chrome DevTools Protocol) which is not available in Firefox.' });
        break;

      // Audit stubs
      case 'audit.accessibility':
      case 'audit.performance':
      case 'audit.seo':
      case 'audit.bestPractices':
      case 'audit.full':
      case 'audit.nextjs':
      case 'audit.debugger':
      case 'debugger.mode':
        sendResponse({ success: false, error: 'Page audits require CDP which is not available in Firefox.' });
        break;

      // Tab filesystem (requires CDP bridge)
      case 'readTabFS':
      case 'writeTabFS':
      case 'listTabFS':
        sendResponse({ success: false, error: 'Tab filesystem requires CDP bridge.' });
        break;

      // AI provider usage (Claude + Codex, via @hanzo/usage)
      case 'usage.fetch': {
        try {
          const providers = await fetchAllUsage();
          sendResponse({ success: true, providers });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      default:
        sendResponse({ success: false, error: `Unknown action: ${request.action}` });
        break;
    }
  })();
  return true; // Keep channel open
});

// =============================================================================
// Initialization
// =============================================================================

const hanzoExtension = new HanzoFirefoxExtension();

// Join this machine's ZAP router over its loopback WebSocket, once paired, and
// register Firefox as a browser node — the SAME transport Chrome uses. Inbound
// ROUTE commands dispatch to Firefox's native browser.* dispatcher.
const BROWSER_CAPS = ['browser.tabs', 'browser.navigate', 'browser.dom', 'browser.screenshot', 'browser.input'];
const browserDispatch = (method: string, params: any) =>
  hanzoExtension.dispatchMethod(method, (params || {}) as Record<string, unknown>);
const zap = startZap({
  brand: 'hanzo',
  caps: BROWSER_CAPS,
  engine: BROWSER_NAME,
  dispatch: browserDispatch,
  log: console.log,
  storage: browser.storage.local,
});

// =============================================================================
// Keep-alive — two-layer:
//
//   1. Port: every content-script connects a `zap-keepalive` port. As long
//      as ANY tab holds a port, Firefox keeps the background event-page
//      loaded indefinitely. This is the canonical MV3 pattern and the
//      cheapest fix for the suspend bug — no polling required.
//
//   2. Alarms: for the case where no http(s) tab is open (about: pages,
//      fresh window) AND the background gets suspended. The alarm wakes the
//      page and restarts the reconciler's clock.
// =============================================================================
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'zap-keepalive') return;
  // Just receiving messages keeps the background page alive — we don't
  // even need to respond. Drop the listener silently when the content
  // script unloads.
  port.onMessage.addListener(() => { /* noop — receipt is the keep-alive */ });
});

const KEEP_ALIVE_ALARM = 'hanzo-zap-keepalive';
try {
  // Even with the background page idled out, the alarm wakes it every 30 s
  // and restarts the reconciler's clock.
  browser.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEP_ALIVE_ALARM) return;
    zap.tick();
  });
} catch (e) {
  console.warn('[Hanzo] alarms unavailable:', e);
}

// End active session when the controlled tab closes.
browser.tabs.onRemoved.addListener((tabId) => {
  if (controlSession.active && controlSession.tabId === tabId) {
    void hanzoExtension.stopControlSession();
  }
});

// ── Omnibox → Hanzo answer engine ────────────────────────────────────────
// Firefox's address bar can't be silently hijacked (a security boundary), so
// neither manifest declares `chrome_settings_overrides.search_provider`. The
// WebExtension mechanism that works everywhere without opt-in is the
// omnibox keyword: type `hanzo <query>` in the address bar → the query loads
// the Hanzo answer engine (AI answer + sources + news) with ?q=. Same surface
// as the new-tab landing.
try {
  const omnibox = (browser as any).omnibox;
  if (omnibox) {
    omnibox.setDefaultSuggestion({
      description: 'Search Hanzo AI — AI answers with sources and realtime news',
    });
    omnibox.onInputEntered.addListener((text: string, disposition: string) => {
      const url = browser.runtime.getURL('newtab.html') + '?q=' + encodeURIComponent(text);
      if (disposition === 'newForegroundTab') {
        void browser.tabs.create({ url });
      } else if (disposition === 'newBackgroundTab') {
        void browser.tabs.create({ url, active: false });
      } else {
        void browser.tabs.update({ url });
      }
    });
  }
} catch (e) {
  console.warn('[Hanzo] omnibox unavailable:', e);
}

console.log('[Hanzo] Firefox background script loaded');
