/**
 * End-to-end QA suite for:
 *   1. Chrome & Firefox extension dist/ build completeness + deterministic ZIP archives
 *   2. Hanzo ID OAuth2 + PKCE (S256) login, refresh, userinfo & CSRF/verifier rejection
 *   3. Live loopback WebSocket ZAP router + MCP browser tab bridge (`snapshot`, `click`, `screenshot`)
 *   4. Hardening of decodeCmd() against truncated/trailing frames and `__proto__` param keys
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { JSDOM } from 'jsdom';
import { setup as ensureBuiltDist } from './built-dist';
import {
  AUTH,
  HELLO,
  PROVIDERS,
  PROVIDERS_LIST,
  RESPONSE,
  ROUTE,
  WELCOME,
  decodeCmd,
  decodeFrame,
  encodeFrame,
  ensureZap,
  newZapState,
  parsePairing,
  proof,
  type Frame,
} from '../src/shared/socket';
import {
  PENDING_PKCE_KEY,
  login as browserLogin,
  getAuthStatus as browserGetAuthStatus,
  getValidAccessToken as browserGetValidAccessToken,
  logout as browserLogout,
  type BrowserAdapter,
  type BrowserStorage,
} from '../src/shared/auth';
import { STORAGE_KEYS } from '../src/shared/config';
import { DISCOVERY_KEY } from '../src/shared/discovery';
import { act, snapshot } from '../src/shared/snapshot';
import {
  authClientFor,
  currentUser as coreCurrentUser,
  getValidToken as coreGetValidToken,
  login as coreLogin,
  logout as coreLogout,
  type TokenSet,
  type TokenStore,
} from '../../auth/src/index';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');

// ─── Minimal Deterministic PKZIP Builder + Central-Directory Inspector ──────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function collectFiles(dir: string, prefix = ''): Array<{ rel: string; data: Buffer }> {
  const out: Array<{ rel: string; data: Buffer }> = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      out.push(...collectFiles(full, rel));
    } else {
      out.push({ rel, data: fs.readFileSync(full) });
    }
  }
  return out;
}

function buildZipArchive(sourceDir: string, outZipPath: string): string[] {
  const entries = collectFiles(sourceDir);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const { rel, data } of entries) {
    const nameBuf = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);

    localChunks.push(localHeader, nameBuf, data);

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0x0800, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(data.length, 20);
    cdHeader.writeUInt32LE(data.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt32LE(offset, 42);

    centralChunks.push(cdHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  fs.writeFileSync(outZipPath, Buffer.concat([...localChunks, centralBuf, eocd]));
  return entries.map((e) => e.rel);
}

function readZipEntryNames(zipPath: string): string[] {
  const buf = fs.readFileSync(zipPath);
  expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocdOffset).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocdOffset + 10);
  let ptr = buf.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(ptr)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    names.push(buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8'));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// ─── Binary ZAP Command Encoder (mirrors shared/socket.ts decodeCmd) ───────

function encodeCmd(method: string, params: Record<string, string> | Array<[string, string]> = {}): Uint8Array {
  const enc = new TextEncoder();
  const mBytes = enc.encode(method);
  const rawEntries = Array.isArray(params) ? params : Object.entries(params);
  const pairs = rawEntries.map(([k, v]) => [enc.encode(k), enc.encode(v)] as const);
  let size = 2 + mBytes.length + 2;
  for (const [kb, vb] of pairs) size += 2 + kb.length + 4 + vb.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint16(o, mBytes.length, true); o += 2;
  out.set(mBytes, o); o += mBytes.length;
  dv.setUint16(o, pairs.length, true); o += 2;
  for (const [kb, vb] of pairs) {
    dv.setUint16(o, kb.length, true); o += 2;
    out.set(kb, o); o += kb.length;
    dv.setUint32(o, vb.length, true); o += 4;
    out.set(vb, o); o += vb.length;
  }
  return out;
}

function encodeProvidersList(entries: Array<{ id: string; role: number; brand: string; caps: string[] }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const u16 = (n: number) => chunks.push(n & 0xff, (n >> 8) & 0xff);
  const str = (s: string) => {
    const b = enc.encode(s);
    u16(b.length);
    for (const byte of b) chunks.push(byte);
  };
  u16(entries.length);
  for (const entry of entries) {
    str(entry.id);
    chunks.push(entry.role & 0xff);
    str(entry.brand);
    u16(entry.caps.length);
    for (const cap of entry.caps) str(cap);
    u16(1);
    str('leasable');
    str('true');
  }
  return new Uint8Array(chunks);
}

// ─── Loopback OIDC / PKCE Test Server ───────────────────────────────────────

class LoopbackIamServer {
  baseUrl = '';
  issuedCodes = new Map<string, { clientId: string; redirectUri: string; codeChallenge: string; used: boolean }>();
  issuedRefreshTokens = new Set<string>();
  lastIssuedJwt = '';
  forceMismatchState?: string;
  private seq = 0;
  private server = http.createServer((req, res) => void this.handle(req, res));

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const addr = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${addr.port}`;
  }

  stop(): void {
    this.server.close();
    this.server.closeAllConnections();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', this.baseUrl);
    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    const form = new URLSearchParams(rawBody);
    const sendJson = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      return sendJson(200, {
        issuer: this.baseUrl,
        authorization_endpoint: `${this.baseUrl}/login/oauth/authorize`,
        token_endpoint: `${this.baseUrl}/api/login/oauth/access_token`,
        jwks_uri: `${this.baseUrl}/.well-known/jwks`,
        userinfo_endpoint: `${this.baseUrl}/api/userinfo`,
      });
    }

    if (
      url.pathname === '/login/oauth/authorize' ||
      url.pathname === '/v1/iam/oauth/authorize' ||
      url.pathname === '/oauth/authorize' ||
      url.pathname === '/login'
    ) {
      const clientId = url.searchParams.get('client_id') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const codeChallenge = url.searchParams.get('code_challenge') || '';
      const method = url.searchParams.get('code_challenge_method') || '';
      const state = this.forceMismatchState ?? (url.searchParams.get('state') || '');
      if (!clientId || !redirectUri || !codeChallenge || method !== 'S256') {
        return sendJson(400, { error: 'invalid_request' });
      }
      const code = `auth-code-${++this.seq}`;
      this.issuedCodes.set(code, { clientId, redirectUri, codeChallenge, used: false });
      const callback = new URL(redirectUri);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', state);
      res.writeHead(302, { Location: callback.toString() }).end();
      return;
    }

    if (
      url.pathname === '/api/login/oauth/access_token' ||
      url.pathname === '/v1/iam/oauth/token' ||
      url.pathname === '/oauth/token'
    ) {
      const grant = form.get('grant_type');
      const clientId = form.get('client_id') || '';
      if (grant === 'authorization_code') {
        const code = form.get('code') || '';
        const verifier = form.get('code_verifier') || '';
        const redirectUri = form.get('redirect_uri') || '';
        const rec = this.issuedCodes.get(code);
        if (!rec || rec.used || rec.clientId !== clientId || rec.redirectUri !== redirectUri) {
          return sendJson(400, { error: 'invalid_grant' });
        }
        const computed = createHash('sha256').update(verifier).digest('base64url');
        if (computed !== rec.codeChallenge) {
          return sendJson(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
        rec.used = true;
        const refreshToken = `rt-${++this.seq}`;
        this.issuedRefreshTokens.add(refreshToken);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
          iss: this.baseUrl,
          sub: 'usr_hanzo_qa',
          name: 'QA Engineer',
          email: 'qa@hanzo.ai',
        })).toString('base64url');
        const jwt = `${header}.${payload}.sig`;
        this.lastIssuedJwt = jwt;
        return sendJson(200, {
          access_token: jwt,
          refresh_token: refreshToken,
          id_token: jwt,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      if (grant === 'refresh_token') {
        const rt = form.get('refresh_token') || '';
        if (!this.issuedRefreshTokens.has(rt)) {
          return sendJson(400, { error: 'invalid_grant' });
        }
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
          iss: this.baseUrl,
          sub: 'usr_hanzo_qa',
          name: 'QA Engineer',
          email: 'qa@hanzo.ai',
        })).toString('base64url');
        return sendJson(200, {
          access_token: `${header}.${payload}.refreshed`,
          id_token: `${header}.${payload}.refreshed`,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      return sendJson(400, { error: 'unsupported_grant_type' });
    }

    if (
      url.pathname === '/api/userinfo' ||
      url.pathname === '/v1/iam/oauth/userinfo' ||
      url.pathname === '/oauth/userinfo'
    ) {
      const authz = req.headers.authorization || '';
      if (!authz.startsWith('Bearer ') || !authz.slice(7).trim()) {
        return sendJson(401, { error: 'invalid_token' });
      }
      return sendJson(200, {
        sub: 'usr_hanzo_qa',
        name: 'QA Engineer',
        email: 'qa@hanzo.ai',
        org: 'hanzo',
      });
    }

    res.writeHead(404).end('not found');
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterAll(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('1. Browser extension Chrome/Firefox build & store archive QA', () => {
  it('builds dist/chrome and dist/firefox with matching version, manifests, assets, and valid ZIP packages', () => {
    ensureBuiltDist();

    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const chromeManifest = JSON.parse(fs.readFileSync(path.join(DIST_ROOT, 'chrome', 'manifest.json'), 'utf8'));
    const firefoxManifest = JSON.parse(fs.readFileSync(path.join(DIST_ROOT, 'firefox', 'manifest.json'), 'utf8'));

    expect(chromeManifest.manifest_version).toBe(3);
    expect(chromeManifest.version).toBe(pkg.version);
    expect(chromeManifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(chromeManifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'tabs', 'scripting', 'debugger', 'nativeMessaging']),
    );

    expect(firefoxManifest.manifest_version).toBe(3);
    expect(firefoxManifest.version).toBe(pkg.version);
    expect(firefoxManifest.background?.scripts).toContain('background.js');
    expect(firefoxManifest.browser_specific_settings?.gecko?.id).toBe('hanzo-ai@hanzo.ai');

    const requiredAssets = [
      'manifest.json',
      'background.js',
      'content-script.js',
      'page.js',
      'popup.html',
      'popup.js',
      'sidebar.html',
      'sidebar.js',
      'newtab.html',
      'newtab.js',
      'onboarding.html',
      'onboarding.js',
      'callback.html',
      'icon16.png',
      'icon48.png',
      'icon128.png',
    ];

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-ext-zip-qa-'));
    tmpDirs.push(outDir);

    for (const target of ['chrome', 'firefox'] as const) {
      const targetDir = path.join(DIST_ROOT, target);
      for (const asset of requiredAssets) {
        const assetPath = path.join(targetDir, asset);
        expect(fs.existsSync(assetPath), `${target}/${asset}`).toBe(true);
        expect(fs.statSync(assetPath).size, `${target}/${asset} non-empty`).toBeGreaterThan(0);
      }
      const zipPath = path.join(outDir, `hanzo-ai-${target}-v${pkg.version}.zip`);
      const written = buildZipArchive(targetDir, zipPath);
      const readBack = readZipEntryNames(zipPath);
      expect(readBack).toEqual(written);
      expect(readBack).toContain('manifest.json');
      expect(readBack).toContain('background.js');
      expect(readBack).toContain('page.js');
    }
  });
});

describe('2. Hanzo ID OAuth2 + PKCE end-to-end sign-in QA', () => {
  let iam: LoopbackIamServer;

  beforeEach(async () => {
    iam = new LoopbackIamServer();
    await iam.start();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    iam.stop();
  });

  it('completes OAuth2 S256 PKCE login, token refresh, userinfo, and logout via @hanzo/auth', async () => {
    let saved: TokenSet | null = null;
    const store: TokenStore = {
      async get() { return saved; },
      async set(tokens) { saved = tokens; },
      async clear() { saved = null; },
    };

    const client = authClientFor('browser', {
      loginIssuer: iam.baseUrl,
      apiIssuer: iam.baseUrl,
      redirectUri: 'https://hanzo.ai/callback',
    });

    const opener = {
      async open(authorizeUrl: string): Promise<string> {
        const resp = await fetch(authorizeUrl, { redirect: 'manual' });
        expect(resp.status).toBe(302);
        return resp.headers.get('location')!;
      },
    };

    const tokens = await coreLogin(client, store, opener);
    expect(tokens.accessToken).toBe(iam.lastIssuedJwt);
    expect(tokens.refreshToken).toBeTruthy();

    const user = await coreCurrentUser(client, store);
    expect(user).toMatchObject({ sub: 'usr_hanzo_qa', email: 'qa@hanzo.ai', org: 'hanzo' });

    // Force near-expiry to verify refresh_token rotation path
    saved = { ...tokens, expiresAt: Date.now() + 10_000 };
    const refreshed = await coreGetValidToken(client, store);
    expect(refreshed).not.toBe('');
    expect(refreshed).not.toBe(tokens.accessToken);

    // Reject forged state (CSRF defense)
    iam.forceMismatchState = 'forged-state';
    await expect(coreLogin(client, store, opener)).rejects.toThrow(/state mismatch/i);

    await coreLogout(store);
    expect(await coreGetValidToken(client, store)).toBe('');
  });

  it('completes browser extension shared/auth login flow against loopback OIDC endpoints', async () => {
    const storageData: Record<string, any> = {
      hanzo_config_iam_login_url: 'https://id.hanzo.test',
      hanzo_config_iam_api_url: 'https://id.hanzo.test',
      hanzo_config_redirect_uri: 'https://hanzo.ai/callback',
      [DISCOVERY_KEY]: {
        url: 'https://id.hanzo.test/.well-known/openid-configuration',
        at: Date.now(),
        doc: {
          issuer: iam.baseUrl,
          authorization_endpoint: `${iam.baseUrl}/login/oauth/authorize`,
          token_endpoint: `${iam.baseUrl}/api/login/oauth/access_token`,
          jwks_uri: `${iam.baseUrl}/.well-known/jwks`,
          userinfo_endpoint: `${iam.baseUrl}/api/userinfo`,
        },
      },
    };
    const storage: BrowserStorage = {
      async get(keys) { return Object.fromEntries(keys.filter((k) => k in storageData).map((k) => [k, storageData[k]])); },
      async set(items) { Object.assign(storageData, items); },
      async remove(keys) { for (const k of keys) delete storageData[k]; },
    };

    const updatedListeners = new Set<(tabId: number, info: { url?: string; status?: string }, tab?: any) => void>();
    const removedTabs: number[] = [];
    const adapter: BrowserAdapter = {
      storage,
      tabs: {
        async create({ url }) {
          // Rewrite compile-time `${config.iamLoginUrl}/login` to live loopback IAM server
          const realAuthorizeUrl = url.replace('https://id.hanzo.test', iam.baseUrl);
          const resp = await fetch(realAuthorizeUrl, { redirect: 'manual' });
          const redirectTarget = resp.headers.get('location')!;
          setTimeout(() => {
            for (const fn of updatedListeners) fn(42, { url: redirectTarget, status: 'complete' }, { id: 42, url: redirectTarget });
          }, 5);
          return { id: 42, url };
        },
        async remove(tabId) { removedTabs.push(tabId); },
        onUpdated: {
          addListener: (fn) => updatedListeners.add(fn),
          removeListener: (fn) => updatedListeners.delete(fn),
        },
        onRemoved: {
          addListener: () => {},
          removeListener: () => {},
        },
      },
    };

    const user = await browserLogin(adapter);
    expect(user).toMatchObject({ sub: 'usr_hanzo_qa', email: 'qa@hanzo.ai', org: 'hanzo' });
    expect(storageData[PENDING_PKCE_KEY]).toBeUndefined();
    expect(storageData[STORAGE_KEYS.accessToken]).toBe(iam.lastIssuedJwt);
    expect(removedTabs).toContain(42);

    const status = await browserGetAuthStatus(storage);
    expect(status.authenticated).toBe(true);
    expect(status.user?.email).toBe('qa@hanzo.ai');

    await browserLogout(storage);
    expect(await browserGetValidAccessToken(storage)).toBeNull();
  });
});

describe('3. decodeCmd() wire parser hardening', () => {
  it('decodes valid commands and rejects truncated or trailing payloads', () => {
    const valid = encodeCmd('hanzo.click', { x: '120', y: '80', selector: '#go' });
    expect(decodeCmd(valid)).toEqual({
      method: 'hanzo.click',
      params: { x: '120', y: '80', selector: '#go' },
    });

    expect(() => decodeCmd(new Uint8Array(0))).toThrow(/truncated/i);
    expect(() => decodeCmd(valid.slice(0, 5))).toThrow(/truncated/i);
    expect(() => decodeCmd(valid.slice(0, -2))).toThrow(/truncated/i);

    const trailing = new Uint8Array(valid.length + 1);
    trailing.set(valid);
    trailing[valid.length] = 0x7f;
    expect(() => decodeCmd(trailing)).toThrow(/trailing bytes/i);
  });

  it('prevents __proto__ param keys from mutating Object.prototype', () => {
    const payload = encodeCmd('hanzo.snapshot', [['__proto__', 'polluted'], ['interactive', 'true']]);
    const decoded = decodeCmd(payload);
    expect(decoded.method).toBe('hanzo.snapshot');
    expect(Object.prototype.hasOwnProperty.call(decoded.params, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(decoded.params, '__proto__')?.value).toBe('polluted');
    expect(decoded.params.interactive).toBe('true');
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(decoded.params)).toBe(Object.prototype);
  });
});

describe('4. Live WebSocket ZAP router + MCP browser bridge (snapshot, click, screenshot)', () => {
  const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  let wss: WebSocketServer | undefined;
  let activeZapState: ReturnType<typeof newZapState> | undefined;
  let origChrome: any;
  let origWebSocket: any;
  let origWindow: any;
  let origDoc: any;
  let origLocation: PropertyDescriptor | undefined;
  let origElement: any;
  let origHtmlElement: any;
  let origHtmlInputElement: any;
  let origHtmlTextAreaElement: any;
  let origHtmlSelectElement: any;
  let origShadowRoot: any;
  let origMouseEvent: any;
  let origInputEvent: any;
  let origEvent: any;
  let origNode: any;
  let origNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    origChrome = (globalThis as any).chrome;
    origWebSocket = (globalThis as any).WebSocket;
    origWindow = (globalThis as any).window;
    origDoc = (globalThis as any).document;
    origLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    origElement = (globalThis as any).Element;
    origHtmlElement = (globalThis as any).HTMLElement;
    origHtmlInputElement = (globalThis as any).HTMLInputElement;
    origHtmlTextAreaElement = (globalThis as any).HTMLTextAreaElement;
    origHtmlSelectElement = (globalThis as any).HTMLSelectElement;
    origShadowRoot = (globalThis as any).ShadowRoot;
    origMouseEvent = (globalThis as any).MouseEvent;
    origInputEvent = (globalThis as any).InputEvent;
    origEvent = (globalThis as any).Event;
    origNode = (globalThis as any).Node;
    origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (activeZapState?.timer) clearTimeout(activeZapState.timer);
    activeZapState?.socket?.close();
    activeZapState = undefined;
    (globalThis as any).chrome = origChrome;
    (globalThis as any).WebSocket = origWebSocket;
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDoc;
    if (origLocation) Object.defineProperty(globalThis, 'location', origLocation);
    else delete (globalThis as any).location;
    (globalThis as any).Element = origElement;
    (globalThis as any).HTMLElement = origHtmlElement;
    (globalThis as any).HTMLInputElement = origHtmlInputElement;
    (globalThis as any).HTMLTextAreaElement = origHtmlTextAreaElement;
    (globalThis as any).HTMLSelectElement = origHtmlSelectElement;
    (globalThis as any).ShadowRoot = origShadowRoot;
    (globalThis as any).MouseEvent = origMouseEvent;
    (globalThis as any).InputEvent = origInputEvent;
    (globalThis as any).Event = origEvent;
    (globalThis as any).Node = origNode;
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    }
    delete (globalThis as any).__hanzoPage;
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
      wss = undefined;
    }
  });

  it('authenticates over live loopback ZAP WebSocket and executes snapshot, click, and screenshot end-to-end', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head><title>Hanzo QA Page</title></head>
        <body>
          <main>
            <h1>Workspace Dashboard</h1>
            <button id="launch-btn">Launch Agent</button>
            <p id="status">Clicks: 0</p>
          </main>
          <script>
            let count = 0;
            document.getElementById('launch-btn').addEventListener('click', () => {
              count += 1;
              document.getElementById('status').textContent = 'Clicks: ' + count;
            });
          </script>
        </body>
      </html>
    `, { url: 'https://example.test/dashboard', runScripts: 'dangerously' });

    const w = dom.window;
    w.Element.prototype.scrollIntoView = () => {};
    const launchBtn = w.document.getElementById('launch-btn') as HTMLElement;
    const btnRect = { x: 100, y: 60, width: 120, height: 32, left: 100, top: 60, right: 220, bottom: 92, toJSON() {} } as DOMRect;
    launchBtn.getBoundingClientRect = () => btnRect;
    (w.document as any).elementFromPoint = (x: number, y: number) =>
      x >= btnRect.left && x < btnRect.right && y >= btnRect.top && y < btnRect.bottom ? launchBtn : null;
    (globalThis as any).window = w;
    (globalThis as any).document = w.document;
    Object.defineProperty(globalThis, 'location', { value: w.location, configurable: true });
    (globalThis as any).Element = w.Element;
    (globalThis as any).HTMLElement = w.HTMLElement;
    (globalThis as any).HTMLInputElement = w.HTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = w.HTMLTextAreaElement;
    (globalThis as any).HTMLSelectElement = w.HTMLSelectElement;
    (globalThis as any).ShadowRoot = w.ShadowRoot;
    (globalThis as any).MouseEvent = w.MouseEvent;
    (globalThis as any).InputEvent = w.InputEvent;
    (globalThis as any).Event = w.Event;
    (globalThis as any).Node = w.Node;
    Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
    (globalThis as any).__hanzoPage = (req: any) => {
      try {
        return { ok: true, ...(req.op === 'snapshot' ? snapshot(req) : act(req)) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    };

    const cdpCalls: Array<{ method: string; params: any }> = [];
    const activeTab = { id: 7, windowId: 1, url: 'https://example.test/dashboard', title: 'Hanzo QA Page', status: 'complete', active: true };

    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: () => {},
        onMessage: { addListener: () => {}, removeListener: () => {} },
        getURL: (p: string) => `chrome-extension://test/${p}`,
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
      tabs: {
        create: async (opts: any) => ({ id: 99, url: opts?.url || 'about:blank' }),
        remove: async () => {},
        update: async (id: number, props: any) => ({ id, ...props }),
        query: async () => [activeTab],
        get: async () => activeTab,
        captureVisibleTab: async () => `data:image/png;base64,${PNG_1X1_BASE64}`,
        sendMessage: (_tabId: number, _msg: any, cb?: () => void) => cb?.(),
        onUpdated: { addListener: () => {}, removeListener: () => {} },
        onRemoved: { addListener: () => {}, removeListener: () => {} },
      },
      webNavigation: {
        getAllFrames: async () => [{ frameId: 0 }],
      },
      scripting: {
        executeScript: async ({ func, args = [] }: { func?: (...a: any[]) => any; args?: any[] }) => {
          if (typeof func !== 'function') return [{ result: null }];
          const result = await func(...args);
          return [{ result }];
        },
      },
      debugger: {
        onEvent: { addListener: () => {}, removeListener: () => {} },
        onDetach: { addListener: () => {}, removeListener: () => {} },
        attach: (_target: any, _ver: string, cb: () => void) => cb(),
        detach: (_target: any, cb: () => void) => cb(),
        sendCommand: (_target: any, method: string, params: any, cb: (res?: any) => void) => {
          cdpCalls.push({ method, params });
          if (method === 'Page.captureScreenshot') {
            cb({ data: PNG_1X1_BASE64 });
            return;
          }
          cb({});
        },
      },
    };

    const { CDPBridge } = await import('../src/browser-dispatch');
    const bridge = new CDPBridge();

    const keyHex = '0b'.repeat(32);
    let serverPort = 0;
    const assignedProviderId = 'browser/local/chrome-qa01';
    const pendingRoutes = new Map<string, (respText: string) => void>();
    let routerSocket: any;

    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => wss!.once('listening', resolve));
    serverPort = (wss.address() as AddressInfo).port;
    const pairingCode = `ws://127.0.0.1:${serverPort}/#${keyHex}`;
    const pairing = parsePairing(pairingCode)!;

    let routerNc = new Uint8Array(0);
    let routerNs = new Uint8Array(0);

    wss.on('connection', (ws) => {
      routerSocket = ws;
      ws.on('message', async (raw: Buffer) => {
        const frame: Frame = decodeFrame(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
        if (frame.t === AUTH) {
          if (frame.payload.length === 32 && routerNc.length === 0) {
            routerNc = frame.payload;
            routerNs = new Uint8Array(32).fill(5);
            const reply = new Uint8Array(64);
            reply.set(routerNs, 0);
            reply.set(await proof(pairing.key, 'zap router', routerNc, routerNs), 32);
            ws.send(encodeFrame(AUTH, '', '', reply));
            return;
          }
          expect(Array.from(frame.payload)).toEqual(Array.from(await proof(pairing.key, 'zap client', routerNc, routerNs)));
          return;
        }
        if (frame.t === HELLO) {
          ws.send(encodeFrame(WELCOME, 'zapd', assignedProviderId));
          return;
        }
        if (frame.t === PROVIDERS_LIST) {
          ws.send(encodeFrame(PROVIDERS, 'zapd', assignedProviderId, encodeProvidersList([
            { id: 'mcp/hanzo-agent-1', role: 2, brand: 'hanzo', caps: ['mcp'] },
            { id: assignedProviderId, role: 1, brand: 'hanzo', caps: ['hanzo.snapshot', 'hanzo.act', 'hanzo.click', 'hanzo.screenshot'] },
          ])));
          return;
        }
        if (frame.t === RESPONSE) {
          const resolver = pendingRoutes.get(frame.to);
          if (resolver) {
            pendingRoutes.delete(frame.to);
            resolver(new TextDecoder().decode(frame.payload));
          }
        }
      });
    });

    (globalThis as any).WebSocket = NodeWebSocket;
    const state = newZapState('browser/chrome-qa01');
    state.pairing = pairing;
    activeZapState = state;
    const logs: string[] = [];

    ensureZap(state, {
      brand: 'hanzo',
      caps: ['hanzo.snapshot', 'hanzo.act', 'hanzo.click', 'hanzo.screenshot'],
      dispatch: (method, params) => bridge.dispatchMethod(method, params),
      log: (m) => logs.push(m),
    });

    await vi.waitFor(() => expect(state.connected).toBe(true), { timeout: 5_000 });
    expect(state.authed).toBe(true);
    expect(state.providerId).toBe(assignedProviderId);
    expect(state.mcpConsumers).toBe(1);

    const callOverZap = (callerId: string, method: string, params: Record<string, string>) =>
      new Promise<string>((resolve) => {
        pendingRoutes.set(callerId, resolve);
        routerSocket.send(encodeFrame(ROUTE, callerId, assignedProviderId, encodeCmd(method, params)));
      });

    // 1) Snapshot live tab DOM and discover @ref for button
    const snapRaw = await callOverZap('mcp/call-1', 'hanzo.snapshot', { tabId: '7', interactive: 'true' });
    const snap = JSON.parse(snapRaw);
    expect(snap.tree).toContain('Launch Agent');
    const refMatch = /button "Launch Agent" \[ref=(e\d+)\]/.exec(snap.tree);
    expect(refMatch).not.toBeNull();
    const buttonRef = `@${refMatch![1]}`;

    // 2) Click @ref via hanzo.act and verify live DOM mutation
    const actRaw = await callOverZap('mcp/call-2', 'hanzo.act', { tabId: '7', op: 'click', selector: buttonRef });
    const actResult = JSON.parse(actRaw);
    expect(actResult.clicked).toContain(buttonRef);
    expect(w.document.getElementById('status')?.textContent).toBe('Clicks: 1');

    // 3) Coordinate click over ZAP string params coerces strings -> doubles for CDP
    const coordClickRaw = await callOverZap('mcp/call-3', 'hanzo.click', { tabId: '7', x: '120', y: '80' });
    expect(JSON.parse(coordClickRaw)).toEqual({ success: true });
    expect(cdpCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'Input.dispatchMouseEvent',
          params: expect.objectContaining({ type: 'mousePressed', x: 120, y: 80 }),
        }),
        expect.objectContaining({
          method: 'Input.dispatchMouseEvent',
          params: expect.objectContaining({ type: 'mouseReleased', x: 120, y: 80 }),
        }),
      ]),
    );

    // 4) Screenshot captures valid PNG payload
    const shotRaw = await callOverZap('mcp/call-4', 'hanzo.screenshot', { tabId: '7', format: 'png' });
    const shot = JSON.parse(shotRaw);
    expect(shot.data).toBe(PNG_1X1_BASE64);
    expect(Buffer.from(shot.data, 'base64').subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // 5) Malformed wire command returns structured ERR response without breaking transport
    const malformedResp = await new Promise<string>((resolve) => {
      pendingRoutes.set('mcp/call-5', resolve);
      routerSocket.send(encodeFrame(ROUTE, 'mcp/call-5', assignedProviderId, new Uint8Array([0x05, 0x00, 0x61])));
    });
    expect(malformedResp).toMatch(/^ERR:/);

    if (state.timer) clearTimeout(state.timer);
    state.socket?.close();
  });
});
