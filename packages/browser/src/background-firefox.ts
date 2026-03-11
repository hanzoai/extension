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
 * - Uses `browser.tabs.executeScript` instead of `chrome.debugger`
 */

import type { ControlSession, RagSnippet, RagQueryParams } from './shared/types.js';
import {
  createZapManager,
  discoverZapServers,
  connectZap,
  zapRequest,
  zapCallTool,
  hasZapTool,
  handleZapMessage,
  type ZapManager,
} from './shared/zap.js';
import {
  getRagConfig,
  normalizeRagSnippets,
  queryRagFromZap,
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

// Declare browser API for TypeScript
declare const browser: typeof chrome;

interface CDPMessage {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const BROWSER_NAME = 'firefox';
const VERSION = typeof browser !== 'undefined' ? browser.runtime.getManifest().version : '0';

// Shared ZAP manager (replaces inline ZAP protocol code)
const zapMgr: ZapManager = createZapManager();

const controlSession: ControlSession = {
  active: false,
  tabId: null,
  task: null,
  startedAt: null,
};

// Start ZAP discovery on load (using shared module)
discoverZapServers(zapMgr, BROWSER_NAME, VERSION);

// =============================================================================

class HanzoFirefoxExtension {
  private wsConnection: WebSocket | null = null;
  private cdpPort: number = 9223;
  private reconnectTimeout: number = 3000;

  constructor() {
    console.log('[Hanzo] Firefox extension initializing...');
    this.connect();
  }

  private connect(): void {
    const url = `ws://localhost:${this.cdpPort}/cdp`;
    console.log(`[Hanzo] Connecting to ${url}`);

    this.wsConnection = new WebSocket(url);

    this.wsConnection.onopen = () => {
      console.log('[Hanzo] WebSocket CONNECTED');
      this.register();
    };

    this.wsConnection.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data as string);

        // Handle extension-request messages from sendToExtension()
        if (message.type === 'extension-request') {
          console.log('[Hanzo] Extension request:', message.action);
          const result = await this.handleExtensionRequest(message.action, message.params || {});
          this.send({ type: 'extension-response', id: message.id, result });
          return;
        }

        console.log('[Hanzo] Received:', message.method || 'response');
        const response = await this.handleCommand(message as CDPMessage);
        this.send(response);
      } catch (e) {
        console.error('[Hanzo] Message handler error:', e);
        this.send({ id: 0, error: { code: -1, message: String(e) } });
      }
    };

    this.wsConnection.onerror = (error) => {
      console.error('[Hanzo] WebSocket error:', error);
    };

    this.wsConnection.onclose = () => {
      console.log('[Hanzo] Disconnected, reconnecting...');
      setTimeout(() => this.connect(), this.reconnectTimeout);
    };
  }

  private register(): void {
    this.send({
      type: 'register',
      role: 'cdp-provider',
      capabilities: [
        'navigate', 'screenshot', 'click', 'dblclick', 'hover', 'type',
        'evaluate', 'tabs', 'fill', 'clear', 'reload', 'goBack', 'goForward',
        'select', 'check', 'uncheck', 'press_key', 'content', 'snapshot',
        'getText', 'getHTML', 'getAttribute', 'getElementInfo', 'getPageInfo',
        'querySelectorAll', 'waitForSelector', 'waitForNavigation',
        'fetch', 'cookies', 'localStorage', 'injectScript', 'injectCSS',
        'createTab', 'closeTab', 'activateTab', 'history',
        'observeMutations', 'computedStyles', 'boundingRects',
        'setHTML', 'setText', 'setAttribute', 'removeAttribute',
        'setStyle', 'addClass', 'removeClass', 'insertElement', 'removeElement',
        'monitor', 'audit'
      ]
    });
  }

  private send(data: unknown): void {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(data));
    }
  }

  private async handleCommand(message: CDPMessage): Promise<CDPResponse> {
    const { id, method, params = {} } = message;

    try {
      const result = await this.executeMethod(method, params);
      return { id, result };
    } catch (e) {
      return { id, error: { code: -1, message: String(e) } };
    }
  }

  /**
   * Wrap executeScript with a timeout to prevent blocking on GPU-heavy pages
   */
  private executeScriptWithTimeout(
    tabId: number,
    code: string,
    timeoutMs: number = 10000
  ): Promise<any[]> {
    return Promise.race([
      browser.tabs.executeScript(tabId, { code }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('executeScript timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Resolve the tab ID to operate on — use explicit tabId/tabIndex param,
   * fall back to the active tab.
   */
  private async resolveTab(params: Record<string, unknown>): Promise<chrome.tabs.Tab> {
    if (typeof params.tabId === 'number') {
      const tab = await browser.tabs.get(params.tabId as number);
      return tab;
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
   * Wraps result to avoid undefined → {} JSON serialization issue.
   */
  private async runInPage(tabId: number, code: string, timeoutMs: number = 10000): Promise<any> {
    const wrappedCode = `
      (function() {
        try {
          var __r = (function() { ${code} })();
          return __r === undefined ? null : __r;
        } catch(__e) {
          return { __hanzo_error: __e.message || String(__e) };
        }
      })()
    `;
    const results = await this.executeScriptWithTimeout(tabId, wrappedCode, timeoutMs);
    const result = results[0];
    if (result && typeof result === 'object' && result.__hanzo_error) {
      throw new Error(result.__hanzo_error);
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
        const closeId = params.targetId
          ? parseInt((params.targetId as string).replace('tab-', ''), 10)
          : params.tabId as number;
        if (closeId) await browser.tabs.remove(closeId);
        return { success: true };
      }

      case 'Target.activateTarget': {
        const activateId = params.targetId
          ? parseInt((params.targetId as string).replace('tab-', ''), 10)
          : params.tabId as number;
        if (activateId) await browser.tabs.update(activateId, { active: true });
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
      case 'Runtime.evaluate': {
        if (!tabId) throw new Error('No active tab');
        const expression = params.expression as string;
        const timeout = (params.timeout as number) || 10000;
        const value = await this.runInPage(tabId, `return ${expression}`, timeout);
        return { result: { value } };
      }

      // =====================================================================
      // Screenshots
      // =====================================================================
      case 'Page.captureScreenshot':
      case 'hanzo.screenshot': {
        const format = (params.format as string) || 'jpeg';
        const quality = (params.quality as number) || (format === 'jpeg' ? 80 : undefined);
        const opts: any = { format: format as 'png' | 'jpeg' };
        if (quality !== undefined) opts.quality = quality;
        const dataUrl = await browser.tabs.captureVisibleTab(opts) as unknown as string;
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        return { data: base64 };
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
        const sel = this.escapeSelector(params.selector as string);
        this.notifyOverlay(tabId, 'ai.control.highlight', { selector: params.selector as string });
        this.notifyOverlay(tabId, 'ai.control.status', { text: `Clicking ${params.selector}` });
        const clicked = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) { el.click(); return true; }
          return false;
        `);
        return { success: !!clicked };
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
        const sel = this.escapeSelector(params.selector as string);
        const val = this.escapeValue((params.value as string) || '');
        this.notifyOverlay(tabId, 'ai.control.highlight', { selector: params.selector as string });
        this.notifyOverlay(tabId, 'ai.control.status', { text: `Filling ${params.selector}` });
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) {
            el.focus();
            el.value = '${val}';
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
          }
        `);
        return { success: true };
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
        const sel = this.escapeSelector(params.selector as string);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el) {
            el.value = '';
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
          }
        `);
        return { success: true };
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
        const sel = this.escapeSelector(params.selector as string);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el && !el.checked) { el.click(); }
        `);
        return { success: true };
      }

      case 'hanzo.uncheck': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          if (el && el.checked) { el.click(); }
        `);
        return { success: true };
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
        const sel = this.escapeSelector(params.selector as string);
        const text = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          return el ? el.textContent : null;
        `);
        return { result: { value: text } };
      }

      case 'hanzo.getHTML': {
        if (!tabId || !params.selector) throw new Error('No active tab or selector');
        const sel = this.escapeSelector(params.selector as string);
        const outer = params.outer !== false;
        const html = await this.runInPage(tabId, `
          var el = document.querySelector('${sel}');
          return el ? ${outer ? 'el.outerHTML' : 'el.innerHTML'} : null;
        `);
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
        const sel = this.escapeSelector(params.selector as string);
        const elements = await this.runInPage(tabId, `
          var els = document.querySelectorAll('${sel}');
          var result = [];
          for (var i = 0; i < Math.min(els.length, 100); i++) {
            var el = els[i];
            var rect = el.getBoundingClientRect();
            result.push({
              index: i, tagName: el.tagName, id: el.id, className: el.className,
              textContent: (el.textContent || '').trim().slice(0, 100),
              value: el.value, href: el.href,
              visible: !!(rect.width && rect.height)
            });
          }
          return result;
        `);
        return { elements: elements || [] };
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

    return { error: `Unknown extension action: ${action}` };
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

  isBridgeConnected(): boolean {
    return this.wsConnection !== null && this.wsConnection.readyState === WebSocket.OPEN;
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
  API_BASE_URL as API_BASE,
  STORAGE_KEYS,
  LOCAL_PROVIDER_DEFAULTS,
} from './shared/config.js';

// Auth: all PKCE, token storage, and IAM logic lives in shared/auth.ts
const ffAdapter: BrowserAdapter = firefoxAdapter();

async function getValidAccessToken(): Promise<string | null> {
  return sharedGetValidAccessToken(ffAdapter.storage);
}

// =============================================================================
// Message Handler
// =============================================================================

browser.runtime.onMessage.addListener((request: any, sender: any, sendResponse: Function) => {
  (async () => {
    // --- ZAP Protocol (handled by shared module) ---
    if (typeof request.action === 'string' && request.action.startsWith('zap.')) {
      if (handleZapMessage(request.action, request, sendResponse, zapMgr, BROWSER_NAME, VERSION)) {
        return;
      }
    }

    switch (request.action) {
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
            useZapMemory: request.useZapMemory !== undefined
              ? !!request.useZapMemory
              : config.useZapMemory,
            endpoint: String(request.endpoint ?? config.endpoint ?? '').trim(),
            apiKey: String(request.apiKey ?? config.apiKey ?? '').trim(),
            mcpId: request.mcpId ? String(request.mcpId) : undefined,
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

          // Try ZAP memory first (via shared module), then HTTP endpoint
          let snippets = await queryRagFromZap(params, zapMgr);
          let source = snippets.length ? 'zap-memory' : 'none';

          if (!snippets.length && params.endpoint) {
            snippets = await queryRagFromEndpoint(params);
            source = snippets.length ? 'rag-endpoint' : source;
          }

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
            'mcpPort', 'cdpPort', 'zapPorts',
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

          const resp = await fetch(`${IAM_API}/api/get-account`, {
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
            const orgsResp = await fetch(`${IAM_API}/api/get-organizations`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(5000),
            });
            if (orgsResp.ok) {
              const orgsData = await orgsResp.json();
              for (const org of (orgsData.data || orgsData || [])) {
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
      // Element Selected (forward to ZAP-connected MCPs)
      // =======================================================================
      case 'elementSelected': {
        if (zapMgr.state.connected) {
          for (const [mcpId] of zapMgr.connections) {
            zapRequest(zapMgr, mcpId, 'notifications/elementSelected', request.data || {}).catch(() => {});
          }
        }
        sendResponse({ success: true });
        break;
      }

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
        const bridgeConnected = hanzoExtension.isBridgeConnected();
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

// End active session when the controlled tab closes.
browser.tabs.onRemoved.addListener((tabId) => {
  if (controlSession.active && controlSession.tabId === tabId) {
    void hanzoExtension.stopControlSession();
  }
});

console.log('[Hanzo] Firefox background script loaded');
