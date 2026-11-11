import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BrowserSession,
  WEBMCP_CHROME_FLAGS,
  WebMCPCatalogTracker,
  ZapTransport,
  buildEngineArgs,
  buildWebMcpSummary,
  createBrowser,
  delimitUntrusted,
  encodeZapFrame,
  getSessionsViaZap,
  PROVIDERS,
  PROVIDERS_LIST,
  RESPONSE,
  ROUTE,
  HELLO,
  WELCOME,
  truncateUtf8Description,
  utf8ByteLength,
} from '../src/index.js';
import { parseArgv } from '../src/cli.js';

describe('@hanzo/browser WebMCP, Shadow-DOM SVG, ZAP router & headless native CDP', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.url === '/plain') {
        res.end('<!doctype html><html><head><title>Plain Page</title></head><body><main><h1>Plain Heading</h1><p>Clean markdown body.</p></main></body></html>');
        return;
      }
      res.end(`<!doctype html>
<html>
  <head><title>WebMCP & LastPass Shadow Demo</title></head>
  <body>
    <h1>Product Catalog</h1>
    <input id="q" placeholder="Filter" value="" />
    <button id="go" onclick="document.getElementById('out').textContent = document.getElementById('q').value">Apply</button>
    <div id="out"></div>
    <div id="lp-clicked">no</div>
    <div data-lastpass-icon-root="true" id="lp-host" style="position:relative;width:24px;height:24px;display:inline-block;"></div>
    <form toolname="feedback_form" tooldescription="Submit product feedback">
      <input name="comment" required />
    </form>
    <script>
      // Attach open shadow root with overlapping <svg> and sibling <rect> hit-target (reproducing x.com LastPass icon)
      const host = document.getElementById('lp-host');
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = \`
        <div role="button" aria-label="Open LastPass Vault" style="position:relative;width:24px;height:24px;cursor:pointer;">
          <svg id="lp-svg" width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:0;top:0;">
            <circle cx="12" cy="12" r="10" fill="red"></circle>
          </svg>
          <svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:0;top:0;">
            <rect id="lp-cover-rect" x="0" y="0" width="24" height="24" fill="transparent"></rect>
          </svg>
        </div>
      \`;
      sr.querySelector('[role="button"]').addEventListener('click', () => {
        document.getElementById('lp-clicked').textContent = 'yes';
      });

      if (navigator.modelContext) {
        navigator.modelContext.registerTool({
          name: 'search_products',
          description: 'Search products by keyword',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          execute: async (args) => ({ matches: ['zen-5', 'enso'], query: args.query }),
        });
      }
    </script>
  </body>
</html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('enforces WebMCP summary limits, schema-change deltas, clear updates, and nonce boundaries', () => {
    const tracker = new WebMCPCatalogTracker();
    expect(tracker.update([{ frameId: '0', origin: baseUrl, tools: [] }])).toBeUndefined();

    const s1 = tracker.update([{
      frameId: '0',
      origin: baseUrl,
      tools: [{ name: 'search', description: 'Search items', inputSchema: { type: 'object' } }],
    }]);
    expect(s1?.status).toBe('ready');
    expect(s1?.toolCount).toBe(1);

    // Unchanged -> omitted
    expect(tracker.update([{
      frameId: '0',
      origin: baseUrl,
      tools: [{ name: 'search', description: 'Search items', inputSchema: { type: 'object' } }],
    }])).toBeUndefined();

    // Cleared -> one-time ready with tools: []
    const cleared = tracker.update([{ frameId: '0', origin: baseUrl, tools: [] }]);
    expect(cleared?.tools).toEqual([]);
    expect(tracker.update([{ frameId: '0', origin: baseUrl, tools: [] }])).toBeUndefined();

    // 20 tools -> capped at 16 & <= 4 KiB
    const many = buildWebMcpSummary(
      Array.from({ length: 20 }, (_, i) => ({
        name: `tool_${i}`,
        description: truncateUtf8Description('x'.repeat(220)).text,
        frameId: '0',
        origin: baseUrl,
      })),
    );
    expect(many.tools.length).toBe(16);
    expect(many.truncated).toBe(true);
    expect(utf8ByteLength(JSON.stringify(many))).toBeLessThanOrEqual(4096);
    expect(delimitUntrusted('hello', 'abc123')).toContain('<<<UNTRUSTED_PAGE_METADATA_abc123>>>');
  });

  it('builds engine flags for chrome, lightpanda, and obscura with WebMCP opt-out', () => {
    const chromeDefault = buildEngineArgs({ engine: 'chrome', port: 9222, headless: true });
    for (const flag of WEBMCP_CHROME_FLAGS) {
      expect(chromeDefault).toContain(flag);
    }

    const chromeNoWebmcp = buildEngineArgs({ engine: 'chrome', port: 9222, headless: true, webmcp: false });
    for (const flag of WEBMCP_CHROME_FLAGS) {
      expect(chromeNoWebmcp).not.toContain(flag);
    }

    const lp = buildEngineArgs({ engine: 'lightpanda', port: 9333 });
    expect(lp).toEqual(['serve', '--host', '127.0.0.1', '--port', '9333']);

    const obs = buildEngineArgs({ engine: 'obscura', port: 9444, headless: true });
    expect(obs).toContain('--disable-blink-features=AutomationControlled');

    const parsed = parseArgv(['webmcp', 'call', 'search_products', '{"query":"zen"}', '--frame', '0', '--json']);
    expect(parsed.positionals).toEqual(['webmcp', 'call', 'search_products', '{"query":"zen"}']);
    expect(parsed.flags.frame).toBe('0');
    expect(parsed.flags.json).toBe(true);
  });

  it('speaks HIP-0069 ZAP router wire protocol and falls back to hanzo.getCookies without leaking values', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-zap-test-'));
    const sockPath = path.join(tmpDir, 'zapd.sock');
    const seenMethods: string[] = [];

    const encStr16 = (s: string) => {
      const b = Buffer.from(s, 'utf8');
      const l = Buffer.alloc(2);
      l.writeUInt16LE(b.length, 0);
      return Buffer.concat([l, b]);
    };
    const encU16 = (n: number) => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(n, 0);
      return b;
    };

    const providersPayload = Buffer.concat([
      encU16(1),
      encStr16('browser/chrome-test'),
      Buffer.from([1]),
      encStr16('chrome'),
      encU16(1),
      encStr16('browser'),
      encU16(0),
    ]);

    const conns = new Set<net.Socket>();
    const zapServer = net.createServer((conn) => {
      conns.add(conn);
      conn.on('close', () => conns.delete(conn));
      let buf = Buffer.alloc(0);
      conn.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
          const len = buf.readUInt32LE(0);
          if (buf.length < 4 + len) break;
          const raw = buf.subarray(0, 4 + len);
          buf = buf.subarray(4 + len);
          const t = raw.readUInt8(4);
          const fl = raw.readUInt16LE(7);
          const tl = raw.readUInt16LE(9);
          const pl = raw.readUInt32LE(11);
          const from = raw.subarray(15, 15 + fl).toString('utf8');
          const payload = raw.subarray(15 + fl + tl, 15 + fl + tl + pl);

          if (t === HELLO) {
            conn.write(encodeZapFrame(WELCOME, 'router', from));
          } else if (t === PROVIDERS_LIST) {
            conn.write(encodeZapFrame(PROVIDERS, 'router', from, providersPayload));
          } else if (t === ROUTE) {
            const mLen = payload.readUInt16LE(0);
            const method = payload.subarray(2, 2 + mLen).toString('utf8');
            seenMethods.push(method);
            if (method === 'social.sessions') {
              conn.write(encodeZapFrame(RESPONSE, 'browser/chrome-test', from, Buffer.from('ERR:unknown method social.sessions')));
            } else if (method === 'hanzo.getCookies') {
              const fakeCookies = {
                cookies: [
                  { name: 'auth_token', domain: '.x.com', value: 'TOP_SECRET_X_TOKEN_NEVER_LEAK' },
                  { name: 'PHPSESSID', domain: 'lastpass.com', value: 'TOP_SECRET_LP_SESSION_NEVER_LEAK' },
                ],
              };
              conn.write(encodeZapFrame(RESPONSE, 'browser/chrome-test', from, Buffer.from(JSON.stringify(fakeCookies))));
            } else if (method === 'lastpass.status') {
              conn.write(encodeZapFrame(RESPONSE, 'browser/chrome-test', from, Buffer.from(JSON.stringify({
                extensionDetected: true,
                vaultLoggedIn: true,
                cookieNames: ['PHPSESSID'],
              }))));
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => zapServer.listen(sockPath, () => resolve()));
    try {
      const zap = new ZapTransport(sockPath);
      const sessionRes = await getSessionsViaZap(zap);
      expect(sessionRes.source).toBe('getCookies-fallback');
      const serialized = JSON.stringify(sessionRes);
      expect(serialized).not.toContain('TOP_SECRET_X_TOKEN_NEVER_LEAK');
      expect(serialized).not.toContain('TOP_SECRET_LP_SESSION_NEVER_LEAK');

      const xSess = sessionRes.sessions.find((s) => s.provider === 'x');
      expect(xSess?.loggedIn).toBe(true);
      expect(xSess?.cookieNames).toEqual(['auth_token']);

      const lpSess = sessionRes.sessions.find((s) => s.provider === 'lastpass');
      expect(lpSess?.loggedIn).toBe(true);
      expect(lpSess?.cookieNames).toEqual(['PHPSESSID']);

      const browser = await createBrowser({ engine: 'extension', zapSocketPath: sockPath });
      const lpStatus = await browser.lastpass('status');
      expect(lpStatus.vaultLoggedIn).toBe(true);
      expect(seenMethods).toContain('lastpass.status');
      await browser.close();
    } finally {
      for (const c of conns) c.destroy();
      await new Promise<void>((resolve) => zapServer.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('drives headless Chromium over raw WebSocket CDP with zero Playwright, clicks Shadow-DOM SVGs, and executes WebMCP tools', async () => {
    const session: BrowserSession = await createBrowser({ mode: 'cdp', headless: true });
    try {
      const opened = await session.navigate(baseUrl);
      expect(opened.title).toBe('WebMCP & LastPass Shadow Demo');
      expect(opened.webmcp?.status).toBe('ready');
      expect(opened.webmcp?.toolCount).toBe(2);

      // Snapshot on unchanged page omits duplicate webmcp summary and uses shared snapshot.ts [ref=eN] / @eN refs
      const snap = await session.snapshot({ interactive: true });
      expect(snap.webmcp).toBeUndefined();
      expect(snap.tree).toContain('[ref=e');
      expect(snap.tree).toContain('Open LastPass Vault');

      // Click SVG inside ShadowRoot covered by sibling <rect> via >>> piercing selector!
      await session.click('[data-lastpass-icon-root] >>> #lp-svg');
      expect(await session.evaluate('document.getElementById("lp-clicked").textContent')).toBe('yes');

      // Fetch full schema for search_products
      const schemaRes = await session.webmcpList('search_products');
      expect(schemaRes.tool?.name).toBe('search_products');
      expect(schemaRes.tool?.inputSchema).toMatchObject({ required: ['query'] });

      // Call WebMCP imperative tool via webmcpCall alias
      const invoked = await session.webmcpCall('search_products', { query: 'zen' });
      expect(invoked.result).toEqual({ matches: ['zen-5', 'enso'], query: 'zen' });

      // Detached invocation + result
      const detached = await session.webmcpInvoke('search_products', { query: 'async' }, { detach: true });
      expect(detached.detached).toBe(true);
      await new Promise((r) => setTimeout(r, 80));
      const polled = await session.webmcpResult(String(detached.invocationId));
      expect(polled.status).toBe('completed');
      expect(polled.result).toEqual({ matches: ['zen-5', 'enso'], query: 'async' });

      // Fill + click over shared snapshot.ts ref engine
      await session.fill('#q', 'sovereign-cdp');
      await session.click('#go');
      expect(await session.evaluate('document.getElementById("out").textContent')).toBe('sovereign-cdp');

      // Navigating to plain page emits one-time clear summary (tools: []) and supports read()
      const plain = await session.open(`${baseUrl}/plain`);
      expect(plain.webmcp?.status).toBe('ready');
      expect(plain.webmcp?.tools).toEqual([]);
      const md = await session.read();
      expect(md.markdown).toContain('Plain Heading');
    } finally {
      await session.close();
    }
  });
});
