/**
 * `@hanzo/browser` — Sovereign zero-Playwright browser automation SDK, WebMCP client,
 * LastPass + KMS Vault client, E2E test runner, and native CDP + ZAP session driver.
 */

import fs from 'node:fs';
import {
  CdpConnection,
  CDP_SNAPSHOT_RUNTIME,
  findChromeExecutable,
  getCdpVersion,
  installCdpPageHelpers,
  launchChrome,
  type LaunchedChrome,
  type LaunchOptions,
} from './cdp.js';
import { PAGE_BUNDLE } from './page-bundle.js';
import {
  WEBMCP_PAGE_BOOTSTRAP,
  WebMCPCatalogTracker,
  buildWebMcpSummary,
  delimitUntrusted,
  formatWebMcpSummaryText,
  isWebMCPDisabled,
  makeProvenanceNonce,
  truncateUtf8Description,
  utf8ByteLength,
  type WebMCPSummaryPayload,
  type WebMCPToolSchema,
  type WebMCPToolSummary,
} from './webmcp.js';
import {
  ZapTransport,
  callZap,
  decodeZapProviders,
  defaultZapSocketPath,
  encodeZapCmd,
  encodeZapFrame,
  encodeZapHello,
  ERROR,
  getSessionsViaZap,
  HELLO,
  matchSocialSessionsFromCookies,
  PROVIDERS,
  PROVIDERS_LIST,
  RESPONSE,
  ROLE_CONSUMER,
  ROLE_PROVIDER,
  ROUTE,
  SOCIAL_COOKIE_RULES,
  WELCOME,
  type DetectedSession,
  type SocialCookieRule,
  type ZapBrowserEntry,
} from './zap.js';
import { RawWebSocket } from './ws.js';
import {
  buildEngineArgs,
  findEngineBinary,
  findFreePort,
  launchEngine,
  shouldEnableWebMCP,
  WEBMCP_CHROME_FLAGS,
  type BrowserEngine,
  type EngineLaunchOptions,
  type SpawnedEngine,
} from './engines.js';
import {
  getSandboxConfig,
  sandboxResume,
  sandboxStart,
  sandboxStatus,
  sandboxStop,
  sandboxSuspend,
  type SandboxConfig,
  type SandboxStartOptions,
  type SandboxState,
  type SandboxStatusResult,
} from './sandbox.js';
import {
  test,
  describe,
  expect,
  defineConfig,
  Page,
  Locator,
  Route,
  runTestSuite,
  type HanzoTestConfig,
  type RouteFulfillOptions,
} from './test.js';

export {
  CdpConnection,
  CDP_SNAPSHOT_RUNTIME,
  PAGE_BUNDLE,
  RawWebSocket,
  ZapTransport,
  WEBMCP_CHROME_FLAGS,
  WEBMCP_PAGE_BOOTSTRAP,
  WebMCPCatalogTracker,
  SOCIAL_COOKIE_RULES,
  HELLO,
  WELCOME,
  PROVIDERS_LIST,
  PROVIDERS,
  ERROR,
  ROUTE,
  RESPONSE,
  ROLE_PROVIDER,
  ROLE_CONSUMER,
  buildEngineArgs,
  buildWebMcpSummary,
  callZap,
  decodeZapProviders,
  defaultZapSocketPath,
  delimitUntrusted,
  encodeZapCmd,
  encodeZapFrame,
  encodeZapHello,
  findChromeExecutable,
  findEngineBinary,
  findFreePort,
  formatWebMcpSummaryText,
  getCdpVersion,
  getSandboxConfig,
  getSessionsViaZap,
  isWebMCPDisabled,
  launchChrome,
  launchEngine,
  makeProvenanceNonce,
  matchSocialSessionsFromCookies,
  sandboxResume,
  sandboxStart,
  sandboxStatus,
  sandboxStop,
  sandboxSuspend,
  shouldEnableWebMCP,
  truncateUtf8Description,
  utf8ByteLength,
  // Lightweight zero-Playwright E2E test runner exports
  test,
  describe,
  expect,
  defineConfig,
  Page,
  Locator,
  Route,
  runTestSuite,
  type BrowserEngine,
  type DetectedSession,
  type EngineLaunchOptions,
  type HanzoTestConfig,
  type LaunchedChrome,
  type LaunchOptions,
  type RouteFulfillOptions,
  type SandboxConfig,
  type SandboxStartOptions,
  type SandboxState,
  type SandboxStatusResult,
  type SocialCookieRule,
  type SpawnedEngine,
  type WebMCPSummaryPayload,
  type WebMCPToolSchema,
  type WebMCPToolSummary,
  type ZapBrowserEntry,
};

export interface BrowserSessionOptions extends Omit<LaunchOptions, 'engine'> {
  /** Engine selection: `chrome`, `lightpanda`, `obscura`, or `extension` (ZAP). */
  engine?: BrowserEngine;
  /** Transport preference: 'auto' tries ZAP first unless `headless: true`, `cdpEndpoint`, or `mode: 'cdp'` is set. */
  mode?: 'auto' | 'zap' | 'cdp';
  /** Enable/disable WebMCP (alias for `!noWebmcp`). */
  webmcp?: boolean;
  cdpEndpoint?: string;
  zapSocketPath?: string;
  targetBrowser?: string;
  tabId?: string | number;
}

export interface ActionResult<T = Record<string, unknown>> {
  data: T & { webmcp?: WebMCPSummaryPayload };
}

export class BrowserSession {
  public readonly mode: 'zap' | 'cdp';
  public readonly noWebmcp: boolean;
  private zap?: ZapTransport;
  private zapProvider?: string;
  private cdp?: CdpConnection;
  private launched?: LaunchedChrome;
  private targetId?: string;
  private sessionId?: string;
  private tabId?: string;
  private webmcpTracker = new WebMCPCatalogTracker();

  private constructor(init: {
    mode: 'zap' | 'cdp';
    noWebmcp: boolean;
    zap?: ZapTransport;
    zapProvider?: string;
    cdp?: CdpConnection;
    launched?: LaunchedChrome;
    targetId?: string;
    sessionId?: string;
    tabId?: string;
  }) {
    this.mode = init.mode;
    this.noWebmcp = init.noWebmcp;
    this.zap = init.zap;
    this.zapProvider = init.zapProvider;
    this.cdp = init.cdp;
    this.launched = init.launched;
    this.targetId = init.targetId;
    this.sessionId = init.sessionId;
    this.tabId = init.tabId;
  }

  static async create(opts: BrowserSessionOptions = {}): Promise<BrowserSession> {
    const noWebmcp = isWebMCPDisabled(opts.noWebmcp || opts.webmcp === false);
    const modePref = opts.engine === 'extension' ? 'zap' : (opts.mode ?? 'auto');

    if (modePref !== 'cdp' && !opts.cdpEndpoint && opts.headless !== true) {
      const zap = new ZapTransport(opts.zapSocketPath);
      const provider = await zap.resolveProvider(opts.targetBrowser);
      if (provider) {
        return new BrowserSession({
          mode: 'zap',
          noWebmcp,
          zap,
          zapProvider: provider,
          tabId: opts.tabId !== undefined ? String(opts.tabId) : undefined,
        });
      }
      if (modePref === 'zap') {
        throw new Error(`No browser connected on ZAP router (${zap.socketPath})`);
      }
    }

    let cdp: CdpConnection;
    let launched: LaunchedChrome | undefined;
    const cdpEngine = opts.engine && opts.engine !== 'extension' ? opts.engine : 'chrome';
    if (opts.cdpEndpoint) {
      cdp = await CdpConnection.connect(opts.cdpEndpoint);
    } else {
      launched = await launchChrome({ ...opts, engine: cdpEngine, noWebmcp });
      cdp = launched.connection;
    }

    const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>('Target.getTargets');
    let pageTarget = targets.targetInfos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    if (!pageTarget) {
      const created = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      pageTarget = { targetId: created.targetId, type: 'page', url: 'about:blank' };
    }
    const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: pageTarget.targetId,
      flatten: true,
    });
    await installCdpPageHelpers(cdp, attached.sessionId, noWebmcp);

    return new BrowserSession({
      mode: 'cdp',
      noWebmcp,
      cdp,
      launched,
      targetId: pageTarget.targetId,
      sessionId: attached.sessionId,
    });
  }

  private zapParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...(this.tabId ? { tabId: this.tabId } : {}),
      ...(this.noWebmcp ? { noWebmcp: 'true' } : {}),
      ...extra,
    };
  }

  private async ensureCdpPageEngine(): Promise<void> {
    if (!this.cdp || !this.sessionId) return;
    const present = await this.evaluate<boolean>('typeof globalThis.__hanzoPage === "function"').catch(() => false);
    if (!present) {
      await this.cdp.send('Runtime.evaluate', { expression: PAGE_BUNDLE }, this.sessionId);
    }
  }

  private async runCdpPage<T = Record<string, any>>(req: Record<string, unknown>): Promise<T> {
    await this.ensureCdpPageEngine();
    const res = await this.evaluate<any>(`globalThis.__hanzoPage(${JSON.stringify(req)})`);
    if (!res || res.ok === false) {
      throw new Error(res?.error || `Page action ${String(req.op)} failed`);
    }
    const { ok: _ok, _sync, ...rest } = res;
    if (_sync && typeof req.text === 'string') {
      await this.evaluate(`(() => {
        const el = document.querySelector('[data-hanzo-sync=' + ${JSON.stringify(String(_sync))} + ']');
        if (!el) return;
        el.removeAttribute('data-hanzo-sync');
        const tr = el._valueTracker;
        if (tr && typeof tr.setValue === 'function') tr.setValue('__hanzo_prev__');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`).catch(() => {});
    }
    return rest as T;
  }

  private async observeCdpWebMcp(): Promise<WebMCPSummaryPayload | undefined> {
    if (this.noWebmcp || !this.cdp || !this.sessionId) return undefined;
    try {
      const evalRes = await this.cdp.send<any>(
        'Runtime.evaluate',
        {
          expression: `${WEBMCP_PAGE_BOOTSTRAP}; globalThis.__hanzoWebMCP.list()`,
          returnByValue: true,
          awaitPromise: true,
        },
        this.sessionId,
      );
      const val = evalRes?.result?.value;
      if (!val || !Array.isArray(val.tools)) return this.webmcpTracker.markUnavailable();
      return this.webmcpTracker.update([{
        frameId: '0',
        origin: String(val.origin || 'null'),
        tools: val.tools,
      }]);
    } catch {
      return this.webmcpTracker.markUnavailable();
    }
  }

  async open(url: string): Promise<Record<string, any>> {
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.navigate', this.zapParams({ url }), { provider: this.zapProvider });
    }
    const nav = await this.cdp!.send<{ frameId: string }>('Page.navigate', { url }, this.sessionId);
    await this.waitForLoad();
    await this.ensureCdpPageEngine();
    const title = await this.title();
    const webmcp = await this.observeCdpWebMcp();
    return { url: await this.url(), title, frameId: nav.frameId, ...(webmcp ? { webmcp } : {}) };
  }

  async navigate(url: string): Promise<Record<string, any>> {
    return this.open(url);
  }

  async waitForLoad(timeoutMs = 15_000): Promise<void> {
    if (this.mode === 'zap') {
      await this.zap!.call('hanzo.wait', this.zapParams({ timeout: timeoutMs }), { provider: this.zapProvider }).catch(() => {});
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rs = await this.evaluate<string>('document.readyState').catch(() => 'loading');
      if (rs === 'complete' || rs === 'interactive') return;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  async snapshot(opts: { interactive?: boolean; compact?: boolean; depth?: number; selector?: string } = {}): Promise<Record<string, any>> {
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.snapshot', this.zapParams(opts), { provider: this.zapProvider });
    }
    const raw = await this.runCdpPage<Record<string, any>>({ op: 'snapshot', ...opts });
    const webmcp = await this.observeCdpWebMcp();
    return { ...(raw || {}), ...(webmcp ? { webmcp } : {}) };
  }

  async read(opts: { selector?: string; main?: boolean } = {}): Promise<Record<string, any>> {
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.read', this.zapParams(opts), { provider: this.zapProvider });
    }
    return this.runCdpPage<Record<string, any>>({ op: 'read', ...opts });
  }

  async click(selector: string): Promise<Record<string, any>> {
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.act', this.zapParams({ op: 'click', selector }), { provider: this.zapProvider });
    }
    const res = await this.runCdpPage<Record<string, any>>({ op: 'click', selector });
    const webmcp = await this.observeCdpWebMcp();
    return { ...res, ...(webmcp ? { webmcp } : {}) };
  }

  async fill(selector: string, value: string): Promise<Record<string, any>> {
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.act', this.zapParams({ op: 'fill', selector, text: value }), { provider: this.zapProvider });
    }
    const res = await this.runCdpPage<Record<string, any>>({ op: 'fill', selector, text: value });
    const webmcp = await this.observeCdpWebMcp();
    return { ...res, ...(webmcp ? { webmcp } : {}) };
  }

  async type(selectorOrText: string, maybeText?: string): Promise<Record<string, any>> {
    const selector = maybeText !== undefined ? selectorOrText : undefined;
    const text = maybeText !== undefined ? maybeText : selectorOrText;
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.act', this.zapParams({ op: 'type', ...(selector ? { selector } : {}), text }), { provider: this.zapProvider });
    }
    const res = await this.runCdpPage<Record<string, any>>({ op: 'type', ...(selector ? { selector } : {}), text });
    const webmcp = await this.observeCdpWebMcp();
    return { ...res, ...(webmcp ? { webmcp } : {}) };
  }

  async press(key: string, selector?: string): Promise<Record<string, any>> {
    if (this.mode === 'zap') {
      return this.zap!.call('hanzo.act', this.zapParams({ op: 'press', key, ...(selector ? { selector } : {}) }), { provider: this.zapProvider });
    }
    return this.runCdpPage<Record<string, any>>({ op: 'press', key, ...(selector ? { selector } : {}) });
  }

  async tabs(): Promise<Array<{ id: string; url: string; title: string; type?: string }>> {
    if (this.mode === 'zap') {
      const r = await this.zap!.call<any>('Target.getTargets', {}, { provider: this.zapProvider });
      const list = Array.isArray(r?.targetInfos) ? r.targetInfos : Array.isArray(r) ? r : [];
      return list.map((t: any) => ({
        id: String(t.targetId ?? t.id ?? ''),
        url: String(t.url ?? ''),
        title: String(t.title ?? ''),
        type: String(t.type ?? 'page'),
      }));
    }
    const r = await this.cdp!.send<{ targetInfos: Array<{ targetId: string; url: string; title: string; type: string }> }>('Target.getTargets');
    return (r.targetInfos || []).filter((t) => t.type === 'page').map((t) => ({
      id: t.targetId,
      url: t.url,
      title: t.title || '',
      type: t.type,
    }));
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    if (this.mode === 'zap') {
      const res = await this.zap!.call<any>('Runtime.evaluate', this.zapParams({ expression }), { provider: this.zapProvider });
      return (res?.result?.value ?? res?.value ?? res) as T;
    }
    const res = await this.cdp!.send<any>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed');
    }
    return res?.result?.value as T;
  }

  async url(): Promise<string> {
    if (this.mode === 'zap') {
      const r = await this.zap!.call<any>('hanzo.url', this.zapParams(), { provider: this.zapProvider });
      return String(r?.result?.value ?? r?.url ?? '');
    }
    return (await this.evaluate<string>('location.href')) || '';
  }

  async title(): Promise<string> {
    if (this.mode === 'zap') {
      const r = await this.zap!.call<any>('hanzo.title', this.zapParams(), { provider: this.zapProvider });
      return String(r?.result?.value ?? r?.title ?? '');
    }
    return (await this.evaluate<string>('document.title')) || '';
  }

  async screenshot(opts: { path?: string; fullPage?: boolean; format?: 'png' | 'jpeg' } = {}): Promise<Buffer> {
    const format = opts.format ?? 'png';
    let b64: string;
    if (this.mode === 'zap') {
      const r = await this.zap!.call<any>('Page.captureScreenshot', this.zapParams({ format, fullPage: opts.fullPage }), { provider: this.zapProvider });
      b64 = String(r?.data ?? '');
    } else {
      const r = await this.cdp!.send<{ data: string }>('Page.captureScreenshot', { format, captureBeyondViewport: Boolean(opts.fullPage) }, this.sessionId);
      b64 = r.data;
    }
    const buf = Buffer.from(b64, 'base64');
    if (opts.path) fs.writeFileSync(opts.path, buf);
    return buf;
  }

  // ── WebMCP methods ──────────────────────────────────────────────────────

  async webmcpList(tool?: string, frame?: string): Promise<{ experimental: true; untrusted: true; tools?: WebMCPToolSchema[]; tool?: WebMCPToolSchema }> {
    if (this.noWebmcp) return { experimental: true, untrusted: true, tools: [] };
    if (this.mode === 'zap') {
      const params = this.zapParams({
        ...(tool ? { tool } : {}),
        ...(frame ? { frame, frameId: frame } : {}),
      });
      try {
        return await this.zap!.call('hanzo.webmcp.list', params, { provider: this.zapProvider });
      } catch {
        return await this.zap!.call('webmcp.list', params, { provider: this.zapProvider });
      }
    }
    const raw = await this.evaluate<any>(`${WEBMCP_PAGE_BOOTSTRAP}; globalThis.__hanzoWebMCP.list()`);
    const all: WebMCPToolSchema[] = (raw?.tools || []).map((t: any) => ({
      name: String(t.name),
      description: String(t.description ?? ''),
      origin: String(raw?.origin || 'null'),
      frameId: '0',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      ...(t.annotations ? { annotations: t.annotations } : {}),
      ...(t.declarative ? { declarative: true } : {}),
    }));
    if (tool) {
      const found = all.find((t) => t.name === tool);
      if (!found) throw new Error(`WebMCP tool ${JSON.stringify(tool)} not found`);
      return { experimental: true, untrusted: true, tool: found };
    }
    return { experimental: true, untrusted: true, tools: all };
  }

  async webmcpInvoke(
    tool: string,
    params: Record<string, unknown> = {},
    opts: { frame?: string; detach?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (this.noWebmcp) {
      throw new Error('webmcp_unsupported: WebMCP is disabled (--no-webmcp / AGENT_BROWSER_NO_WEBMCP=1)');
    }
    if (this.mode === 'zap') {
      const wire = this.zapParams({
        tool,
        params,
        args: params,
        ...(opts.frame ? { frame: opts.frame, frameId: opts.frame } : {}),
        ...(opts.detach ? { detach: true } : {}),
      });
      if (opts.detach) {
        return this.zap!.call('webmcp.invoke', wire, { provider: this.zapProvider });
      }
      try {
        return await this.zap!.call('hanzo.webmcp.call', wire, { provider: this.zapProvider });
      } catch {
        return await this.zap!.call('webmcp.invoke', wire, { provider: this.zapProvider });
      }
    }
    const out = await this.evaluate<any>(
      `${WEBMCP_PAGE_BOOTSTRAP}; globalThis.__hanzoWebMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(params)}, ${Boolean(opts.detach)})`,
    );
    if (!out?.found) throw new Error(`WebMCP tool ${JSON.stringify(tool)} not found`);
    if (opts.detach) {
      return {
        experimental: true,
        untrusted: true,
        detached: true,
        invocationId: out.invocationId,
        status: out.status,
        tool,
        frameId: '0',
        origin: out.origin,
      };
    }
    return {
      experimental: true,
      untrusted: true,
      tool,
      frameId: '0',
      origin: out.origin,
      result: out.result,
    };
  }

  async webmcpCall(
    tool: string,
    args: Record<string, unknown> = {},
    opts: { frame?: string; frameId?: string; detach?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    return this.webmcpInvoke(tool, args, { frame: opts.frame ?? opts.frameId, detach: opts.detach });
  }

  async webmcpResult(invocationId: string): Promise<Record<string, unknown>> {
    if (this.mode === 'zap') {
      return this.zap!.call('webmcp.result', this.zapParams({ invocationId }), { provider: this.zapProvider });
    }
    const out = await this.evaluate<any>(`${WEBMCP_PAGE_BOOTSTRAP}; globalThis.__hanzoWebMCP.result(${JSON.stringify(invocationId)})`);
    if (!out?.found) throw new Error(`WebMCP invocation ${JSON.stringify(invocationId)} not found`);
    return { experimental: true, untrusted: true, frameId: '0', ...out };
  }

  async webmcpCancel(invocationId: string): Promise<Record<string, unknown>> {
    if (this.mode === 'zap') {
      return this.zap!.call('webmcp.cancel', this.zapParams({ invocationId }), { provider: this.zapProvider });
    }
    const out = await this.evaluate<any>(`${WEBMCP_PAGE_BOOTSTRAP}; globalThis.__hanzoWebMCP.cancel(${JSON.stringify(invocationId)})`);
    if (!out?.found) throw new Error(`WebMCP invocation ${JSON.stringify(invocationId)} not found`);
    return { experimental: true, untrusted: true, frameId: '0', ...out };
  }

  // ── LastPass, Vault & Social methods (ZAP Extension) ────────────────────

  async lastpass(
    action: 'status' | 'accounts' | 'openIcon' | 'open-icon' | 'fill',
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const method =
      action === 'open-icon' || action === 'openIcon'
        ? 'lastpass.openIcon'
        : `lastpass.${action}`;
    return this.callExtension(method, params);
  }

  async sessions(): Promise<{ source: 'social.sessions' | 'getCookies-fallback'; sessions: any[] }> {
    if (this.mode !== 'zap' || !this.zap) {
      throw new Error('sessions requires a connected Hanzo Browser Extension over ZAP');
    }
    return getSessionsViaZap(this.zap, { provider: this.zapProvider });
  }

  async callExtension<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.mode !== 'zap' || !this.zap) {
      throw new Error(`${method} requires a connected Hanzo Browser Extension over ZAP`);
    }
    return this.zap.call<T>(method, this.zapParams(params), { provider: this.zapProvider });
  }

  get cdpSession(): { cdp: CdpConnection; sessionId: string; targetId: string } | null {
    if (this.mode !== 'cdp' || !this.cdp || !this.sessionId || !this.targetId) return null;
    return { cdp: this.cdp, sessionId: this.sessionId, targetId: this.targetId };
  }

  async close(): Promise<void> {
    if (this.launched) {
      await this.launched.close();
      this.launched = undefined;
    } else if (this.cdp) {
      this.cdp.close();
      this.cdp = undefined;
    }
  }
}

export async function connectBrowser(opts: BrowserSessionOptions = {}): Promise<BrowserSession> {
  return BrowserSession.create(opts);
}

export async function createBrowser(opts: BrowserSessionOptions = {}): Promise<BrowserSession> {
  return BrowserSession.create(opts);
}
