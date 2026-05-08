#!/usr/bin/env node
/**
 * CDP Bridge Server - Unified browser control interface
 *
 * Provides hanzo.browser(action, params) interface matching hanzo-mcp pattern.
 * Browser extension connects to this server for remote control.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { unwrapEvaluateResult } from './shared/tab-id.js';

interface CDPClient {
  ws: WebSocket;
  id: string;          // Unique ID: "chrome", "firefox", "chrome-2", etc.
  capabilities: string[];
  browser: string;     // Browser type: "chrome", "firefox", "safari", "edge"
  tabId?: number;
}

interface BrowserCommand {
  action: string;
  // Navigation
  url?: string;
  // Selectors
  selector?: string;
  ref?: string;
  element?: string;
  // Input
  text?: string;
  value?: string;
  key?: string;
  // Screenshot
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  filename?: string;
  // Evaluate
  code?: string;
  function?: string;
  expression?: string;
  // Tabs
  tabId?: number;
  tabIndex?: number;
  // Wait
  timeout?: number;
  state?: string;
  // Browser targeting (multi-browser support)
  browser?: string;    // Target browser: "chrome", "firefox", "safari", or unique ID
  // Generic
  [key: string]: any;
}

class CDPBridgeServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, CDPClient> = new Map();
  private pendingCommands: Map<number, { resolve: Function; reject: Function }> = new Map();
  private pendingExtensionRequests: Map<string, { resolve: Function; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private commandId = 0;
  private httpPort: number;

  constructor(port: number = 9223) {
    this.httpPort = port;
    // Restore persisted defaultBrowser so user's "always Firefox" preference
    // survives bridge restarts. The config file is written by the
    // `config` message handler.
    try {
      const cfgPath = path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.hanzo', 'extension', 'config.json',
      );
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        if (cfg && typeof cfg.defaultBrowser === 'string') {
          this.defaultBrowser = cfg.defaultBrowser;
        }
      }
    } catch { /* ignore — startup config is best-effort */ }
    this.wss = new WebSocketServer({ port, path: '/cdp' });

    this.wss.on('connection', (ws) => {
      console.log('[hanzo.browser] Extension connected');

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error: any) {
          console.error('[hanzo.browser] Error:', error.message);
        }
      });

      ws.on('close', () => {
        console.log('[hanzo.browser] Extension disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[hanzo.browser] WebSocket error:', error);
      });
    });

    console.log(`[hanzo.browser] Server listening on ws://localhost:${port}/cdp`);
  }

  /** Assign a unique ID for a browser type (e.g. "chrome", "chrome-2", "firefox") */
  private assignClientId(browser: string): string {
    const existing = Array.from(this.clients.values())
      .filter((c) => c.browser === browser);
    if (existing.length === 0) return browser;
    // Find next available suffix
    for (let i = 2; ; i++) {
      const candidate = `${browser}-${i}`;
      if (!existing.some((c) => c.id === candidate)) return candidate;
    }
  }

  /**
   * Default browser preference order when caller doesn't specify a target.
   * Firefox first because (a) it's the user's primary browser, (b) it's
   * where authenticated sessions typically live (Cloudflare, Porkbun,
   * hanzo.id), (c) Chrome is often a secondary/clean profile that the
   * agent should never silently land on.
   *
   * Override at runtime by writing the `defaultBrowser` config via the
   * `config` action, e.g. `{ action: 'config', key: 'defaultBrowser',
   * value: 'chrome' }`. The override is also persisted to
   * `~/.hanzo/extension/config.json` so it survives bridge restarts.
   */
  private static DEFAULT_BROWSER_PREFERENCE = ['firefox', 'safari', 'edge', 'chrome'] as const;
  private defaultBrowser: string | null = null;

  /** Find a client by browser name/ID. Without a target, picks the
   *  configured default browser (defaults to Firefox) or the first
   *  preferred-order match among connected clients. */
  private resolveClient(target?: string): CDPClient | undefined {
    if (target) {
      // Exact match on ID first (e.g. "chrome-2")
      for (const client of this.clients.values()) {
        if (client.id === target) return client;
      }
      // Then match by browser type (returns first of that type)
      for (const client of this.clients.values()) {
        if (client.browser === target) return client;
      }
      return undefined;
    }
    // No target — prefer the user-configured default browser if connected.
    if (this.defaultBrowser) {
      for (const client of this.clients.values()) {
        if (client.id === this.defaultBrowser || client.browser === this.defaultBrowser) {
          return client;
        }
      }
    }
    // Fall back to the standard preference order. Firefox first because
    // the user's authenticated sessions live there.
    for (const browser of CDPBridgeServer.DEFAULT_BROWSER_PREFERENCE) {
      for (const client of this.clients.values()) {
        if (client.browser === browser) return client;
      }
    }
    // Last resort: any connected client.
    return this.clients.values().next().value;
  }

  private handleMessage(ws: WebSocket, message: any) {
    if (message.type === 'register') {
      const browser = message.browser || 'unknown';
      const id = this.assignClientId(browser);
      this.clients.set(ws, {
        ws,
        id,
        capabilities: message.capabilities || [],
        browser,
      });
      console.log(`[hanzo.browser] Registered ${id} (${browser}):`, message.capabilities?.join(', '));
      // Notify the extension of its assigned ID
      ws.send(JSON.stringify({ type: 'registered', id, browser }));
      return;
    }

    if (message.type === 'config') {
      // Special-case: defaultBrowser is read by resolveClient() so apply it
      // immediately in addition to persisting it. Without this every config
      // change would require a bridge restart.
      if (message.key === 'defaultBrowser') {
        this.defaultBrowser = (message.value as string) || null;
      }
      this.saveConfig(message.key, message.value);
      return;
    }

    // Handle responses from extension for sendToExtension() calls
    if (message.type === 'extension-response' && message.id) {
      const pending = this.pendingExtensionRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingExtensionRequests.delete(message.id);
        pending.resolve(message.result || message);
      }
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pendingCommands.get(message.id);
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
        this.pendingCommands.delete(message.id);
      }
      return;
    }

    if (message.type === 'event') {
      console.log(`[hanzo.browser] Event: ${message.method}`);
    }
  }

  /** Save a config value to ~/.hanzo/extension/config.json */
  private saveConfig(key: string, value: unknown): void {
    const configDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.hanzo',
      'extension',
    );
    const configPath = path.join(configDir, 'config.json');

    try {
      fs.mkdirSync(configDir, { recursive: true });

      let config: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
      config[key] = value;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`[hanzo.browser] Config saved: ${key} = ${JSON.stringify(value)}`);
    } catch (error: any) {
      console.error(`[hanzo.browser] Failed to save config: ${error.message}`);
    }
  }

  /** Get connected browser names */
  getConnectedBrowsers(): string[] {
    return Array.from(this.clients.values())
      .map((c) => c.id || c.browser || 'unknown')
      .filter((b) => b !== 'unknown');
  }

  /** Get detailed info about all connected browsers */
  getConnectedBrowserDetails(): Array<{ id: string; browser: string; capabilities: string[] }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      browser: c.browser,
      capabilities: c.capabilities,
    }));
  }

  private async sendRaw(method: string, params?: any, targetBrowser?: string): Promise<any> {
    const client = this.resolveClient(targetBrowser);
    if (!client) {
      const connected = this.getConnectedBrowsers();
      throw new Error(
        targetBrowser
          ? `Browser "${targetBrowser}" not connected. Connected: [${connected.join(', ')}]`
          : 'No browser extension connected'
      );
    }

    const id = ++this.commandId;

    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject });
      client.ws.send(JSON.stringify({ id, method, params }));

      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`Command timeout (browser: ${client.id})`));
        }
      }, 30000);
    });
  }

  /**
   * Unified hanzo.browser interface - matches mcp__hanzo__browser pattern
   */
  async browser(params: BrowserCommand): Promise<any> {
    const { action, browser: targetBrowser, ...rest } = params;

    // Special action: list connected browsers
    if (action === 'list_browsers' || action === 'browsers') {
      return {
        browsers: this.getConnectedBrowserDetails(),
        count: this.clients.size,
        defaultBrowser: this.defaultBrowser,
        preferenceOrder: CDPBridgeServer.DEFAULT_BROWSER_PREFERENCE,
      };
    }

    // Special action: set the default browser the bridge auto-routes to
    // when no per-call `browser` target is specified. Persisted to
    // ~/.hanzo/extension/config.json so it survives restarts.
    if (action === 'set_default_browser' || action === 'use_browser') {
      const target = (params.browser || params.value || params.target) as string | undefined;
      if (!target) {
        return { ok: false, error: 'browser/value/target required (e.g. "firefox")' };
      }
      this.defaultBrowser = target;
      this.saveConfig('defaultBrowser', target);
      return {
        ok: true,
        defaultBrowser: this.defaultBrowser,
        connected: this.getConnectedBrowserDetails(),
      };
    }

    // Shorthand: b = targetBrowser for all sendRaw/sendToExtension calls below
    const b = targetBrowser;

    // Universal tab targeting: a `tabId` or `tabIndex` on the incoming command
    // applies to every downstream sendRaw call so the user can pin a specific
    // tab without repeating it. Without this, every action falls back to
    // `chrome.tabs.query({active:true,currentWindow:true})[0]` — which is
    // fragile when the user has many windows / a chrome://newtab in focus.
    const tabTarget = (extra?: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...(extra || {}) };
      if (rest.tabId !== undefined) out.tabId = rest.tabId;
      if (rest.tabIndex !== undefined) out.tabIndex = rest.tabIndex;
      if (rest.targetId !== undefined && out.tabId === undefined) out.tabId = rest.targetId;
      return out;
    };

    switch (action) {
      // Navigation
      case 'navigate':
        return this.sendRaw('Page.navigate', tabTarget({ url: rest.url }), b);

      case 'navigate_back':
      case 'go_back':
        return this.sendRaw('Page.goBack', tabTarget(), b);

      case 'navigate_forward':
      case 'go_forward':
        return this.sendRaw('Page.goForward', tabTarget(), b);

      case 'reload':
        return this.sendRaw('Page.reload', tabTarget(), b);

      case 'url':
        return this.sendRaw('hanzo.url', tabTarget(), b);

      case 'title':
        return this.sendRaw('hanzo.title', tabTarget(), b);

      case 'tab_info':
        return this.sendRaw('hanzo.tabInfo', tabTarget(), b);

      case 'content':
        return this.sendRaw('Runtime.evaluate', tabTarget({
          expression: 'document.documentElement.outerHTML',
          returnByValue: true
        }), b);

      // Screenshots
      case 'screenshot': {
        const screenshot = await this.sendRaw('hanzo.screenshot', tabTarget({
          format: rest.format || 'png',
          fullPage: rest.fullPage,
        }), b);
        if (rest.filename && screenshot?.data) {
          const buffer = Buffer.from(screenshot.data, 'base64');
          fs.writeFileSync(rest.filename, buffer);
          return { saved: rest.filename, bytes: buffer.length, data: screenshot.data };
        }
        return screenshot;
      }

      case 'snapshot':
        // Accessibility snapshot
        return this.sendRaw('Accessibility.getFullAXTree', tabTarget(), b);

      // Input - Click
      case 'click':
        return this.sendRaw('hanzo.click', tabTarget({
          selector: rest.selector || rest.ref,
        }), b);

      case 'dblclick':
      case 'double_click':
        return this.sendRaw('hanzo.dblclick', tabTarget({
          selector: rest.selector || rest.ref,
        }), b);

      case 'hover':
        return this.sendRaw('hanzo.hover', tabTarget({
          selector: rest.selector || rest.ref,
        }), b);

      // Input - Type
      case 'type':
        return this.sendRaw('hanzo.type', tabTarget({
          selector: rest.selector || rest.ref,
          text: rest.text,
        }), b);

      case 'fill':
        return this.sendRaw('hanzo.fill', tabTarget({
          selector: rest.selector || rest.ref,
          value: rest.value || rest.text,
        }), b);

      case 'clear':
        return this.sendRaw('hanzo.clear', tabTarget({
          selector: rest.selector || rest.ref,
        }), b);

      case 'press_key':
      case 'press':
        return this.sendRaw('Input.dispatchKeyEvent', tabTarget({
          type: 'keyDown',
          key: rest.key,
        }), b);

      // Forms
      case 'select_option':
        return this.sendRaw('hanzo.select', tabTarget({
          selector: rest.selector || rest.ref,
          value: rest.value,
        }), b);

      case 'check':
        return this.sendRaw('hanzo.check', tabTarget({
          selector: rest.selector || rest.ref,
        }), b);

      case 'uncheck':
        return this.sendRaw('hanzo.uncheck', tabTarget({
          selector: rest.selector || rest.ref,
        }), b);

      // Aliases for the navigation cases above. We attach `get_url`,
      // `get_title`, `get_tab_info`, `get_history`, `wait_for_navigation`,
      // `create_tab` here. Note that `go_back`, `go_forward`, `tab_info`,
      // and `history` are already aliased in the upper block — TS picks
      // the first matching case-label so duplicates here would be dead
      // code. Consolidating once and for all to avoid that confusion.
      case 'get_url':
        return this.sendRaw('hanzo.url', tabTarget(), b);

      case 'get_title':
        return this.sendRaw('hanzo.title', tabTarget(), b);

      case 'get_tab_info':
        return this.sendRaw('hanzo.tabInfo', tabTarget(), b);

      case 'get_history':
        return this.sendRaw('hanzo.getHistory', tabTarget({ maxResults: rest.maxResults }), b);

      case 'wait_for_navigation':
        return this.sendRaw('hanzo.waitForNavigation', tabTarget({ timeout: rest.timeout }), b);

      case 'create_tab':
        return this.sendRaw('Target.createTarget', { url: rest.url || 'about:blank' }, b);

      // Fetch through browser context (uses page cookies/auth)
      case 'fetch': {
        const fetchResult = await this.sendRaw('hanzo.fetch', {
          url: rest.url,
          options: {
            method: rest.method || rest.options?.method,
            headers: rest.headers || rest.options?.headers,
            body: rest.body || rest.options?.body,
            mode: rest.mode || rest.options?.mode,
            credentials: rest.credentials || rest.options?.credentials,
          },
        }, b);
        return fetchResult;
      }

      // Selectors / Waiting
      case 'wait_for_selector':
        return this.sendRaw('hanzo.waitForSelector', { selector: rest.selector, timeout: rest.timeout }, b);

      case 'query_selector_all':
        return this.sendRaw('hanzo.querySelectorAll', { selector: rest.selector }, b);

      case 'get_element_info':
        return this.sendRaw('hanzo.getElementInfo', { selector: rest.selector }, b);

      case 'get_page_info':
        return this.sendRaw('hanzo.getPageInfo', {}, b);

      // DOM Read/Write/Observe
      case 'get_html':
        return this.sendRaw('hanzo.getHTML', { selector: rest.selector, outer: rest.outer }, b);

      case 'set_html':
        return this.sendRaw('hanzo.setHTML', { selector: rest.selector, html: rest.html, outer: rest.outer }, b);

      case 'get_text':
        return this.sendRaw('hanzo.getText', { selector: rest.selector }, b);

      case 'set_text':
        return this.sendRaw('hanzo.setText', { selector: rest.selector, text: rest.text }, b);

      case 'get_attribute':
        return this.sendRaw('hanzo.getAttribute', { selector: rest.selector, attr: rest.attr }, b);

      case 'set_attribute':
        return this.sendRaw('hanzo.setAttribute', { selector: rest.selector, attr: rest.attr, value: rest.value }, b);

      case 'remove_attribute':
        return this.sendRaw('hanzo.removeAttribute', { selector: rest.selector, attr: rest.attr }, b);

      case 'set_style':
        return this.sendRaw('hanzo.setStyle', { selector: rest.selector, styles: rest.styles }, b);

      case 'add_class':
        return this.sendRaw('hanzo.addClass', { selector: rest.selector, classNames: rest.classNames }, b);

      case 'remove_class':
        return this.sendRaw('hanzo.removeClass', { selector: rest.selector, classNames: rest.classNames }, b);

      case 'insert_element':
        return this.sendRaw('hanzo.insertElement', { selector: rest.selector, html: rest.html, position: rest.position }, b);

      case 'remove_element':
        return this.sendRaw('hanzo.removeElement', { selector: rest.selector }, b);

      case 'observe_mutations':
        return this.sendRaw('hanzo.observeMutations', { selector: rest.selector, options: rest.options, duration: rest.duration }, b);

      case 'computed_styles':
        return this.sendRaw('hanzo.getComputedStyles', { selector: rest.selector, properties: rest.properties }, b);

      case 'bounding_rects':
        return this.sendRaw('hanzo.getBoundingRects', { selector: rest.selector }, b);

      case 'inject_script':
        return this.sendRaw('hanzo.injectScript', { url: rest.url }, b);

      case 'inject_css':
        return this.sendRaw('hanzo.injectCSS', { css: rest.css }, b);

      case 'local_storage':
        if (rest.value !== undefined) {
          return this.sendRaw('hanzo.setLocalStorage', tabTarget({ key: rest.key, value: rest.value }), b);
        }
        return this.sendRaw('hanzo.getLocalStorage', tabTarget({ key: rest.key }), b);

      case 'cookies':
        return this.sendRaw('hanzo.getCookies', tabTarget(), b);

      // Evaluate.
      //
      // awaitPromise: true tells CDP to wait for any async IIFE to resolve
      // before returning. Without it, expressions like
      //   (async () => fetch('/x').then(r => r.json()))()
      // serialise as `{}` (a Promise placeholder) and the caller can't
      // distinguish "the page evaluated to {}" from "the bridge swallowed
      // the result". We then route through `unwrapEvaluateResult` (the
      // shared helper from shared/tab-id.ts) which handles every shape
      // Chrome / Firefox / Safari extensions can hand back.
      case 'evaluate': {
        const evalResult = await this.sendRaw('Runtime.evaluate', tabTarget({
          expression: rest.code || rest.function || rest.expression,
          returnByValue: true,
          awaitPromise: true,
        }), b);
        return { result: unwrapEvaluateResult(evalResult), raw: evalResult };
      }

      // Wait
      case 'wait':
        await new Promise(resolve => setTimeout(resolve, (rest.timeout || 1) * 1000));
        return { waited: rest.timeout || 1 };

      case 'wait_for_load':
        return this.sendRaw('Page.waitForLoadState', tabTarget({
          state: rest.state || 'load',
        }), b);

      // Tabs
      case 'tabs':
      case 'list_tabs':
        return this.sendRaw('Target.getTargets', undefined, b);

      case 'new_tab':
        return this.sendRaw('Target.createTarget', { url: rest.url || 'about:blank' }, b);

      case 'close_tab':
        return this.sendRaw('Target.closeTarget', { targetId: rest.tabId }, b);

      case 'select_tab':
        return this.sendRaw('Target.activateTarget', { targetId: rest.tabId }, b);

      // Console/Network — routed to PageMonitor via extension background
      case 'console_messages':
      case 'console':
      case 'console_logs':
        return this.sendToExtension('monitor.consoleLogs', { tabId: rest.tabId }, b);

      case 'console_errors':
        return this.sendToExtension('monitor.consoleErrors', { tabId: rest.tabId }, b);

      case 'network_requests':
      case 'network_logs':
        return this.sendToExtension('monitor.networkLogs', { tabId: rest.tabId }, b);

      case 'network_errors':
        return this.sendToExtension('monitor.networkErrors', { tabId: rest.tabId }, b);

      case 'network_success':
        return this.sendToExtension('monitor.networkSuccess', { tabId: rest.tabId }, b);

      case 'wipe_logs':
        return this.sendToExtension('monitor.wipeLogs', { tabId: rest.tabId }, b);

      case 'start_monitoring':
        return this.sendToExtension('monitor.start', { tabId: rest.tabId }, b);

      case 'stop_monitoring':
        return this.sendToExtension('monitor.stop', { tabId: rest.tabId }, b);

      case 'monitor_status':
        return this.sendToExtension('monitor.status', {}, b);

      // Audits — routed to AuditRunner via extension background
      case 'accessibility_audit':
        return this.sendToExtension('audit.accessibility', { tabId: rest.tabId }, b);

      case 'performance_audit':
        return this.sendToExtension('audit.performance', { tabId: rest.tabId }, b);

      case 'seo_audit':
        return this.sendToExtension('audit.seo', { tabId: rest.tabId }, b);

      case 'best_practices_audit':
        return this.sendToExtension('audit.bestPractices', { tabId: rest.tabId }, b);

      case 'full_audit':
        return this.sendToExtension('audit.full', { tabId: rest.tabId }, b);

      case 'nextjs_audit':
        return this.sendToExtension('audit.nextjs', { tabId: rest.tabId }, b);

      case 'debugger_mode':
      case 'debug':
        return this.sendToExtension('debugger.mode', { tabId: rest.tabId }, b);

      // Ollama / Local LLM
      case 'ollama_models':
        return this.sendToExtension('ollama.models', {}, b);

      case 'ollama_chat':
        return this.sendToExtension('ollama.chat', { model: rest.model, messages: rest.messages, options: rest.options }, b);

      case 'local_chat':
        return this.sendToExtension('local.chat', { provider: rest.provider, endpoint: rest.endpoint, model: rest.model, messages: rest.messages, options: rest.options, apiKey: rest.apiKey }, b);

      case 'local_models':
        return this.sendToExtension('local.models', { provider: rest.provider, endpoint: rest.endpoint, apiKey: rest.apiKey }, b);

      case 'local_discover':
        return this.sendToExtension('local.discover', {}, b);

      // Model Hub — browse, search, download
      case 'hub_search':
        return this.sendToExtension('hub.search', { query: rest.query, filter: rest.filter, sort: rest.sort, limit: rest.limit, author: rest.author }, b);

      case 'hub_search_gguf':
        return this.sendToExtension('hub.searchGGUF', { query: rest.query, limit: rest.limit }, b);

      case 'hub_model':
        return this.sendToExtension('hub.model', { modelId: rest.modelId }, b);

      case 'hub_recommended':
        return this.sendToExtension('hub.recommended', {}, b);

      case 'hub_search_ollama':
        return this.sendToExtension('hub.searchOllama', { query: rest.query }, b);

      case 'hub_download_ollama':
        return this.sendToExtension('hub.downloadOllama', { modelName: rest.modelName, ollamaUrl: rest.ollamaUrl }, b);

      case 'hub_download_hf':
        return this.sendToExtension('hub.downloadHF', { downloadUrl: rest.downloadUrl }, b);

      case 'hub_all_models':
        return this.sendToExtension('hub.allModels', {}, b);

      case 'hub_search_mlx':
        return this.sendToExtension('hub.searchMLX', { query: rest.query, limit: rest.limit }, b);

      case 'hub_model_card':
        return this.sendToExtension('hub.modelCard', { modelId: rest.modelId }, b);

      case 'hub_model_stats':
        return this.sendToExtension('hub.modelStats', { modelId: rest.modelId }, b);

      // Status
      case 'status':
        return {
          connected: this.clients.size > 0,
          clients: this.clients.size,
          browsers: this.getConnectedBrowserDetails(),
          port: this.httpPort
        };

      default:
        // Pass through as raw CDP command
        return this.sendRaw(action, rest, b);
    }
  }

  // Send a message to the extension background and wait for response
  private sendToExtension(action: string, params: any, targetBrowser?: string): Promise<any> {
    return new Promise((resolve) => {
      const client = this.resolveClient(targetBrowser);
      if (!client) {
        const connected = this.getConnectedBrowsers();
        resolve({
          error: targetBrowser
            ? `Browser "${targetBrowser}" not connected. Connected: [${connected.join(', ')}]`
            : 'No browser extension connected'
        });
        return;
      }

      const id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timeout = setTimeout(() => {
        this.pendingExtensionRequests.delete(id);
        resolve({ error: `Extension request timed out (browser: ${client.id})` });
      }, 30000);

      this.pendingExtensionRequests.set(id, { resolve, timeout });

      client.ws.send(JSON.stringify({
        type: 'extension-request',
        id,
        action,
        params,
      }));
    });
  }

  isConnected(): boolean {
    return this.clients.size > 0;
  }

  close() {
    this.wss.close();
  }
}

// JSON-RPC server for MCP integration
async function startJSONRPCServer(bridgeServer: CDPBridgeServer) {
  const http = require('http');

  const httpServer = http.createServer(async (req: any, res: any) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: string) => body += chunk);
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const result = await bridgeServer.browser(request.params || request);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          // Return result directly (no extra wrapping — Python expects flat dict)
          res.end(JSON.stringify(result && typeof result === 'object' ? result : { result }));
        } catch (error: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } else {
      // GET - return status
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: 'hanzo.browser',
        connected: bridgeServer.isConnected(),
        browsers: bridgeServer.getConnectedBrowserDetails(),
        actions: [
          'list_browsers', 'browsers',
          'navigate', 'navigate_back', 'reload', 'url', 'title', 'content',
          'screenshot', 'snapshot',
          'click', 'dblclick', 'hover', 'type', 'fill', 'clear', 'press_key',
          'select_option', 'check', 'uncheck',
          'evaluate',
          'go_back', 'go_forward', 'get_url', 'get_title', 'get_tab_info',
          'wait_for_navigation', 'get_history', 'create_tab', 'close_tab',
          'fetch',
          'get_html', 'set_html', 'get_text', 'set_text',
          'get_attribute', 'set_attribute', 'remove_attribute',
          'set_style', 'add_class', 'remove_class',
          'insert_element', 'remove_element',
          'observe_mutations', 'computed_styles', 'bounding_rects',
          'inject_script', 'inject_css',
          'local_storage', 'cookies',
          'wait', 'wait_for_load',
          'tabs', 'new_tab', 'close_tab', 'select_tab',
          'console_logs', 'console_errors', 'network_logs', 'network_errors', 'network_success',
          'start_monitoring', 'stop_monitoring', 'monitor_status', 'wipe_logs',
          'accessibility_audit', 'performance_audit', 'seo_audit', 'best_practices_audit', 'full_audit',
          'nextjs_audit', 'debugger_mode',
          'ollama_models', 'ollama_chat', 'local_chat', 'local_models', 'local_discover',
          'hub_search', 'hub_search_gguf', 'hub_search_mlx', 'hub_model', 'hub_model_card',
          'hub_model_stats', 'hub_recommended',
          'hub_search_ollama', 'hub_download_ollama', 'hub_download_hf', 'hub_all_models',
          'takeover.start', 'takeover.end', 'takeover.cursor',
          'status'
        ]
      }));
    }
  });

  httpServer.listen(9224, () => {
    console.log('[hanzo.browser] HTTP API at http://localhost:9224');
  });
}

// Interactive CLI
async function main() {
  const port = parseInt(process.env.CDP_PORT || '9223');
  const server = new CDPBridgeServer(port);

  // Start HTTP API
  startJSONRPCServer(server);

  console.log('\n[hanzo.browser] Commands:');
  console.log('  navigate <url>      - Go to URL');
  console.log('  screenshot [file]   - Capture screen');
  console.log('  click <selector>    - Click element');
  console.log('  type <sel> <text>   - Type into element');
  console.log('  eval <js>           - Run JavaScript');
  console.log('  tabs                - List all tabs');
  console.log('  status              - Connection status');
  console.log('  quit                - Exit\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = () => {
    rl.question('hanzo.browser> ', async (line) => {
      const parts = line.trim().split(' ');
      const action = parts[0];
      const args = parts.slice(1);

      if (!action) {
        prompt();
        return;
      }

      try {
        let result;

        switch (action) {
          case 'quit':
          case 'exit':
            server.close();
            rl.close();
            process.exit(0);

          case 'navigate':
            result = await server.browser({ action: 'navigate', url: args[0] });
            console.log('Navigated to:', args[0]);
            break;

          case 'screenshot':
            result = await server.browser({
              action: 'screenshot',
              filename: args[0] || `screenshot-${Date.now()}.png`
            });
            console.log('Screenshot:', result);
            break;

          case 'click':
            result = await server.browser({ action: 'click', selector: args[0] });
            console.log('Clicked:', args[0]);
            break;

          case 'type':
            result = await server.browser({
              action: 'type',
              selector: args[0],
              text: args.slice(1).join(' ')
            });
            console.log('Typed into:', args[0]);
            break;

          case 'eval':
            result = await server.browser({
              action: 'evaluate',
              expression: args.join(' ')
            });
            console.log('Result:', result?.result?.value);
            break;

          case 'tabs':
            result = await server.browser({ action: 'tabs' });
            console.log('Tabs:', result?.targetInfos?.map((t: any) => t.title).join(', '));
            break;

          case 'status':
            result = await server.browser({ action: 'status' });
            console.log('Status:', result);
            break;

          case 'url':
            result = await server.browser({ action: 'url' });
            console.log('URL:', result?.result?.value);
            break;

          case 'title':
            result = await server.browser({ action: 'title' });
            console.log('Title:', result?.result?.value);
            break;

          default:
            // Try as raw action
            result = await server.browser({ action, ...Object.fromEntries(
              args.map((a, i) => [i === 0 ? 'selector' : `arg${i}`, a])
            )});
            console.log('Result:', result);
        }
      } catch (error: any) {
        console.error('Error:', error.message);
      }

      prompt();
    });
  };

  prompt();
}

export { CDPBridgeServer, BrowserCommand };

if (require.main === module) {
  main();
}
