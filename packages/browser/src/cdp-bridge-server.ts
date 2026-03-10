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

interface CDPClient {
  ws: WebSocket;
  capabilities: string[];
  browser: string;
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

  private handleMessage(ws: WebSocket, message: any) {
    if (message.type === 'register') {
      this.clients.set(ws, {
        ws,
        capabilities: message.capabilities || [],
        browser: message.browser || 'unknown',
      });
      console.log(`[hanzo.browser] Registered ${message.browser || 'unknown'}:`, message.capabilities?.join(', '));
      return;
    }

    if (message.type === 'config') {
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
      .map((c) => (c as any).browser || 'unknown')
      .filter((b) => b !== 'unknown');
  }

  private async sendRaw(method: string, params?: any): Promise<any> {
    const client = Array.from(this.clients.values())[0];
    if (!client) {
      throw new Error('No browser extension connected');
    }

    const id = ++this.commandId;

    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject });
      client.ws.send(JSON.stringify({ id, method, params }));

      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error('Command timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Unified hanzo.browser interface - matches mcp__hanzo__browser pattern
   */
  async browser(params: BrowserCommand): Promise<any> {
    const { action, ...rest } = params;

    switch (action) {
      // Navigation
      case 'navigate':
        return this.sendRaw('Page.navigate', { url: rest.url });

      case 'navigate_back':
      case 'go_back':
        return this.sendRaw('Page.goBack');

      case 'navigate_forward':
      case 'go_forward':
        return this.sendRaw('Page.goForward');

      case 'reload':
        return this.sendRaw('Page.reload');

      case 'url':
        return this.sendRaw('hanzo.url');

      case 'title':
        return this.sendRaw('hanzo.title');

      case 'tab_info':
        return this.sendRaw('hanzo.tabInfo');

      case 'content':
        return this.sendRaw('Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true
        });

      // Screenshots
      case 'screenshot': {
        const screenshot = await this.sendRaw('hanzo.screenshot', {
          format: rest.format || 'png',
          fullPage: rest.fullPage,
          ...(rest.tabId ? { tabId: rest.tabId } : {}),
          ...(rest.tabIndex !== undefined ? { tabIndex: rest.tabIndex } : {}),
        });
        if (rest.filename && screenshot?.data) {
          const buffer = Buffer.from(screenshot.data, 'base64');
          fs.writeFileSync(rest.filename, buffer);
          return { saved: rest.filename, bytes: buffer.length, data: screenshot.data };
        }
        return screenshot;
      }

      case 'snapshot':
        // Accessibility snapshot
        return this.sendRaw('Accessibility.getFullAXTree');

      // Input - Click
      case 'click':
        return this.sendRaw('hanzo.click', {
          selector: rest.selector || rest.ref
        });

      case 'dblclick':
      case 'double_click':
        return this.sendRaw('hanzo.dblclick', {
          selector: rest.selector || rest.ref
        });

      case 'hover':
        return this.sendRaw('hanzo.hover', {
          selector: rest.selector || rest.ref
        });

      // Input - Type
      case 'type':
        return this.sendRaw('hanzo.type', {
          selector: rest.selector || rest.ref,
          text: rest.text
        });

      case 'fill':
        return this.sendRaw('hanzo.fill', {
          selector: rest.selector || rest.ref,
          value: rest.value || rest.text
        });

      case 'clear':
        return this.sendRaw('hanzo.clear', {
          selector: rest.selector || rest.ref
        });

      case 'press_key':
      case 'press':
        return this.sendRaw('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: rest.key
        });

      // Forms
      case 'select_option':
        return this.sendRaw('hanzo.select', {
          selector: rest.selector || rest.ref,
          value: rest.value
        });

      case 'check':
        return this.sendRaw('hanzo.check', {
          selector: rest.selector || rest.ref
        });

      case 'uncheck':
        return this.sendRaw('hanzo.uncheck', {
          selector: rest.selector || rest.ref
        });

      // Navigation
      case 'go_back':
      case 'navigate_back':
        return this.sendRaw('Page.goBack');

      case 'go_forward':
      case 'navigate_forward':
        return this.sendRaw('Page.goForward');

      case 'get_url':
        return this.sendRaw('hanzo.url');

      case 'get_title':
        return this.sendRaw('hanzo.title');

      case 'get_tab_info':
      case 'tab_info':
        return this.sendRaw('hanzo.tabInfo');

      case 'get_history':
      case 'history':
        return this.sendRaw('hanzo.getHistory', { maxResults: rest.maxResults });

      case 'wait_for_navigation':
        return this.sendRaw('hanzo.waitForNavigation', { timeout: rest.timeout });

      case 'create_tab':
        return this.sendRaw('Target.createTarget', { url: rest.url || 'about:blank' });

      case 'close_tab':
        return this.sendRaw('Target.closeTarget', { targetId: rest.tabId });

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
        });
        return fetchResult;
      }

      // Selectors / Waiting
      case 'wait_for_selector':
        return this.sendRaw('hanzo.waitForSelector', { selector: rest.selector, timeout: rest.timeout });

      case 'query_selector_all':
        return this.sendRaw('hanzo.querySelectorAll', { selector: rest.selector });

      case 'get_element_info':
        return this.sendRaw('hanzo.getElementInfo', { selector: rest.selector });

      case 'get_page_info':
        return this.sendRaw('hanzo.getPageInfo', {});

      // DOM Read/Write/Observe
      case 'get_html':
        return this.sendRaw('hanzo.getHTML', { selector: rest.selector, outer: rest.outer });

      case 'set_html':
        return this.sendRaw('hanzo.setHTML', { selector: rest.selector, html: rest.html, outer: rest.outer });

      case 'get_text':
        return this.sendRaw('hanzo.getText', { selector: rest.selector });

      case 'set_text':
        return this.sendRaw('hanzo.setText', { selector: rest.selector, text: rest.text });

      case 'get_attribute':
        return this.sendRaw('hanzo.getAttribute', { selector: rest.selector, attr: rest.attr });

      case 'set_attribute':
        return this.sendRaw('hanzo.setAttribute', { selector: rest.selector, attr: rest.attr, value: rest.value });

      case 'remove_attribute':
        return this.sendRaw('hanzo.removeAttribute', { selector: rest.selector, attr: rest.attr });

      case 'set_style':
        return this.sendRaw('hanzo.setStyle', { selector: rest.selector, styles: rest.styles });

      case 'add_class':
        return this.sendRaw('hanzo.addClass', { selector: rest.selector, classNames: rest.classNames });

      case 'remove_class':
        return this.sendRaw('hanzo.removeClass', { selector: rest.selector, classNames: rest.classNames });

      case 'insert_element':
        return this.sendRaw('hanzo.insertElement', { selector: rest.selector, html: rest.html, position: rest.position });

      case 'remove_element':
        return this.sendRaw('hanzo.removeElement', { selector: rest.selector });

      case 'observe_mutations':
        return this.sendRaw('hanzo.observeMutations', { selector: rest.selector, options: rest.options, duration: rest.duration });

      case 'computed_styles':
        return this.sendRaw('hanzo.getComputedStyles', { selector: rest.selector, properties: rest.properties });

      case 'bounding_rects':
        return this.sendRaw('hanzo.getBoundingRects', { selector: rest.selector });

      case 'inject_script':
        return this.sendRaw('hanzo.injectScript', { url: rest.url });

      case 'inject_css':
        return this.sendRaw('hanzo.injectCSS', { css: rest.css });

      case 'local_storage':
        if (rest.value !== undefined) {
          return this.sendRaw('hanzo.setLocalStorage', { key: rest.key, value: rest.value });
        }
        return this.sendRaw('hanzo.getLocalStorage', { key: rest.key });

      case 'cookies':
        return this.sendRaw('hanzo.getCookies', {});

      // Evaluate
      case 'evaluate': {
        const evalResult = await this.sendRaw('Runtime.evaluate', {
          expression: rest.code || rest.function || rest.expression,
          returnByValue: true,
          ...(rest.tabId ? { tabId: rest.tabId } : {}),
          ...(rest.tabIndex !== undefined ? { tabIndex: rest.tabIndex } : {}),
        });
        // Unwrap CDP result envelope: {result: {type, value}} → value
        const value = evalResult?.result?.value ?? evalResult?.result ?? evalResult;
        return { result: value };
      }

      // Wait
      case 'wait':
        await new Promise(resolve => setTimeout(resolve, (rest.timeout || 1) * 1000));
        return { waited: rest.timeout || 1 };

      case 'wait_for_load':
        return this.sendRaw('Page.waitForLoadState', {
          state: rest.state || 'load'
        });

      // Tabs
      case 'tabs':
      case 'list_tabs':
        return this.sendRaw('Target.getTargets');

      case 'new_tab':
        return this.sendRaw('Target.createTarget', { url: rest.url || 'about:blank' });

      case 'close_tab':
        return this.sendRaw('Target.closeTarget', { targetId: rest.tabId });

      case 'select_tab':
        return this.sendRaw('Target.activateTarget', { targetId: rest.tabId });

      // Console/Network — routed to PageMonitor via extension background
      case 'console_messages':
      case 'console':
      case 'console_logs':
        return this.sendToExtension('monitor.consoleLogs', { tabId: rest.tabId });

      case 'console_errors':
        return this.sendToExtension('monitor.consoleErrors', { tabId: rest.tabId });

      case 'network_requests':
      case 'network_logs':
        return this.sendToExtension('monitor.networkLogs', { tabId: rest.tabId });

      case 'network_errors':
        return this.sendToExtension('monitor.networkErrors', { tabId: rest.tabId });

      case 'network_success':
        return this.sendToExtension('monitor.networkSuccess', { tabId: rest.tabId });

      case 'wipe_logs':
        return this.sendToExtension('monitor.wipeLogs', { tabId: rest.tabId });

      case 'start_monitoring':
        return this.sendToExtension('monitor.start', { tabId: rest.tabId });

      case 'stop_monitoring':
        return this.sendToExtension('monitor.stop', { tabId: rest.tabId });

      case 'monitor_status':
        return this.sendToExtension('monitor.status', {});

      // Audits — routed to AuditRunner via extension background
      case 'accessibility_audit':
        return this.sendToExtension('audit.accessibility', { tabId: rest.tabId });

      case 'performance_audit':
        return this.sendToExtension('audit.performance', { tabId: rest.tabId });

      case 'seo_audit':
        return this.sendToExtension('audit.seo', { tabId: rest.tabId });

      case 'best_practices_audit':
        return this.sendToExtension('audit.bestPractices', { tabId: rest.tabId });

      case 'full_audit':
        return this.sendToExtension('audit.full', { tabId: rest.tabId });

      // Status
      case 'status':
        return {
          connected: this.clients.size > 0,
          clients: this.clients.size,
          port: this.httpPort
        };

      default:
        // Pass through as raw CDP command
        return this.sendRaw(action, rest);
    }
  }

  // Send a message to the extension background and wait for response
  private sendToExtension(action: string, params: any): Promise<any> {
    return new Promise((resolve) => {
      // Route through the first connected WebSocket client (the extension)
      const client = this.clients.values().next().value;
      if (!client) {
        resolve({ error: 'No browser extension connected' });
        return;
      }

      const id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timeout = setTimeout(() => {
        this.pendingExtensionRequests.delete(id);
        resolve({ error: 'Extension request timed out' });
      }, 30000);

      this.pendingExtensionRequests.set(id, { resolve, timeout });

      client.send(JSON.stringify({
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
        browsers: bridgeServer.getConnectedBrowsers(),
        actions: [
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
