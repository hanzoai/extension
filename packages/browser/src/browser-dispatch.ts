// CDP Bridge for hanzo-mcp Browser Tool Integration
// Enables Playwright to control browser via Chrome DevTools Protocol
import { ActionRateLimiter, debugLog, loadDebugFlagFromStorage } from './runtime-guard';
import { parseTabId, unwrapEvaluateResult } from './shared/tab-id.js';
import { pickEvaluable, wrapEvaluable } from './shared/evaluable.js';
import { detail, shrink } from './shared/shrink.js';
import { DRIVE, drive } from './shared/drive.js';

/**
 * Coerce the named params from string → number in place.
 *
 * The ZAP transport decodes every command param as a UTF-8 string (see
 * shared/socket.ts `decodeCmd`), but CDP methods like
 * `Input.dispatchMouseEvent` type their coordinates as doubles and reject a
 * string ("double value expected"). Callers that hand params to CDP run them
 * through this first. Absent / already-numeric / non-numeric values are left
 * untouched.
 */
function coerceNumericParams(params: any, keys: string[]): void {
  if (!params) return;
  for (const k of keys) {
    const v = params[k];
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      params[k] = Number(v);
    }
  }
}

interface CDPSession {
  tabId: number;
  debuggee: chrome.debugger.Debuggee;
  connected: boolean;
}

interface CDPCommand {
  id: number;
  method: string;
  params?: any;
  tabId?: number;
}

interface CDPResponse {
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export class CDPBridge {
  private sessions: Map<number, CDPSession> = new Map();
  private messageHandlers: Map<number, (response: CDPResponse) => void> = new Map();
  private commandId: number = 0;
  private wsServer: WebSocket | null = null;
  private wsClients: Set<WebSocket> = new Set();
  private overlayLimiter = new ActionRateLimiter();
  private overlaySignatures = new Map<string, string>();
  // BrowserControl lives in the SAME service worker. chrome.runtime.sendMessage
  // never delivers to an onMessage listener in the sender's own worker, so DOM
  // verbs (getText, type, hover, …) are dispatched to it directly through this
  // hook — wired by background.ts. Null on Firefox/Safari (their own path).
  private domDispatch: ((request: any) => Promise<any>) | null = null;

  constructor() {
    void loadDebugFlagFromStorage();
    this.setupDebuggerListener();
  }

  /**
   * Wire the in-worker BrowserControl so DOM verbs dispatch directly instead of
   * via chrome.runtime.sendMessage (which cannot reach an onMessage listener in
   * the same service worker). Called once by background.ts at startup.
   */
  setDomDispatch(fn: (request: any) => Promise<any>): void {
    this.domDispatch = fn;
  }
  
  private setupDebuggerListener() {
    // Listen for CDP events from attached debuggers
    if (typeof chrome !== 'undefined' && chrome.debugger) {
      chrome.debugger.onEvent.addListener((source, method, params) => {
        this.broadcastEvent(source.tabId!, method, params);
      });
      
      chrome.debugger.onDetach.addListener((source, reason) => {
        debugLog(`[CDP] Detached from tab ${source.tabId}: ${reason}`);
        if (source.tabId) {
          this.sessions.delete(source.tabId);
        }
      });
    }
  }
  
  // Attach debugger to a tab
  async attach(tabId: number): Promise<boolean> {
    if (this.sessions.has(tabId)) {
      return true; // Already attached
    }
    
    return new Promise((resolve) => {
      const debuggee: chrome.debugger.Debuggee = { tabId };
      
      chrome.debugger.attach(debuggee, '1.3', () => {
        if (chrome.runtime.lastError) {
          console.error(`[CDP] Failed to attach: ${chrome.runtime.lastError.message}`);
          resolve(false);
        } else {
          this.sessions.set(tabId, {
            tabId,
            debuggee,
            connected: true
          });
          debugLog(`[CDP] Attached to tab ${tabId}`);
          resolve(true);
        }
      });
    });
  }
  
  // Detach from a tab
  async detach(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) return;
    
    return new Promise((resolve) => {
      chrome.debugger.detach(session.debuggee, () => {
        this.sessions.delete(tabId);
        resolve();
      });
    });
  }
  
  // Send CDP command
  async send(tabId: number, method: string, params?: any): Promise<any> {
    const session = this.sessions.get(tabId);
    if (!session) {
      // Auto-attach if not attached
      const attached = await this.attach(tabId);
      if (!attached) {
        throw new Error(`Cannot attach to tab ${tabId}`);
      }
    }
    
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(
        { tabId },
        method,
        params || {},
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        }
      );
    });
  }
  
  // High-level browser control methods for hanzo-mcp integration
  
  async navigate(tabId: number, url: string): Promise<void> {
    await this.send(tabId, 'Page.navigate', { url });
  }
  
  async screenshot(tabId: number, options?: {
    format?: 'jpeg' | 'png' | 'webp';
    quality?: number;
    maxWidth?: number;
    clip?: { x: number; y: number; width: number; height: number };
    fullPage?: boolean;
  }): Promise<string> {
    const { format, quality, max } = detail(options ?? {});
    const raw = await this.grab(tabId, { ...options, format, quality });
    return shrink(raw, max, quality, `image/${format}`);
  }

  private async grab(tabId: number, options: {
    format?: 'jpeg' | 'png' | 'webp';
    quality?: number;
    clip?: { x: number; y: number; width: number; height: number };
    fullPage?: boolean;
  }): Promise<string> {
    try {
      // Enable Page domain first
      await this.send(tabId, 'Page.enable');

      const params: any = {
        format: options?.format || 'png',
      };

      if (options?.quality) {
        params.quality = options.quality;
      }

      if (options?.fullPage) {
        // Get full page metrics
        const metrics = await this.send(tabId, 'Page.getLayoutMetrics');
        params.clip = {
          x: 0,
          y: 0,
          width: metrics.contentSize.width,
          height: metrics.contentSize.height,
          scale: 1
        };
        params.captureBeyondViewport = true;
      } else if (options?.clip) {
        params.clip = { ...options.clip, scale: 1 };
      }

      const result = await this.send(tabId, 'Page.captureScreenshot', params);
      if (result?.data) {
        return result.data; // Base64 encoded
      }
    } catch (e) {
      debugLog(`[CDP] Page.captureScreenshot failed, using captureVisibleTab fallback: ${e}`);
    }

    // Fallback: chrome.tabs.captureVisibleTab. This API only works on a
    // *foreground* tab in the target window — Firefox enforces this strictly,
    // Chrome will sometimes succeed with a backgrounded tab but is
    // inconsistent on Mac. Brief-activate the target tab if needed and
    // restore focus afterwards. Always pass an explicit windowId resolved
    // from the tab so multi-window automation captures the right window.
    const tab = await chrome.tabs.get(tabId);
    let activatedFor: number | null = null;
    let prevActiveId: number | undefined;
    if (!tab.active) {
      const prev = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
        chrome.tabs.query({ active: true, windowId: tab.windowId }, (tabs) => resolve(tabs[0]));
      });
      prevActiveId = prev?.id;
      await chrome.tabs.update(tabId, { active: true });
      activatedFor = tabId;
      // One animation tick so the tab actually composes.
      await new Promise((r) => setTimeout(r, 50));
    }
    let dataUrl: string;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: options?.format === 'jpeg' ? 'jpeg' : 'png',
        quality: options?.quality,
      });
    } finally {
      if (activatedFor !== null && prevActiveId) {
        chrome.tabs.update(prevActiveId, { active: true }).catch(() => {});
      }
    }
    // Strip data:image/png;base64, prefix
    return dataUrl.replace(/^data:image\/\w+;base64,/, '');
  }
  
  async click(tabId: number, x: number, y: number): Promise<void> {
    await this.send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    
    await this.send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
  }
  
  async type(tabId: number, text: string): Promise<void> {
    for (const char of text) {
      await this.send(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char
      });
      await this.send(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        text: char
      });
    }
  }
  
  async evaluate(tabId: number, expression: string): Promise<any> {
    await this.send(tabId, 'Runtime.enable');
    // awaitPromise: true makes CDP wait for any async IIFE the caller passed
    // to resolve before returning. Without this, expressions like
    //   (async () => fetch('/x').then(r => r.json()))()
    // serialize to {} (a Promise placeholder) and the caller can't tell
    // success from failure. unwrapEvaluateResult further normalises every
    // shape (Chrome / CDP / hanzo-tools) to the bare value.
    const result = await this.send(tabId, 'Runtime.evaluate', {
      expression: wrapEvaluable(expression),
      returnByValue: true,
      awaitPromise: true,
    });
    return unwrapEvaluateResult(result);
  }
  
  async getDocument(tabId: number): Promise<any> {
    await this.send(tabId, 'DOM.enable');
    return this.send(tabId, 'DOM.getDocument');
  }
  
  async querySelector(tabId: number, selector: string): Promise<number | null> {
    const doc = await this.getDocument(tabId);
    try {
      const result = await this.send(tabId, 'DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector
      });
      return result.nodeId || null;
    } catch {
      return null;
    }
  }
  
  async getBoxModel(tabId: number, nodeId: number): Promise<any> {
    return this.send(tabId, 'DOM.getBoxModel', { nodeId });
  }
  
  async clickSelector(tabId: number, selector: string): Promise<boolean> {
    const nodeId = await this.querySelector(tabId, selector);
    if (!nodeId) {
      return false;
    }
    
    const box = await this.getBoxModel(tabId, nodeId);
    if (!box?.model?.content) {
      return false;
    }
    
    // Get center of element
    const quad = box.model.content;
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    
    await this.click(tabId, x, y);
    return true;
  }
  
  async fillSelector(tabId: number, selector: string, value: string): Promise<boolean> {
    // Focus the element
    const nodeId = await this.querySelector(tabId, selector);
    if (!nodeId) {
      return false;
    }
    
    await this.send(tabId, 'DOM.focus', { nodeId });
    
    // Clear existing content
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      modifiers: 2 // Ctrl/Cmd
    });
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      modifiers: 2
    });
    
    // Type new value
    await this.type(tabId, value);
    return true;
  }
  
  // The extension reaches the ZAP router over shared/socket.ts; dispatchMethod()
  // below is the inbound browser-command dispatcher.

  /**
   * Public entry point for ZAP-server-initiated requests.
   *
   * Wraps {@link handleBridgeMessage} so background scripts can hand off
   * ``method`` + ``params`` from a ZAP MSG_REQUEST without synthesising a
   * fake numeric ``id``. Throws on bridge error so the caller can convert
   * to a MSG_RESPONSE error frame.
   */
  async dispatchMethod(method: string, params: any): Promise<any> {
    const response = await this.handleBridgeMessage({ id: 0, method, params: params || {} });
    if (response.error) {
      const err: any = new Error(response.error.message);
      err.code = response.error.code;
      throw err;
    }
    return response.result;
  }

  private async handleBridgeMessage(message: any): Promise<CDPResponse> {
    const { id, method, params } = message;

    try {
      let result: any;

      // Resolve target tab. Accept numeric tabId, "tab-NNN" targetId from
      // getTargets, plain numeric string. Without explicit targeting fall
      // back to the active tab in the focused window — which is fragile when
      // the user has many windows open. Always prefer explicit ids.
      const tabId = parseTabId(params?.tabId ?? params?.targetId)
                    ?? await this.getActiveTabId();

      // The snapshot → ref engine: portable, no debugger attach (shared/drive.ts).
      if (DRIVE.has(method)) return { id, result: await drive(chrome, tabId, method, params || {}) };

      switch (method) {
        case 'Browser.getVersion':
          result = {
            protocolVersion: '1.3',
            product: 'Hanzo Browser Extension',
            userAgent: navigator.userAgent
          };
          break;

        case 'Target.getTargets':
          result = await this.getTargets();
          break;

        case 'Page.navigate':
          // Background workers do not have a DOM/window; use a safe default cursor hint.
          this.notifyControlOverlay(tabId, 'ai.control.cursor', { x: 24, y: 24 });
          this.notifyControlOverlay(tabId, 'ai.control.status', { text: `Navigating to ${params.url}` });
          await this.navigate(tabId, params.url);
          result = { frameId: 'main' };
          break;

        case 'Page.captureScreenshot':
          const screenshot = await this.screenshot(tabId, params);
          result = { data: screenshot };
          break;

        case 'Input.dispatchMouseEvent':
          coerceNumericParams(params, ['x', 'y', 'clickCount', 'buttons', 'deltaX', 'deltaY']);
          if (params?.x !== undefined && params?.y !== undefined) {
            this.notifyControlOverlay(tabId, 'ai.control.cursor', { x: params.x, y: params.y });
          }
          await this.send(tabId, method, params);
          result = {};
          break;

        case 'Input.dispatchKeyEvent':
          await this.send(tabId, method, params);
          result = {};
          break;

        case 'Runtime.evaluate':
        case 'evaluate':
          // Must enable Runtime domain and set returnByValue for actual
          // values. `awaitPromise: true` makes CDP wait for async IIFEs
          // to resolve so callers passing `(async () => {...})()` get
          // the resolved value instead of an empty {} (the previous bug
          // — caller saw a serialized Promise placeholder).
          // pickEvaluable + wrapEvaluable: accept every code-param alias
          // and let statement bodies (`const b=…; b.click()`) evaluate
          // instead of tripping SpiderMonkey/V8 expression parsing — the
          // same rule background-firefox.ts applies, so both browsers
          // accept identical caller JS.
          //
          // The caller's bag is NOT spread in. CDP validates Runtime.evaluate
          // strictly, and `timeout` is a field it owns (a double). A client
          // sending its own transport-level `timeout` — null by default in the
          // MCP tool schema — reached CDP as `params.timeout: null` and every
          // evaluate died on "Failed to deserialize params.timeout - double
          // value expected", while the same call succeeded on Firefox, which
          // consumes timeout as its own wait budget and forwards nothing. The
          // three fields below are the whole contract, identical to the
          // evaluate() method above: one rule, both Chrome call sites.
          await this.send(tabId, 'Runtime.enable');
          result = await this.send(tabId, 'Runtime.evaluate', {
            expression: wrapEvaluable(pickEvaluable(params)),
            returnByValue: true,
            awaitPromise: true,
          });
          break;

        case 'DOM.getDocument':
          result = await this.getDocument(tabId);
          break;

        case 'DOM.querySelector':
          const nodeId = await this.querySelector(tabId, params.selector);
          result = { nodeId };
          break;

        // High-level commands for hanzo-mcp
        case 'hanzo.click': {
          // Coordinate click: the MCP sends {x, y} (strings) and no selector.
          // Dispatch a real CDP mouse event at the point. Selector click keeps
          // the DOM/box-model path below.
          if (!params?.selector && params?.x != null && params?.y != null) {
            coerceNumericParams(params, ['x', 'y']);
            this.notifyControlOverlay(tabId, 'ai.control.cursor', { x: params.x, y: params.y });
            await this.click(tabId, params.x, params.y);
            result = { success: true };
            break;
          }
          this.notifyControlOverlay(tabId, 'ai.control.highlight', { selector: params.selector });
          this.notifyControlOverlay(tabId, 'ai.control.status', { text: `Clicking ${params.selector}` });
          const clicked = await this.clickSelector(tabId, params.selector);
          result = { success: clicked };
          break;
        }

        case 'hanzo.fill':
          this.notifyControlOverlay(tabId, 'ai.control.highlight', { selector: params.selector });
          this.notifyControlOverlay(tabId, 'ai.control.status', { text: `Filling ${params.selector}` });
          const filled = await this.fillSelector(tabId, params.selector, params.value);
          result = { success: filled };
          break;

        case 'hanzo.screenshot':
          const screenshotData = await this.screenshot(tabId, params);
          result = { data: screenshotData };
          break;

        // Navigation
        case 'Page.goBack':
          await chrome.tabs.goBack(tabId);
          result = { success: true };
          break;

        case 'Page.goForward':
          await chrome.tabs.goForward(tabId);
          result = { success: true };
          break;

        case 'Page.reload':
          await chrome.tabs.reload(tabId);
          result = { success: true };
          break;

        case 'hanzo.url':
          result = { result: { value: (await chrome.tabs.get(tabId))?.url || '' } };
          break;

        case 'hanzo.title':
          result = { result: { value: (await chrome.tabs.get(tabId))?.title || '' } };
          break;

        case 'hanzo.tabInfo': {
          const tab = await chrome.tabs.get(tabId);
          result = { id: tab?.id, url: tab?.url, title: tab?.title, status: tab?.status, active: tab?.active, index: tab?.index };
          break;
        }

        case 'hanzo.waitForNavigation':
          result = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve({ success: false });
            }, params?.timeout || 30000);
            const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
              if (updatedId === tabId && info.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve({ success: true });
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
          break;

        // High-level hanzo.* commands — forward to BrowserControl via executeScript
        // Forward hanzo.* commands to BrowserControl via chrome.runtime
        // (hanzo.click, hanzo.fill, hanzo.screenshot handled above with overlay)
        case 'hanzo.dblclick':
        case 'hanzo.hover':
        case 'hanzo.type':
        case 'hanzo.clear':
        case 'hanzo.select':
        case 'hanzo.check':
        case 'hanzo.uncheck':
        case 'hanzo.waitForSelector':
        case 'hanzo.querySelectorAll':
        case 'hanzo.getElementInfo':
        case 'hanzo.getPageInfo':
        case 'hanzo.getHTML':
        case 'hanzo.setHTML':
        case 'hanzo.getText':
        case 'hanzo.setText':
        case 'hanzo.getAttribute':
        case 'hanzo.setAttribute':
        case 'hanzo.removeAttribute':
        case 'hanzo.setStyle':
        case 'hanzo.addClass':
        case 'hanzo.removeClass':
        case 'hanzo.insertElement':
        case 'hanzo.removeElement':
        case 'hanzo.observeMutations':
        case 'hanzo.getComputedStyles':
        case 'hanzo.getBoundingRects':
        case 'hanzo.injectScript':
        case 'hanzo.injectCSS':
        case 'hanzo.getLocalStorage':
        case 'hanzo.setLocalStorage':
        case 'hanzo.getCookies':
        case 'hanzo.getHistory':
        case 'hanzo.fetch': {
          // Map hanzo.X → browser.X and forward via chrome.runtime message
          const cmd = method.replace('hanzo.', '');
          // Normalize naming: hanzo.select → browser.select, hanzo.dblclick → browser.dblclick, etc.
          const actionMap: Record<string, string> = {
            'url': 'getURL', 'title': 'getTitle', 'tabInfo': 'getTabInfo',
          };
          const action = 'browser.' + (actionMap[cmd] || cmd);
          // tabId LAST so the resolved numeric id wins over any string tabId in
          // params (the ZAP transport decodes every value as a string). BrowserControl
          // runs the verb via chrome.scripting.executeScript (MAIN world) — no
          // content script, no message bus. domDispatch calls it directly
          // because chrome.runtime.sendMessage cannot reach a listener in this
          // same service worker; the sendMessage branch is the Firefox/legacy
          // fallback only.
          const request = { ...params, action, tabId };
          result = this.domDispatch
            ? await this.domDispatch(request)
            : await new Promise((resolve) => {
                chrome.runtime.sendMessage(request, (response) => {
                  resolve(response || { error: chrome.runtime.lastError?.message });
                });
              });
          break;
        }

        // Control overlay management
        case 'hanzo.control.start':
        case 'hanzo.takeover.start':
          this.notifyControlOverlay(tabId, 'ai.control.start', { task: params.task || 'Hanzo AI is controlling this tab' });
          result = { success: true };
          break;

        case 'hanzo.control.stop':
        case 'hanzo.takeover.end':
          this.notifyControlOverlay(tabId, 'ai.control.stop', {});
          result = { success: true };
          break;

        case 'hanzo.takeover.cursor':
          if (params?.x !== undefined && params?.y !== undefined) {
            this.notifyControlOverlay(tabId, 'ai.control.cursor', { x: params.x, y: params.y });
          }
          result = { success: true };
          break;

        default:
          // Pass through to Chrome debugger
          result = await this.send(tabId, method, params);
      }
      
      return { id, result };
    } catch (error: any) {
      return {
        id,
        error: { code: -32603, message: error.message }
      };
    }
  }
  
  private async getActiveTabId(): Promise<number> {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          resolve(tabs[0].id);
        } else {
          reject(new Error('No active tab'));
        }
      });
    });
  }
  
  private async getTargets(): Promise<{ targetInfos: any[] }> {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const targetInfos = tabs.map(tab => ({
          targetId: `tab-${tab.id}`,
          type: 'page',
          title: tab.title,
          url: tab.url,
          attached: this.sessions.has(tab.id!),
          browserContextId: 'default'
        }));
        resolve({ targetInfos });
      });
    });
  }
  
  private notifyControlOverlay(tabId: number, action: string, data: any): void {
    const key = `${tabId}:${action}`;
    const signature = JSON.stringify(data || {});
    const throttleMs = action === 'ai.control.cursor'
      ? 40
      : action === 'ai.control.status'
        ? 200
        : action === 'ai.control.highlight'
          ? 90
          : 0;

    if (throttleMs > 0 && !this.overlayLimiter.allow(key, throttleMs)) {
      return;
    }

    if (this.overlaySignatures.get(key) === signature && action !== 'ai.control.start' && action !== 'ai.control.stop') {
      return;
    }
    this.overlaySignatures.set(key, signature);

    try {
      chrome.tabs.sendMessage(tabId, { action, ...data }, () => {
        // Ignore errors (tab may not have content script)
        if (chrome.runtime.lastError) { /* noop */ }
      });
    } catch { /* noop */ }
  }

  /** Check whether the bridge WebSocket is connected. */
  isBridgeConnected(): boolean {
    return this.wsServer !== null && this.wsServer.readyState === WebSocket.OPEN;
  }

  /** Send a config key/value to the bridge server for persistence. */
  sendConfig(key: string, value: unknown): void {
    if (!this.isBridgeConnected()) return;
    this.wsServer!.send(JSON.stringify({
      type: 'config',
      key,
      value,
    }));
  }

  private broadcastEvent(tabId: number, method: string, params: any): void {
    const event = JSON.stringify({
      type: 'event',
      tabId,
      method,
      params
    });

    if (this.wsServer?.readyState === WebSocket.OPEN) {
      this.wsServer.send(event);
    }
  }
}

// Singleton instance
let cdpBridgeInstance: CDPBridge | null = null;

export function getCDPBridge(): CDPBridge {
  if (!cdpBridgeInstance) {
    cdpBridgeInstance = new CDPBridge();
  }
  return cdpBridgeInstance;
}
