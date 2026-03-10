// CDP Bridge for hanzo-mcp Browser Tool Integration
// Enables Playwright to control browser via Chrome DevTools Protocol
import { ActionRateLimiter, debugLog, loadDebugFlagFromStorage } from './runtime-guard';

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
  
  constructor() {
    void loadDebugFlagFromStorage();
    this.setupDebuggerListener();
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

    // Fallback: use chrome.tabs.captureVisibleTab (no debugger needed)
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: options?.format === 'jpeg' ? 'jpeg' : 'png',
      quality: options?.quality,
    });
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
    const result = await this.send(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true
    });
    return result.result?.value;
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
  
  // WebSocket server for external connections (hanzo-mcp)
  startWebSocketServer(port: number = 9223): void {
    // Note: Chrome extensions can't create native WebSocket servers
    // Instead, we connect to an external bridge server
    this.connectToBridge(`ws://localhost:${port}/cdp`);
  }
  
  private connectToBridge(url: string): void {
    try {
      this.wsServer = new WebSocket(url);
      
      this.wsServer.onopen = () => {
        debugLog('[CDP] Connected to bridge server');
        // Register as CDP provider with browser identification
        const browser = typeof navigator !== 'undefined'
          ? (navigator.userAgent.includes('Firefox') ? 'firefox'
            : navigator.userAgent.includes('Edg/') ? 'edge'
            : navigator.userAgent.includes('Chrome') ? 'chrome'
            : navigator.userAgent.includes('Safari') ? 'safari'
            : 'unknown')
          : 'unknown';
        this.wsServer?.send(JSON.stringify({
          type: 'register',
          role: 'cdp-provider',
          browser,
          capabilities: ['navigate', 'screenshot', 'click', 'type', 'evaluate', 'takeover']
        }));
      };
      
      this.wsServer.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle extension-request from bridge server (monitor/audit calls)
          if (message.type === 'extension-request' && message.action) {
            chrome.runtime.sendMessage(
              { action: message.action, ...(message.params || {}) },
              (result) => {
                this.wsServer?.send(JSON.stringify({
                  type: 'extension-response',
                  id: message.id,
                  result: result || { error: chrome.runtime.lastError?.message },
                }));
              }
            );
            return;
          }

          const response = await this.handleBridgeMessage(message);
          this.wsServer?.send(JSON.stringify(response));
        } catch (error: any) {
          this.wsServer?.send(JSON.stringify({
            id: 0,
            error: { code: -32603, message: error.message }
          }));
        }
      };
      
      this.wsServer.onerror = (error) => {
        console.error('[CDP] Bridge connection error:', error);
      };
      
      this.wsServer.onclose = () => {
        debugLog('[CDP] Bridge disconnected, reconnecting in 5s...');
        setTimeout(() => this.connectToBridge(url), 5000);
      };
    } catch (error) {
      console.error('[CDP] Failed to connect to bridge:', error);
      setTimeout(() => this.connectToBridge(url), 5000);
    }
  }
  
  private async handleBridgeMessage(message: any): Promise<CDPResponse> {
    const { id, method, params } = message;
    
    try {
      let result: any;
      
      // Get active tab if not specified
      const tabId = params?.tabId || await this.getActiveTabId();
      
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
          // Must enable Runtime domain and set returnByValue for actual values
          await this.send(tabId, 'Runtime.enable');
          result = await this.send(tabId, method, {
            ...params,
            returnByValue: true,
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
        case 'hanzo.click':
          this.notifyControlOverlay(tabId, 'ai.control.highlight', { selector: params.selector });
          this.notifyControlOverlay(tabId, 'ai.control.status', { text: `Clicking ${params.selector}` });
          const clicked = await this.clickSelector(tabId, params.selector);
          result = { success: clicked };
          break;

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
          result = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action, tabId, ...params }, (response) => {
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
