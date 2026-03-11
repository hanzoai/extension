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

interface ControlSession {
  active: boolean;
  tabId: number | null;
  task: string | null;
  startedAt: number | null;
}

interface RagSnippet {
  content: string;
  title?: string;
  source?: string;
  score?: number;
  url?: string;
}

const controlSession: ControlSession = {
  active: false,
  tabId: null,
  task: null,
  startedAt: null,
};

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

// Login UI lives on hanzo.id; Casdoor API is on iam.hanzo.ai
const IAM_LOGIN = 'https://hanzo.id';
const IAM_API = 'https://iam.hanzo.ai';
const API_BASE = 'https://api.hanzo.ai';
const CLIENT_ID = 'app-hanzo';
const SCOPES = 'openid profile email';

const STORAGE_KEYS = {
  accessToken: 'hanzo_iam_access_token',
  refreshToken: 'hanzo_iam_refresh_token',
  idToken: 'hanzo_iam_id_token',
  expiresAt: 'hanzo_iam_expires_at',
  user: 'hanzo_iam_user',
};

// PKCE helpers
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getRagConfig(): Promise<{
  endpoint: string;
  apiKey: string;
  knowledgeBase: string;
  topK: number;
  includeTabContext: boolean;
}> {
  const result = await browser.storage.local.get([
    'hanzo_rag_endpoint',
    'hanzo_rag_api_key',
    'hanzo_rag_kb',
    'hanzo_rag_top_k',
    'hanzo_rag_include_tab_context',
  ]);

  const topKParsed = Number.parseInt(String(result.hanzo_rag_top_k ?? 5), 10);
  return {
    endpoint: String(result.hanzo_rag_endpoint || '').trim(),
    apiKey: String(result.hanzo_rag_api_key || '').trim(),
    knowledgeBase: String(result.hanzo_rag_kb || '').trim(),
    topK: Number.isFinite(topKParsed) ? Math.max(1, Math.min(topKParsed, 20)) : 5,
    includeTabContext: result.hanzo_rag_include_tab_context !== false,
  };
}

function normalizeRagSnippets(raw: any): RagSnippet[] {
  if (!raw) return [];

  const candidates: any[] = [];
  if (Array.isArray(raw)) candidates.push(...raw);
  if (Array.isArray(raw?.snippets)) candidates.push(...raw.snippets);
  if (Array.isArray(raw?.documents)) candidates.push(...raw.documents);
  if (Array.isArray(raw?.items)) candidates.push(...raw.items);
  if (Array.isArray(raw?.results)) candidates.push(...raw.results);

  if (!candidates.length && typeof raw?.content === 'string') {
    candidates.push({ content: raw.content, source: raw.source || 'rag-endpoint' });
  }

  return candidates
    .map((item) => {
      const content = String(item?.content ?? item?.text ?? item?.snippet ?? item?.body ?? '').trim();
      if (!content) return null;
      return {
        content,
        title: item?.title ? String(item.title) : undefined,
        source: item?.source ? String(item.source) : undefined,
        score: typeof item?.score === 'number' ? item.score : undefined,
        url: item?.url ? String(item.url) : undefined,
      } as RagSnippet;
    })
    .filter((item): item is RagSnippet => !!item)
    .slice(0, 20);
}

async function queryRagEndpoint(params: {
  endpoint: string;
  apiKey: string;
  query: string;
  topK: number;
  knowledgeBase: string;
  includeTabContext: boolean;
  pageContext?: { url?: string; title?: string };
}): Promise<RagSnippet[]> {
  if (!params.endpoint) return [];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

  const response = await fetch(params.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: params.query,
      top_k: params.topK,
      knowledge_base: params.knowledgeBase || undefined,
      page_context: params.includeTabContext ? params.pageContext : undefined,
      source: 'hanzo-browser-extension-firefox',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RAG endpoint error ${response.status}: ${text || 'Unknown error'}`);
  }

  const raw = await response.json();
  return normalizeRagSnippets(raw).map((snippet) => ({
    ...snippet,
    source: snippet.source || 'rag-endpoint',
  }));
}

async function firefoxLogin(): Promise<any> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = generateRandomString(32);
  const redirectUri = 'https://hanzo.ai/callback';

  const authorizeUrl = new URL(`${IAM_LOGIN}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', SCOPES);
  authorizeUrl.searchParams.set('state', state);

  // Tab-based auth: open a real browser tab for login
  const callbackUrl = await new Promise<string>((resolve, reject) => {
    let authTabId: number | undefined;
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Login timed out')); }, 300_000);

    function cleanup() {
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    }
    function onUpdated(tabId: number, changeInfo: any) {
      if (tabId !== authTabId || !changeInfo.url) return;
      if (changeInfo.url.startsWith(redirectUri)) {
        cleanup();
        browser.tabs.remove(tabId).catch(() => {});
        resolve(changeInfo.url);
      }
    }
    function onRemoved(tabId: number) {
      if (tabId !== authTabId) return;
      cleanup();
      reject(new Error('Login cancelled'));
    }

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.create({ url: authorizeUrl.toString() }).then((tab: any) => {
      authTabId = tab.id;
    });
  });

  const url = new URL(callbackUrl);
  if (url.searchParams.get('state') !== state) throw new Error('State mismatch');

  // Handle both code flow and implicit token flow responses
  const code = url.searchParams.get('code');
  const directToken = url.searchParams.get('access_token');

  if (directToken) {
    // Implicit flow — tokens returned directly in redirect URL
    const data: any = { [STORAGE_KEYS.accessToken]: directToken };
    const refreshToken = url.searchParams.get('refresh_token');
    if (refreshToken) data[STORAGE_KEYS.refreshToken] = refreshToken;
    await browser.storage.local.set(data);
  } else if (code) {
    // Authorization code flow — exchange code for tokens via PKCE
    const tokenResponse = await fetch(`${IAM_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    const tokens = await tokenResponse.json();

    const data: any = { [STORAGE_KEYS.accessToken]: tokens.access_token };
    if (tokens.refresh_token) data[STORAGE_KEYS.refreshToken] = tokens.refresh_token;
    if (tokens.id_token) data[STORAGE_KEYS.idToken] = tokens.id_token;
    if (tokens.expires_in) data[STORAGE_KEYS.expiresAt] = Date.now() + tokens.expires_in * 1000;
    await browser.storage.local.set(data);
  } else {
    const error = url.searchParams.get('error_description') || url.searchParams.get('error') || 'No authorization code or token';
    throw new Error(error);
  }

  // Fetch user info
  const stored = await browser.storage.local.get([STORAGE_KEYS.accessToken]);
  const accessToken = stored[STORAGE_KEYS.accessToken];
  if (!accessToken) throw new Error('Login succeeded but no token was stored');

  // /api/userinfo only returns sub/iss/aud; /api/get-account has full profile
  let user: any = {};
  try {
    const acctResp = await fetch(`${IAM_API}/api/get-account`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (acctResp.ok) {
      const acctJson = await acctResp.json();
      const acct = acctJson.data || acctJson;
      if (acct.name || acct.email) {
        user = { sub: acct.id || acct.sub, name: acct.displayName || acct.name, email: acct.email, picture: acct.avatar || undefined };
      }
    }
  } catch { /* fall through */ }
  if (!user.name && !user.email) {
    const userResp = await fetch(`${IAM_API}/api/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (userResp.ok) user = await userResp.json();
  }
  await browser.storage.local.set({ [STORAGE_KEYS.user]: user });
  return user;
}

browser.runtime.onMessage.addListener((request: any, sender: any, sendResponse: Function) => {
  (async () => {
    switch (request.action) {
      case 'auth.login':
        try {
          const user = await firefoxLogin();
          sendResponse({ success: true, user });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;

      case 'auth.signup':
        try {
          await browser.tabs.create({ url: `${IAM_LOGIN}/signup` });
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;

      case 'auth.logout':
        await browser.storage.local.remove(Object.values(STORAGE_KEYS));
        sendResponse({ success: true });
        break;

      case 'auth.status': {
        const result = await browser.storage.local.get([STORAGE_KEYS.accessToken, STORAGE_KEYS.user]);
        sendResponse({
          success: true,
          authenticated: !!result[STORAGE_KEYS.accessToken],
          user: result[STORAGE_KEYS.user] || null,
        });
        break;
      }

      case 'auth.getToken': {
        const r = await browser.storage.local.get([STORAGE_KEYS.accessToken]);
        sendResponse({ success: !!r[STORAGE_KEYS.accessToken], token: r[STORAGE_KEYS.accessToken] || null });
        break;
      }

      case 'chat.listModels': {
        const t = await browser.storage.local.get([STORAGE_KEYS.accessToken]);
        if (!t[STORAGE_KEYS.accessToken]) { sendResponse({ success: false, error: 'Not authenticated' }); break; }
        const resp = await fetch(`${API_BASE}/v1/models`, { headers: { Authorization: `Bearer ${t[STORAGE_KEYS.accessToken]}` } });
        const data = await resp.json();
        sendResponse({ success: true, models: data.data || data.models || data || [] });
        break;
      }

      case 'checkWebGPU': {
        try {
          if (!navigator.gpu) {
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

      case 'listAgents':
        sendResponse({ success: true, agents: [] });
        break;

      case 'stopAgent':
        sendResponse({ success: false, error: 'Agent workers are not available in Firefox background mode yet' });
        break;

      case 'launchAIWorker':
        sendResponse({ success: false, error: 'launchAIWorker is not implemented in Firefox background mode yet' });
        break;

      case 'rag.query': {
        try {
          const config = await getRagConfig();
          const topKInput = Number.parseInt(String(request.topK ?? config.topK), 10);
          const params = {
            endpoint: String(request.endpoint ?? config.endpoint ?? '').trim(),
            apiKey: String(request.apiKey ?? config.apiKey ?? '').trim(),
            query: String(request.query || '').trim(),
            topK: Number.isFinite(topKInput) ? Math.max(1, Math.min(topKInput, 20)) : 5,
            knowledgeBase: String(request.knowledgeBase ?? config.knowledgeBase ?? '').trim(),
            includeTabContext: request.includeTabContext !== undefined
              ? !!request.includeTabContext
              : config.includeTabContext,
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

          if (!params.endpoint) {
            sendResponse({ success: true, source: 'none', snippets: [] });
            break;
          }

          const snippets = await queryRagEndpoint(params);
          sendResponse({ success: true, source: snippets.length ? 'rag-endpoint' : 'none', snippets });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      // --- AI Control Overlay (forwarded to content script) ---
      // --- Bridge & ZAP status (for sidebar MCP detection) ---
      case 'bridge.status': {
        const bridgeConnected = hanzoExtension.isBridgeConnected();
        sendResponse({
          success: true,
          connected: bridgeConnected,
          browsers: bridgeConnected ? ['firefox'] : [],
        });
        break;
      }

      case 'zap.status': {
        // Firefox doesn't have ZAP discovery yet — return empty
        sendResponse({
          success: true,
          zap: { connected: false, mcps: [] },
        });
        break;
      }

      case 'zap.discover': {
        sendResponse({ success: true, mcps: [] });
        break;
      }

      case 'zap.listTools': {
        sendResponse({ success: true, tools: [] });
        break;
      }

      case 'usage.metrics': {
        sendResponse({ success: true, metrics: { chatRequests: 0, inputTokens: 0, outputTokens: 0, dedupeHits: 0, canceledRequests: 0 } });
        break;
      }

      case 'inspector.pickResult': {
        // Forward to sidebar — broadcast to all extension pages
        sendResponse({ success: true });
        break;
      }

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
        // User clicked Stop — end local control session
        await hanzoExtension.stopControlSession();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: `Unknown action: ${request.action}` });
        break;
    }
  })();
  return true; // Keep channel open
});

// Initialize extension (no export - Firefox doesn't support ES modules in background)
const hanzoExtension = new HanzoFirefoxExtension();

// End active session when the controlled tab closes.
browser.tabs.onRemoved.addListener((tabId) => {
  if (controlSession.active && controlSession.tabId === tabId) {
    void hanzoExtension.stopControlSession();
  }
});

console.log('[Hanzo] Firefox background script loaded');
