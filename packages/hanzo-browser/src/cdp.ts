/**
 * Native Chrome DevTools Protocol (CDP) client & local Chromium launcher for `@hanzo/browser`.
 *
 * Speaks JSON-RPC directly over `RawWebSocket` (`./ws.js`) and launches local Chrome/Chromium
 * with `--enable-features=WebMCP` (unless opted out via `--no-webmcp` or
 * `AGENT_BROWSER_NO_WEBMCP=1`) — zero Playwright dependency.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { RawWebSocket } from './ws.js';
import { WEBMCP_PAGE_BOOTSTRAP, isWebMCPDisabled } from './webmcp.js';
import { findEngineBinary, type BrowserEngine } from './engines.js';
import { PAGE_BUNDLE } from './page-bundle.js';

export interface LaunchOptions {
  engine?: Exclude<BrowserEngine, 'extension'>;
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
  extensions?: string[];
  noWebmcp?: boolean;
  args?: string[];
  port?: number;
}

export function findChromeExecutable(explicit?: string): string {
  return findEngineBinary('chrome', explicit);
}

function httpGetJson<T = any>(url: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`HTTP timeout: ${url}`)));
  });
}

export async function getCdpVersion(
  baseUrl: string,
  timeoutMs = 2000,
): Promise<{ Browser?: string; webSocketDebuggerUrl?: string } | null> {
  const base = baseUrl.replace(/\/+$/, '');
  try {
    return await httpGetJson<{ Browser?: string; webSocketDebuggerUrl?: string }>(`${base}/json/version`, timeoutMs);
  } catch {
    return null;
  }
}

export class CdpConnection {
  private ws: RawWebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<(params: any, sessionId?: string) => void>>();

  constructor(ws: RawWebSocket) {
    this.ws = ws;
    this.ws.on('message', (raw: string | Buffer) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      let msg: any;
      try { msg = JSON.parse(text); } catch { return; }
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          entry.resolve(msg.result ?? {});
        }
      } else if (typeof msg.method === 'string') {
        const set = this.eventHandlers.get(msg.method);
        if (set) {
          for (const fn of set) {
            try { fn(msg.params ?? {}, msg.sessionId); } catch {}
          }
        }
      }
    });
    this.ws.on('close', () => {
      for (const [, p] of this.pending) {
        p.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(endpointOrWsUrl: string, timeoutMs = 10_000): Promise<CdpConnection> {
    let wsUrl = endpointOrWsUrl;
    if (/^https?:\/\//i.test(endpointOrWsUrl)) {
      const base = endpointOrWsUrl.replace(/\/+$/, '');
      const ver = await httpGetJson<{ webSocketDebuggerUrl?: string }>(`${base}/json/version`, timeoutMs);
      if (!ver.webSocketDebuggerUrl) {
        throw new Error(`No webSocketDebuggerUrl from ${base}/json/version`);
      }
      wsUrl = ver.webSocketDebuggerUrl;
    } else if (/^\d+$/.test(endpointOrWsUrl)) {
      const ver = await httpGetJson<{ webSocketDebuggerUrl?: string }>(`http://127.0.0.1:${endpointOrWsUrl}/json/version`, timeoutMs);
      if (!ver.webSocketDebuggerUrl) {
        throw new Error(`No webSocketDebuggerUrl on port ${endpointOrWsUrl}`);
      }
      wsUrl = ver.webSocketDebuggerUrl;
    }
    const ws = await RawWebSocket.connect(wsUrl, timeoutMs);
    return new CdpConnection(ws);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${timeoutMs}ms): ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val as T); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  on(event: string, fn: (params: any, sessionId?: string) => void): () => void {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  close(): void {
    this.ws.close();
  }
}

export interface LaunchedChrome {
  process: ChildProcess;
  wsEndpoint: string;
  connection: CdpConnection;
  userDataDir: string;
  ephemeralProfile: boolean;
  close: () => Promise<void>;
}

export async function launchChrome(opts: LaunchOptions = {}): Promise<LaunchedChrome> {
  const engine = opts.engine ?? 'chrome';
  const bin = engine === 'chrome' ? findChromeExecutable(opts.executablePath) : findEngineBinary(engine, opts.executablePath);
  const headless = opts.headless !== false;
  const ephemeralProfile = !opts.userDataDir;
  const baseTmp = process.platform !== 'win32' && fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  const userDataDir = opts.userDataDir ?? fs.mkdtempSync(path.join(baseTmp, 'hanzo-browser-'));
  const disableWebMcp = isWebMCPDisabled(opts.noWebmcp);

  if (engine === 'lightpanda') {
    const port = opts.port || 9222;
    const lpArgs = ['serve', '--host', '127.0.0.1', '--port', String(port), ...(opts.args || [])];
    const child = spawn(bin, lpArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const deadline = Date.now() + 12_000;
    let wsEndpoint = '';
    while (Date.now() < deadline) {
      const ver = await getCdpVersion(`http://127.0.0.1:${port}`, 800);
      if (ver?.webSocketDebuggerUrl) {
        wsEndpoint = ver.webSocketDebuggerUrl;
        break;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!wsEndpoint) {
      try { child.kill('SIGKILL'); } catch {}
      throw new Error(`Timed out waiting for Lightpanda CDP endpoint on port ${port}`);
    }
    const connection = await CdpConnection.connect(wsEndpoint);
    return {
      process: child,
      wsEndpoint,
      connection,
      userDataDir,
      ephemeralProfile,
      close: async () => {
        try { connection.close(); } catch {}
        try { child.kill('SIGTERM'); } catch {}
        if (ephemeralProfile) {
          try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
        }
      },
    };
  }

  const flags = [
    `--remote-debugging-port=${opts.port ?? 0}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-dev-shm-usage',
    '--window-size=1440,900',
  ];

  if (engine === 'obscura') {
    flags.push('--disable-blink-features=AutomationControlled');
  }

  if (!disableWebMcp) {
    flags.push('--enable-features=WebMCP,ModelContextProtocol', '--enable-experimental-web-platform-features');
  }

  const validExts = (opts.extensions ?? []).filter((d) => fs.existsSync(path.join(d, 'manifest.json')));
  if (validExts.length > 0) {
    const joined = validExts.join(',');
    flags.push(`--disable-extensions-except=${joined}`, `--load-extension=${joined}`);
  }

  if (headless) {
    flags.push('--headless=new', '--disable-gpu');
    if (process.platform === 'linux') {
      flags.push('--no-sandbox', '--disable-setuid-sandbox');
    }
  } else if (typeof process.getuid === 'function' && process.getuid() === 0) {
    flags.push('--no-sandbox');
  } else if (process.env.CI || process.env.HANZO_BROWSER_NO_SANDBOX === '1') {
    flags.push('--no-sandbox');
  }

  if (opts.args?.length) flags.push(...opts.args);
  flags.push('about:blank');

  const child = spawn(bin, flags, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const wsEndpoint = await new Promise<string>((resolve, reject) => {
    let stderrBuf = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for Chrome DevTools endpoint. Stderr:\n${stderrBuf}`));
    }, 15_000);

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (code ${code}). Stderr:\n${stderrBuf}`));
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk;
      const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
      if (m?.[1]) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });

  const connection = await CdpConnection.connect(wsEndpoint);

  const close = async () => {
    try { connection.close(); } catch {}
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
          resolve();
        }, 2000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (ephemeralProfile) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  };

  return {
    process: child,
    wsEndpoint,
    connection,
    userDataDir,
    ephemeralProfile,
    close,
  };
}

/** Page helper script for raw CDP sessions to generate `[ref=eN]` snapshots & ref actions. */
export const CDP_SNAPSHOT_RUNTIME = `
(() => {
  const g = globalThis;
  if (!g.__hanzoRefs) g.__hanzoRefs = { next: 1, map: new Map() };
  const state = g.__hanzoRefs;

  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return tag;
  };

  const labelOf = (el) => {
    const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt'));
    if (aria && aria.trim()) return aria.trim();
    if (el.labels && el.labels.length > 0) {
      const lt = Array.from(el.labels).map((l) => l.textContent || '').join(' ').replace(/\\s+/g, ' ').trim();
      if (lt) return lt;
    }
    const txt = (el.innerText || el.textContent || el.value || '').replace(/\\s+/g, ' ').trim();
    return txt.slice(0, 120);
  };

  const isInteractive = (el) => {
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'input', 'textarea', 'select', 'summary'].includes(tag)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['button', 'link', 'textbox', 'checkbox', 'radio', 'tab', 'menuitem', 'combobox', 'switch'].includes(role)) return true;
    return el.tabIndex >= 0 || el.isContentEditable;
  };

  const refFor = (el) => {
    let existing = el.getAttribute('data-hanzo-ref');
    if (existing) {
      state.map.set(existing, el);
      return existing;
    }
    const id = 'e' + (state.next++);
    el.setAttribute('data-hanzo-ref', id);
    state.map.set(id, el);
    return id;
  };

  return {
    snapshot(opts = {}) {
      const root = opts.selector ? document.querySelector(opts.selector) : document.body;
      if (!root) return { title: document.title, url: location.href, refs: 0, tree: '' };
      const lines = [];
      let refs = 0;
      const walk = (node, depth) => {
        if (!node || node.nodeType !== 1) return;
        if (opts.depth && depth > opts.depth) return;
        const el = node;
        if (!isVisible(el)) return;
        const inter = isInteractive(el);
        const role = roleOf(el);
        const name = labelOf(el);
        if (inter) {
          const ref = refFor(el);
          refs++;
          lines.push('  '.repeat(opts.interactive ? 0 : depth) + '- ' + role + (name ? ' ' + JSON.stringify(name) : '') + ' [ref=' + ref + ']');
        } else if (!opts.interactive && (/^h[1-6]$/.test(el.tagName.toLowerCase()) || ['main', 'nav', 'dialog', 'form'].includes(el.tagName.toLowerCase()))) {
          lines.push('  '.repeat(depth) + '- ' + role + (name ? ' ' + JSON.stringify(name) : ''));
        }
        for (const child of Array.from(el.children)) walk(child, opts.interactive ? 0 : depth + 1);
      };
      walk(root, 0);
      return { title: document.title, url: location.href, refs, tree: lines.join('\\n') };
    },
    resolve(selector) {
      const s = String(selector || '').trim();
      const m = s.match(/^@?(e\\d+)$/);
      if (m) {
        return state.map.get(m[1]) || document.querySelector('[data-hanzo-ref="' + m[1] + '"]');
      }
      return document.querySelector(s);
    },
  };
})()
`;

export async function installCdpPageHelpers(cdp: CdpConnection, sessionId: string, noWebmcp?: boolean): Promise<void> {
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('DOM.enable', {}, sessionId);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_BUNDLE }, sessionId).catch(() => {});
  await cdp.send('Runtime.evaluate', { expression: PAGE_BUNDLE }, sessionId).catch(() => {});
  if (!isWebMCPDisabled(noWebmcp)) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: WEBMCP_PAGE_BOOTSTRAP }, sessionId).catch(() => {});
    await cdp.send('Runtime.evaluate', { expression: WEBMCP_PAGE_BOOTSTRAP }, sessionId).catch(() => {});
  }
}
