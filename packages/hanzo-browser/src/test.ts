/**
 * `@hanzo/browser/test` — Sovereign zero-Playwright E2E test runner & assertion engine
 * built directly on native Chrome DevTools Protocol (`CdpConnection` + `launchChrome`).
 *
 * Provides `test`, `expect`, `defineConfig`, `Page`, `Locator`, CDP `Fetch` request
 * interception (`page.route`), `page.addInitScript`, and `runTestFiles` so apps like
 * `@hanzo/social` run full headless E2E tests with zero `@playwright/test` dependency.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CdpConnection, installCdpPageHelpers, launchChrome } from './cdp.js';

export interface HanzoTestConfig {
  testDir?: string;
  timeout?: number;
  baseURL?: string;
  use?: {
    baseURL?: string;
    headless?: boolean;
    viewport?: { width: number; height: number };
  };
  webServer?: {
    command: string;
    url?: string;
    port?: number;
    reuseExistingServer?: boolean;
    timeout?: number;
    cwd?: string;
    env?: Record<string, string>;
  };
}

export function defineConfig(config: HanzoTestConfig): HanzoTestConfig {
  return config;
}

export interface RouteFulfillOptions {
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  json?: unknown;
}

export class Route {
  private cdp: CdpConnection;
  private sessionId: string;
  private requestId: string;
  public readonly requestUrl: string;
  public readonly requestMethod: string;
  public readonly postData?: string;
  private handled = false;

  constructor(cdp: CdpConnection, sessionId: string, params: any) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.requestId = params.requestId;
    this.requestUrl = params.request?.url || '';
    this.requestMethod = params.request?.method || 'GET';
    this.postData = params.request?.postData;
  }

  request() {
    return {
      url: () => this.requestUrl,
      method: () => this.requestMethod,
      postData: () => this.postData ?? null,
      postDataJSON: () => (this.postData ? JSON.parse(this.postData) : null),
    };
  }

  async fulfill(opts: RouteFulfillOptions = {}): Promise<void> {
    if (this.handled) return;
    this.handled = true;
    const status = opts.status ?? 200;
    const rawBody = opts.json !== undefined
      ? Buffer.from(JSON.stringify(opts.json), 'utf8')
      : typeof opts.body === 'string'
        ? Buffer.from(opts.body, 'utf8')
        : (opts.body ?? Buffer.alloc(0));
    const contentType = opts.contentType ?? (opts.json !== undefined ? 'application/json' : 'text/plain; charset=utf-8');
    const headersMap: Record<string, string> = {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      ...(opts.headers || {}),
    };
    const responseHeaders = Object.entries(headersMap).map(([name, value]) => ({ name, value: String(value) }));
    await this.cdp.send(
      'Fetch.fulfillRequest',
      {
        requestId: this.requestId,
        responseCode: status,
        responseHeaders,
        body: rawBody.toString('base64'),
      },
      this.sessionId,
    ).catch(() => {});
  }

  async continue(): Promise<void> {
    if (this.handled) return;
    this.handled = true;
    await this.cdp.send('Fetch.continueRequest', { requestId: this.requestId }, this.sessionId).catch(() => {});
  }

  async abort(): Promise<void> {
    if (this.handled) return;
    this.handled = true;
    await this.cdp.send('Fetch.failRequest', { requestId: this.requestId, errorReason: 'Aborted' }, this.sessionId).catch(() => {});
  }

  get isHandled(): boolean {
    return this.handled;
  }
}

export type QuerySpec =
  | { kind: 'css'; selector: string }
  | { kind: 'text'; text: string | RegExp; exact?: boolean }
  | { kind: 'role'; role: string; name?: string | RegExp; exact?: boolean }
  | { kind: 'label'; label: string | RegExp }
  | { kind: 'placeholder'; placeholder: string | RegExp }
  | { kind: 'testid'; testId: string };

function serializeQuerySpec(spec: QuerySpec): string {
  const serializeMatcher = (m: string | RegExp | undefined) => {
    if (m === undefined) return 'null';
    if (m instanceof RegExp) return `{ re: ${JSON.stringify(m.source)}, flags: ${JSON.stringify(m.flags)} }`;
    return `{ str: ${JSON.stringify(m)} }`;
  };
  switch (spec.kind) {
    case 'css':
      return `{ kind: 'css', selector: ${JSON.stringify(spec.selector)} }`;
    case 'text':
      return `{ kind: 'text', m: ${serializeMatcher(spec.text)}, exact: ${Boolean(spec.exact)} }`;
    case 'role':
      return `{ kind: 'role', role: ${JSON.stringify(spec.role.toLowerCase())}, m: ${serializeMatcher(spec.name)}, exact: ${Boolean(spec.exact)} }`;
    case 'label':
      return `{ kind: 'label', m: ${serializeMatcher(spec.label)} }`;
    case 'placeholder':
      return `{ kind: 'placeholder', m: ${serializeMatcher(spec.placeholder)} }`;
    case 'testid':
      return `{ kind: 'testid', testId: ${JSON.stringify(spec.testId)} }`;
  }
}

const DOM_QUERY_HELPER = `
((chain) => {
  const matchText = (actual, matcher, exact) => {
    if (!matcher) return true;
    const norm = String(actual || '').replace(/\\s+/g, ' ').trim();
    if (matcher.re !== undefined) return new RegExp(matcher.re, matcher.flags || '').test(norm);
    const want = String(matcher.str || '').replace(/\\s+/g, ' ').trim();
    return exact ? norm === want : norm.toLowerCase().includes(want.toLowerCase());
  };
  const roleOf = (el) => {
    const r = el.getAttribute && el.getAttribute('role');
    if (r) return r.toLowerCase();
    const t = el.tagName.toLowerCase();
    if (t === 'button') return 'button';
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'textarea') return 'textbox';
    if (t === 'select') return 'combobox';
    if (t === 'nav') return 'navigation';
    if (t === 'main') return 'main';
    if (t === 'dialog') return 'dialog';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'input') {
      const it = (el.type || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(it)) return 'button';
      if (it === 'checkbox') return 'checkbox';
      if (it === 'radio') return 'radio';
      return 'textbox';
    }
    return t;
  };
  const accessibleName = (el) => {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder');
    if (aria && aria.trim()) return aria.trim();
    if (el.labels && el.labels.length) {
      return Array.from(el.labels).map((l) => l.textContent || '').join(' ');
    }
    return el.innerText || el.textContent || el.value || '';
  };
  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  let roots = [document];
  for (const step of chain) {
    if (step.nth !== undefined) {
      const idx = step.nth < 0 ? roots.length + step.nth : step.nth;
      roots = roots[idx] ? [roots[idx]] : [];
      continue;
    }
    const next = [];
    for (const root of roots) {
      const spec = step.spec;
      if (spec.kind === 'css') {
        next.push(...Array.from(root.querySelectorAll(spec.selector)));
      } else if (spec.kind === 'testid') {
        next.push(...Array.from(root.querySelectorAll('[data-testid=' + JSON.stringify(spec.testId) + ']')));
      } else if (spec.kind === 'placeholder') {
        for (const el of Array.from(root.querySelectorAll('input, textarea'))) {
          if (matchText(el.getAttribute('placeholder') || '', spec.m, false)) next.push(el);
        }
      } else if (spec.kind === 'label') {
        for (const el of Array.from(root.querySelectorAll('input, textarea, select'))) {
          if (matchText(accessibleName(el), spec.m, false)) next.push(el);
        }
      } else if (spec.kind === 'role') {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          if (roleOf(el) === spec.role && matchText(accessibleName(el), spec.m, spec.exact)) next.push(el);
        }
      } else if (spec.kind === 'text') {
        const candidates = Array.from(root.querySelectorAll('*')).filter((el) => matchText(el.innerText || el.textContent || '', spec.m, spec.exact));
        // Prefer innermost matching elements
        for (const el of candidates) {
          if (!Array.from(el.children).some((c) => candidates.includes(c))) next.push(el);
        }
      }
    }
    roots = next;
  }
  return { elements: roots, isVisible };
})`;

export class Locator {
  private page: Page;
  private steps: Array<{ spec?: QuerySpec; nth?: number }>;

  constructor(page: Page, steps: Array<{ spec?: QuerySpec; nth?: number }>) {
    this.page = page;
    this.steps = steps;
  }

  private serializedChain(): string {
    return `[${this.steps
      .map((s) => (s.nth !== undefined ? `{ nth: ${s.nth} }` : `{ spec: ${serializeQuerySpec(s.spec!)} }`))
      .join(', ')}]`;
  }

  locator(selector: string): Locator {
    return new Locator(this.page, [...this.steps, { spec: { kind: 'css', selector } }]);
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return new Locator(this.page, [...this.steps, { spec: { kind: 'text', text, exact: opts?.exact } }]);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): Locator {
    return new Locator(this.page, [...this.steps, { spec: { kind: 'role', role, name: opts?.name, exact: opts?.exact } }]);
  }

  getByPlaceholder(placeholder: string | RegExp): Locator {
    return new Locator(this.page, [...this.steps, { spec: { kind: 'placeholder', placeholder } }]);
  }

  getByLabel(label: string | RegExp): Locator {
    return new Locator(this.page, [...this.steps, { spec: { kind: 'label', label } }]);
  }

  getByTestId(testId: string): Locator {
    return new Locator(this.page, [...this.steps, { spec: { kind: 'testid', testId } }]);
  }

  first(): Locator {
    return new Locator(this.page, [...this.steps, { nth: 0 }]);
  }

  last(): Locator {
    return new Locator(this.page, [...this.steps, { nth: -1 }]);
  }

  nth(index: number): Locator {
    return new Locator(this.page, [...this.steps, { nth: index }]);
  }

  async count(): Promise<number> {
    return this.page.evaluate<number>(`${DOM_QUERY_HELPER}(${this.serializedChain()}).elements.length`);
  }

  async isVisible(): Promise<boolean> {
    return this.page.evaluate<boolean>(`(() => {
      const q = ${DOM_QUERY_HELPER}(${this.serializedChain()});
      return q.elements.some((el) => q.isVisible(el));
    })()`);
  }

  async textContent(timeoutMs = 5000): Promise<string | null> {
    await this.waitFor({ state: 'attached', timeout: timeoutMs });
    return this.page.evaluate<string | null>(`(() => {
      const el = ${DOM_QUERY_HELPER}(${this.serializedChain()}).elements[0];
      return el ? (el.textContent ?? '') : null;
    })()`);
  }

  async innerText(timeoutMs = 5000): Promise<string> {
    await this.waitFor({ state: 'visible', timeout: timeoutMs });
    return this.page.evaluate<string>(`(() => {
      const q = ${DOM_QUERY_HELPER}(${this.serializedChain()});
      const el = q.elements.find((e) => q.isVisible(e)) || q.elements[0];
      return el ? String(el.innerText || el.textContent || '') : '';
    })()`);
  }

  async inputValue(timeoutMs = 5000): Promise<string> {
    await this.waitFor({ state: 'attached', timeout: timeoutMs });
    return this.page.evaluate<string>(`(() => {
      const el = ${DOM_QUERY_HELPER}(${this.serializedChain()}).elements[0];
      return el ? String(el.value ?? '') : '';
    })()`);
  }

  async getAttribute(name: string, timeoutMs = 5000): Promise<string | null> {
    await this.waitFor({ state: 'attached', timeout: timeoutMs });
    return this.page.evaluate<string | null>(`(() => {
      const el = ${DOM_QUERY_HELPER}(${this.serializedChain()}).elements[0];
      return el ? el.getAttribute(${JSON.stringify(name)}) : null;
    })()`);
  }

  async waitFor(opts: { state?: 'visible' | 'hidden' | 'attached'; timeout?: number } = {}): Promise<void> {
    const state = opts.state ?? 'visible';
    const deadline = Date.now() + (opts.timeout ?? 7000);
    while (Date.now() < deadline) {
      const ok = await this.page.evaluate<boolean>(`(() => {
        const q = ${DOM_QUERY_HELPER}(${this.serializedChain()});
        if (${JSON.stringify(state)} === 'attached') return q.elements.length > 0;
        if (${JSON.stringify(state)} === 'hidden') return q.elements.length === 0 || q.elements.every((e) => !q.isVisible(e));
        return q.elements.some((e) => q.isVisible(e));
      })()`).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 75));
    }
    throw new Error(`Timed out waiting for locator (${state}): ${this.serializedChain()}`);
  }

  async click(opts: { timeout?: number } = {}): Promise<void> {
    await this.waitFor({ state: 'visible', timeout: opts.timeout ?? 7000 });
    const pt = await this.page.evaluate<{ x: number; y: number } | null>(`(() => {
      const q = ${DOM_QUERY_HELPER}(${this.serializedChain()});
      const el = q.elements.find((e) => q.isVisible(e)) || q.elements[0];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!pt) throw new Error('Locator disappeared before click');
    await this.page._dispatchClick(pt.x, pt.y);
  }

  async fill(value: string, opts: { timeout?: number } = {}): Promise<void> {
    await this.waitFor({ state: 'visible', timeout: opts.timeout ?? 7000 });
    await this.page.evaluate(`(() => {
      const q = ${DOM_QUERY_HELPER}(${this.serializedChain()});
      const el = q.elements.find((e) => q.isVisible(e)) || q.elements[0];
      if (!el) throw new Error('Element not found for fill');
      el.focus({ preventScroll: true });
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue('__hanzo_prev__');
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async press(key: string, opts: { timeout?: number } = {}): Promise<void> {
    await this.waitFor({ state: 'visible', timeout: opts.timeout ?? 7000 });
    await this.page.evaluate(`(() => {
      const q = ${DOM_QUERY_HELPER}(${this.serializedChain()});
      const el = q.elements.find((e) => q.isVisible(e)) || q.elements[0];
      if (el) el.focus({ preventScroll: true });
    })()`);
    await this.page.keyboard.press(key);
  }
}

function matchesUrlPattern(url: string, pattern: string | RegExp | ((u: URL) => boolean)): boolean {
  if (typeof pattern === 'function') {
    try { return pattern(new URL(url)); } catch { return false; }
  }
  if (pattern instanceof RegExp) return pattern.test(url);
  const glob = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*/g, '[^/]*');
  return new RegExp(`^${glob}$`).test(url) || url.includes(pattern.replace(/^\*\*\/?/, ''));
}

export class Page {
  private cdp: CdpConnection;
  private sessionId: string;
  private baseURL?: string;
  private routes: Array<{ pattern: string | RegExp | ((u: URL) => boolean); handler: (route: Route) => Promise<void> | void }> = [];
  private fetchEnabled = false;
  private currentUrl = 'about:blank';

  constructor(cdp: CdpConnection, sessionId: string, baseURL?: string) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.baseURL = baseURL;

    this.cdp.on('Page.frameNavigated', (params, sid) => {
      if (sid === this.sessionId && !params.frame?.parentId && params.frame?.url) {
        this.currentUrl = params.frame.url;
      }
    });

    this.cdp.on('Fetch.requestPaused', async (params, sid) => {
      if (sid !== this.sessionId) return;
      const route = new Route(this.cdp, this.sessionId, params);
      for (let i = this.routes.length - 1; i >= 0; i--) {
        const entry = this.routes[i];
        if (matchesUrlPattern(route.requestUrl, entry.pattern)) {
          try {
            await entry.handler(route);
          } catch {
            if (!route.isHandled) await route.abort();
          }
          if (!route.isHandled) await route.continue();
          return;
        }
      }
      await route.continue();
    });
  }

  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.width < 600 },
      this.sessionId,
    );
  }

  async addInitScript(fnOrScript: string | ((...args: any[]) => any), arg?: unknown): Promise<void> {
    const source = typeof fnOrScript === 'function'
      ? `(${fnOrScript.toString()})(${arg !== undefined ? JSON.stringify(arg) : ''})`
      : String(fnOrScript);
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, this.sessionId);
  }

  async route(pattern: string | RegExp | ((u: URL) => boolean), handler: (route: Route) => Promise<void> | void): Promise<void> {
    if (!this.fetchEnabled) {
      this.fetchEnabled = true;
      await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, this.sessionId);
    }
    this.routes.push({ pattern, handler });
  }

  async goto(url: string, opts: { timeout?: number } = {}): Promise<void> {
    const resolved = /^https?:\/\/|^about:|^data:/i.test(url)
      ? url
      : new URL(url, this.baseURL || 'http://127.0.0.1:3000').toString();
    await this.cdp.send('Page.navigate', { url: resolved }, this.sessionId, opts.timeout ?? 20_000);
    const deadline = Date.now() + (opts.timeout ?? 15_000);
    while (Date.now() < deadline) {
      const state = await this.evaluate<string>('document.readyState').catch(() => 'loading');
      if (state === 'complete') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    this.currentUrl = await this.evaluate<string>('location.href').catch(() => resolved);
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return (await this.evaluate<string>('document.title')) || '';
  }

  async content(): Promise<string> {
    return (await this.evaluate<string>('document.documentElement.outerHTML')) || '';
  }

  async evaluate<T = any>(fnOrExpr: string | ((arg?: any) => T), arg?: unknown): Promise<T> {
    const expression = typeof fnOrExpr === 'function'
      ? `(${fnOrExpr.toString()})(${arg !== undefined ? JSON.stringify(arg) : ''})`
      : String(fnOrExpr);
    const res = await this.cdp.send<any>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'evaluate error');
    }
    this.currentUrl = await this.cdp
      .send<any>('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, this.sessionId)
      .then((r) => r?.result?.value || this.currentUrl)
      .catch(() => this.currentUrl);
    return res?.result?.value as T;
  }

  locator(selector: string): Locator {
    return new Locator(this, [{ spec: { kind: 'css', selector } }]);
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return new Locator(this, [{ spec: { kind: 'text', text, exact: opts?.exact } }]);
  }

  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): Locator {
    return new Locator(this, [{ spec: { kind: 'role', role, name: opts?.name, exact: opts?.exact } }]);
  }

  getByPlaceholder(placeholder: string | RegExp): Locator {
    return new Locator(this, [{ spec: { kind: 'placeholder', placeholder } }]);
  }

  getByLabel(label: string | RegExp): Locator {
    return new Locator(this, [{ spec: { kind: 'label', label } }]);
  }

  getByTestId(testId: string): Locator {
    return new Locator(this, [{ spec: { kind: 'testid', testId } }]);
  }

  async click(selector: string): Promise<void> {
    await this.locator(selector).click();
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.locator(selector).fill(value);
  }

  async waitForSelector(selector: string, opts?: { state?: 'visible' | 'hidden' | 'attached'; timeout?: number }): Promise<void> {
    await this.locator(selector).waitFor(opts);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async screenshot(opts: { path?: string; fullPage?: boolean } = {}): Promise<Buffer> {
    const r = await this.cdp.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: Boolean(opts.fullPage) },
      this.sessionId,
    );
    const buf = Buffer.from(r.data, 'base64');
    if (opts.path) fs.writeFileSync(opts.path, buf);
    return buf;
  }

  async _dispatchClick(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, this.sessionId);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, this.sessionId);
  }

  keyboard = {
    press: async (key: string) => {
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key.length === 1 ? key : undefined }, this.sessionId);
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key }, this.sessionId);
    },
    type: async (text: string) => {
      for (const ch of text) {
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch }, this.sessionId);
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch }, this.sessionId);
      }
    },
  };
}

// ── Assertions (`expect`) ───────────────────────────────────────────────────

function buildAssertion(target: any, negated: boolean) {
  const check = (ok: boolean, msg: string) => {
    if (negated ? ok : !ok) {
      throw new Error(msg);
    }
  };

  const poll = async (fn: () => Promise<boolean>, failMsg: () => Promise<string> | string, timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fn().catch(() => false);
      if (negated ? !res : res) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    const finalRes = await fn().catch(() => false);
    if (negated ? !finalRes : finalRes) return;
    throw new Error(await failMsg());
  };

  return {
    get not() {
      return buildAssertion(target, !negated);
    },
    toBe(expected: unknown) {
      check(Object.is(target, expected), `Expected ${JSON.stringify(target)} ${negated ? 'not ' : ''}to be ${JSON.stringify(expected)}`);
    },
    toEqual(expected: unknown) {
      check(JSON.stringify(target) === JSON.stringify(expected), `Expected ${JSON.stringify(target)} ${negated ? 'not ' : ''}to equal ${JSON.stringify(expected)}`);
    },
    toBeTruthy() {
      check(Boolean(target), `Expected ${JSON.stringify(target)} ${negated ? 'not ' : ''}to be truthy`);
    },
    toBeFalsy() {
      check(!target, `Expected ${JSON.stringify(target)} ${negated ? 'not ' : ''}to be falsy`);
    },
    toContain(sub: string) {
      const ok = typeof target === 'string' || Array.isArray(target) ? target.includes(sub as any) : false;
      check(ok, `Expected ${JSON.stringify(target)} ${negated ? 'not ' : ''}to contain ${JSON.stringify(sub)}`);
    },
    toMatch(re: RegExp | string) {
      const r = typeof re === 'string' ? new RegExp(re) : re;
      check(r.test(String(target ?? '')), `Expected ${JSON.stringify(target)} ${negated ? 'not ' : ''}to match ${r}`);
    },
    async toBeVisible(opts?: { timeout?: number }) {
      const loc = target as Locator;
      await poll(() => loc.isVisible(), () => `Expected locator ${negated ? 'not ' : ''}to be visible`, opts?.timeout);
    },
    async toBeHidden(opts?: { timeout?: number }) {
      const loc = target as Locator;
      await poll(async () => !(await loc.isVisible()), () => `Expected locator ${negated ? 'not ' : ''}to be hidden`, opts?.timeout);
    },
    async toContainText(expected: string | RegExp, opts?: { timeout?: number }) {
      const loc = target as Locator;
      await poll(
        async () => {
          const txt = (await loc.textContent(500).catch(() => '')) || '';
          return expected instanceof RegExp ? expected.test(txt) : txt.includes(expected);
        },
        async () => `Expected locator text ${JSON.stringify(await loc.textContent(200).catch(() => ''))} ${negated ? 'not ' : ''}to contain ${String(expected)}`,
        opts?.timeout,
      );
    },
    async toHaveText(expected: string | RegExp, opts?: { timeout?: number }) {
      const loc = target as Locator;
      await poll(
        async () => {
          const txt = ((await loc.textContent(500).catch(() => '')) || '').trim();
          return expected instanceof RegExp ? expected.test(txt) : txt === expected.trim();
        },
        async () => `Expected locator text ${JSON.stringify(await loc.textContent(200).catch(() => ''))} ${negated ? 'not ' : ''}to equal ${String(expected)}`,
        opts?.timeout,
      );
    },
    async toHaveValue(expected: string | RegExp, opts?: { timeout?: number }) {
      const loc = target as Locator;
      await poll(
        async () => {
          const val = await loc.inputValue(500).catch(() => '');
          return expected instanceof RegExp ? expected.test(val) : val === expected;
        },
        async () => `Expected input value ${negated ? 'not ' : ''}to match ${String(expected)}`,
        opts?.timeout,
      );
    },
    async toHaveCount(expected: number, opts?: { timeout?: number }) {
      const loc = target as Locator;
      await poll(
        async () => (await loc.count()) === expected,
        async () => `Expected count ${expected}, received ${await loc.count().catch(() => -1)}`,
        opts?.timeout,
      );
    },
    async toHaveURL(expected: string | RegExp, opts?: { timeout?: number }) {
      const pg = target as Page;
      await poll(
        async () => {
          const u = await pg.evaluate<string>('location.href').catch(() => pg.url());
          return expected instanceof RegExp ? expected.test(u) : u.includes(expected);
        },
        () => `Expected URL ${JSON.stringify(pg.url())} ${negated ? 'not ' : ''}to match ${String(expected)}`,
        opts?.timeout,
      );
    },
    async toHaveTitle(expected: string | RegExp, opts?: { timeout?: number }) {
      const pg = target as Page;
      await poll(
        async () => {
          const t = await pg.title();
          return expected instanceof RegExp ? expected.test(t) : t.includes(expected);
        },
        async () => `Expected title ${JSON.stringify(await pg.title())} ${negated ? 'not ' : ''}to match ${String(expected)}`,
        opts?.timeout,
      );
    },
  };
}

export function expect(target: any) {
  return buildAssertion(target, false);
}

// ── Test Registry & Runner ──────────────────────────────────────────────────

interface RegisteredTest {
  suite: string[];
  name: string;
  fn: (fixtures: { page: Page }) => Promise<void> | void;
  beforeEachFns: Array<(fixtures: { page: Page }) => Promise<void> | void>;
}

const suiteStack: Array<{ name: string; beforeEachFns: Array<(fixtures: { page: Page }) => Promise<void> | void> }> = [
  { name: '', beforeEachFns: [] },
];
const registeredTests: RegisteredTest[] = [];

function registerTest(name: string, fn: (fixtures: { page: Page }) => Promise<void> | void): void {
  const beforeEachFns = suiteStack.flatMap((s) => s.beforeEachFns);
  const suite = suiteStack.map((s) => s.name).filter(Boolean);
  registeredTests.push({ suite, name, fn, beforeEachFns });
}

export const test = Object.assign(registerTest, {
  describe(name: string, body: () => void): void {
    suiteStack.push({ name, beforeEachFns: [] });
    try {
      body();
    } finally {
      suiteStack.pop();
    }
  },
  beforeEach(fn: (fixtures: { page: Page }) => Promise<void> | void): void {
    suiteStack[suiteStack.length - 1].beforeEachFns.push(fn);
  },
  skip(_name: string, _fn: any): void {
    // skipped
  },
});

export const describe = test.describe;

async function waitForHttpReady(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(url, { timeout: 1500 }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function collectSpecFiles(dirOrFiles: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isFile()) {
      if (/\.(spec|e2e|test)\.(ts|mts|js|mjs)$/.test(p)) out.push(path.resolve(p));
      return;
    }
    for (const entry of fs.readdirSync(p)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      walk(path.join(p, entry));
    }
  };
  for (const item of dirOrFiles) walk(item);
  return out.sort();
}

export async function runTestSuite(opts: {
  files?: string[];
  configPath?: string;
  cwd?: string;
  headless?: boolean;
} = {}): Promise<{ passed: number; failed: number }> {
  const cwd = opts.cwd ?? process.cwd();
  let config: HanzoTestConfig = {};

  const cfgCandidates = [
    opts.configPath ? path.resolve(cwd, opts.configPath) : '',
    path.join(cwd, 'hanzo-browser.config.ts'),
    path.join(cwd, 'hanzo-browser.config.mjs'),
    path.join(cwd, 'e2e.config.ts'),
  ].filter(Boolean);

  for (const c of cfgCandidates) {
    if (fs.existsSync(c)) {
      const mod = await import(pathToFileURL(c).href);
      config = mod.default ?? mod;
      break;
    }
  }

  const targetPaths = opts.files && opts.files.length > 0
    ? opts.files.map((f) => path.resolve(cwd, f))
    : [path.resolve(cwd, config.testDir || 'e2e')];

  const specFiles = collectSpecFiles(targetPaths);
  if (specFiles.length === 0) {
    throw new Error(`No E2E spec files found in ${targetPaths.join(', ')}`);
  }

  let serverProc: ChildProcess | null = null;
  const baseURL = config.use?.baseURL || config.baseURL || (config.webServer?.url) || (config.webServer?.port ? `http://127.0.0.1:${config.webServer.port}` : undefined);

  if (config.webServer) {
    const checkUrl = config.webServer.url || (config.webServer.port ? `http://127.0.0.1:${config.webServer.port}` : baseURL);
    const alreadyUp = config.webServer.reuseExistingServer !== false && checkUrl
      ? await waitForHttpReady(checkUrl, 1200)
      : false;
    if (!alreadyUp) {
      serverProc = spawn(config.webServer.command, {
        cwd: config.webServer.cwd ? path.resolve(cwd, config.webServer.cwd) : cwd,
        shell: true,
        stdio: 'ignore',
        env: { ...process.env, ...(config.webServer.env || {}) },
      });
      if (checkUrl) {
        const ready = await waitForHttpReady(checkUrl, config.webServer.timeout ?? 30_000);
        if (!ready) {
          serverProc.kill('SIGTERM');
          throw new Error(`webServer did not become ready at ${checkUrl}`);
        }
      }
    }
  }

  registeredTests.length = 0;
  for (const file of specFiles) {
    await import(pathToFileURL(file).href);
  }

  const launched = await launchChrome({
    headless: opts.headless ?? config.use?.headless ?? true,
  });

  let passed = 0;
  let failed = 0;

  try {
    for (const t of registeredTests) {
      const label = [...t.suite, t.name].join(' › ');
      const { browserContextId } = await launched.connection.send<{ browserContextId: string }>('Target.createBrowserContext');
      const { targetId } = await launched.connection.send<{ targetId: string }>('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await launched.connection.send<{ sessionId: string }>('Target.attachToTarget', {
        targetId,
        flatten: true,
      });
      await installCdpPageHelpers(launched.connection, sessionId);
      const page = new Page(launched.connection, sessionId, baseURL);
      if (config.use?.viewport) {
        await page.setViewportSize(config.use.viewport);
      }

      const t0 = Date.now();
      try {
        for (const hook of t.beforeEachFns) await hook({ page });
        await t.fn({ page });
        passed++;
        console.log(`  ✓ ${label} (${Date.now() - t0}ms)`);
      } catch (err: any) {
        failed++;
        console.error(`  ✗ ${label}\n    ${err?.message || err}`);
      } finally {
        await launched.connection.send('Target.closeTarget', { targetId }).catch(() => {});
        await launched.connection.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      }
    }
  } finally {
    await launched.close();
    if (serverProc) {
      try { serverProc.kill('SIGTERM'); } catch {}
    }
  }

  console.log(`\n@hanzo/browser E2E: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
