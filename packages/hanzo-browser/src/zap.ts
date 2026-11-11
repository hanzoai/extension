/**
 * Native ZAP router client for `@hanzo/browser`.
 *
 * Speaks the HIP-0069 binary ZAP router protocol over `/run/user/<uid>/zap/zapd.sock`
 * (or `ZAP_SOCK` / `HANZO_ZAP_SOCK`):
 *   u32 len · u8 type · u16 flags · u16 from_len · u16 to_len · u32 payload_len · from · to · payload
 *   HELLO=1 -> WELCOME=2 -> PROVIDERS_LIST=3 -> PROVIDERS=4 -> ROUTE=16 -> RESPONSE=17 (or ERROR=7)
 *
 * Never logs or returns cookie values, passwords, or secrets.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const HELLO = 1;
export const WELCOME = 2;
export const PROVIDERS_LIST = 3;
export const PROVIDERS = 4;
export const ERROR = 7;
export const ROUTE = 16;
export const RESPONSE = 17;
export const ROLE_PROVIDER = 1;
export const ROLE_CONSUMER = 2;

export interface ZapBrowserEntry {
  id: string;
  name: string;
  role?: number;
  brand?: string;
  caps: string[];
  attrs?: Record<string, string>;
}

export function defaultZapSocketPath(): string {
  if (process.env.ZAP_SOCK) return process.env.ZAP_SOCK;
  if (process.env.HANZO_ZAP_SOCK) return process.env.HANZO_ZAP_SOCK;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const xdg = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  const runSock = path.join(xdg, 'zap', 'zapd.sock');
  if (fs.existsSync(runSock)) return runSock;
  const homeSock = path.join(os.homedir(), '.zap', 'run', 'zapd.sock');
  if (fs.existsSync(homeSock)) return homeSock;
  return runSock;
}

const encStr16 = (s: string): Buffer => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16LE(b.length, 0);
  return Buffer.concat([len, b]);
};

const encU16 = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  return b;
};

const encU32 = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
};

export function encodeZapFrame(t: number, from: string, to: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const f = Buffer.from(from, 'utf8');
  const d = Buffer.from(to, 'utf8');
  const head = Buffer.alloc(15);
  head.writeUInt32LE(11 + f.length + d.length + payload.length, 0);
  head.writeUInt8(t, 4);
  head.writeUInt16LE(0, 5);
  head.writeUInt16LE(f.length, 7);
  head.writeUInt16LE(d.length, 9);
  head.writeUInt32LE(payload.length, 11);
  return Buffer.concat([head, f, d, payload]);
}

export function encodeZapHello(role: number, brand: string, caps: string[] = []): Buffer {
  return Buffer.concat([Buffer.from([role]), encStr16(brand), encU16(caps.length), ...caps.map(encStr16), encU16(0)]);
}

export function encodeZapCmd(method: string, params: Record<string, unknown> = {}): Buffer {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  const parts: Buffer[] = [encStr16(method), encU16(entries.length)];
  for (const [k, v] of entries) {
    const strVal = typeof v === 'string' ? v : JSON.stringify(v);
    const vb = Buffer.from(strVal, 'utf8');
    parts.push(encStr16(k), encU32(vb.length), vb);
  }
  return Buffer.concat(parts);
}

export function decodeZapProviders(payload: Buffer): ZapBrowserEntry[] {
  const out: ZapBrowserEntry[] = [];
  if (payload.length < 2) return out;
  let o = 0;
  const readStr = (): string => {
    if (o + 2 > payload.length) return '';
    const n = payload.readUInt16LE(o);
    o += 2;
    const s = payload.subarray(o, o + n).toString('utf8');
    o += n;
    return s;
  };
  const count = payload.readUInt16LE(o);
  o += 2;
  for (let i = 0; i < count; i++) {
    if (o >= payload.length) break;
    const id = readStr();
    if (o >= payload.length) break;
    const role = payload.readUInt8(o);
    o += 1;
    const brand = readStr();
    if (o + 2 > payload.length) break;
    const nc = payload.readUInt16LE(o);
    o += 2;
    const caps: string[] = [];
    for (let c = 0; c < nc; c++) caps.push(readStr());
    const attrs: Record<string, string> = {};
    if (o + 2 <= payload.length) {
      const na = payload.readUInt16LE(o);
      o += 2;
      for (let j = 0; j < na; j++) {
        const k = readStr();
        attrs[k] = readStr();
      }
    }
    if (id) out.push({ id, name: brand || id, role, brand, caps, attrs });
  }
  return out;
}

export class ZapTransport {
  public readonly socketPath: string;

  constructor(socketPath = defaultZapSocketPath()) {
    this.socketPath = socketPath;
  }

  isSocketPresent(): boolean {
    return fs.existsSync(this.socketPath);
  }

  async listBrowsers(timeoutMs = 5000): Promise<ZapBrowserEntry[]> {
    if (!fs.existsSync(this.socketPath)) {
      throw new Error(`ZAP socket not found at ${this.socketPath}`);
    }
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      let buf = Buffer.alloc(0);
      let myId = `agent/hanzo-${Math.random().toString(16).slice(2, 8)}`;
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`ZAP listBrowsers timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      sock.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      sock.once('connect', () => {
        sock.write(encodeZapFrame(HELLO, myId, '', encodeZapHello(ROLE_CONSUMER, 'hanzo-browser', [])));
      });

      sock.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
          const frameLen = buf.readUInt32LE(0);
          if (buf.length < 4 + frameLen) break;
          const raw = buf.subarray(0, 4 + frameLen);
          buf = buf.subarray(4 + frameLen);
          const t = raw.readUInt8(4);
          const fl = raw.readUInt16LE(7);
          const tl = raw.readUInt16LE(9);
          const pl = raw.readUInt32LE(11);
          const to = raw.subarray(15 + fl, 15 + fl + tl).toString('utf8');
          const payload = raw.subarray(15 + fl + tl, 15 + fl + tl + pl);

          if (t === WELCOME) {
            myId = to || myId;
            sock.write(encodeZapFrame(PROVIDERS_LIST, myId, ''));
          } else if (t === PROVIDERS) {
            clearTimeout(timer);
            sock.destroy();
            const all = decodeZapProviders(payload);
            resolve(all.filter((p) => p.id.startsWith('browser/')));
            return;
          } else if (t === ERROR) {
            clearTimeout(timer);
            sock.destroy();
            reject(new Error(payload.toString('utf8') || 'ZAP router error'));
            return;
          }
        }
      });
    });
  }

  async resolveProvider(filter?: string, clientId?: string): Promise<string | null> {
    const explicit = clientId || process.env.HANZO_ZAP_PROVIDER;
    if (!this.isSocketPresent()) return null;
    try {
      const list = await this.listBrowsers();
      if (list.length === 0) return null;
      if (explicit) {
        const exact = list.find((b) => b.id === explicit);
        return exact?.id ?? null;
      }
      if (filter) {
        const want = filter.toLowerCase();
        const match = list.find((b) => b.name.toLowerCase().includes(want) || b.id.toLowerCase().includes(want));
        return match?.id ?? null;
      }
      return list[0].id;
    } catch {
      return null;
    }
  }

  async call<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    opts: { provider?: string; filter?: string; timeoutMs?: number } = {},
  ): Promise<T> {
    if (!fs.existsSync(this.socketPath)) {
      throw new Error(`ZAP socket not found at ${this.socketPath}`);
    }
    const timeoutMs = opts.timeoutMs ?? 25_000;
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      let buf = Buffer.alloc(0);
      let myId = `agent/hanzo-${Math.random().toString(16).slice(2, 8)}`;
      const explicitProvider = opts.provider || process.env.HANZO_ZAP_PROVIDER || '';
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`ZAP request timeout (${timeoutMs}ms) on ${method}`));
      }, timeoutMs);

      sock.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      sock.once('connect', () => {
        sock.write(encodeZapFrame(HELLO, myId, '', encodeZapHello(ROLE_CONSUMER, 'hanzo-browser', [])));
      });

      sock.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
          const frameLen = buf.readUInt32LE(0);
          if (buf.length < 4 + frameLen) break;
          const raw = buf.subarray(0, 4 + frameLen);
          buf = buf.subarray(4 + frameLen);
          const t = raw.readUInt8(4);
          const fl = raw.readUInt16LE(7);
          const tl = raw.readUInt16LE(9);
          const pl = raw.readUInt32LE(11);
          const to = raw.subarray(15 + fl, 15 + fl + tl).toString('utf8');
          const payload = raw.subarray(15 + fl + tl, 15 + fl + tl + pl);

          if (t === WELCOME) {
            myId = to || myId;
            if (explicitProvider) {
              sock.write(encodeZapFrame(ROUTE, myId, explicitProvider, encodeZapCmd(method, params)));
            } else {
              sock.write(encodeZapFrame(PROVIDERS_LIST, myId, ''));
            }
          } else if (t === PROVIDERS) {
            const browsers = decodeZapProviders(payload).filter((p) => p.id.startsWith('browser/'));
            const chosen = opts.filter
              ? browsers.find((b) => b.name.toLowerCase().includes(opts.filter!.toLowerCase()) || b.id.toLowerCase().includes(opts.filter!.toLowerCase()))
              : browsers[0];
            if (!chosen) {
              clearTimeout(timer);
              sock.destroy();
              reject(new Error('No browser extension connected on ZAP router'));
              return;
            }
            sock.write(encodeZapFrame(ROUTE, myId, chosen.id, encodeZapCmd(method, params)));
          } else if (t === RESPONSE) {
            clearTimeout(timer);
            sock.destroy();
            const text = payload.toString('utf8');
            if (text.startsWith('ERR:')) {
              reject(new Error(text.slice(4)));
              return;
            }
            try {
              const parsed = JSON.parse(text);
              if (parsed && typeof parsed === 'object' && parsed.ok === false && typeof parsed.error === 'string') {
                reject(new Error(parsed.error));
                return;
              }
              resolve((parsed?.result !== undefined && parsed?.ok === true ? parsed.result : parsed) as T);
            } catch {
              resolve(text as unknown as T);
            }
            return;
          } else if (t === ERROR) {
            clearTimeout(timer);
            sock.destroy();
            reject(new Error(payload.toString('utf8') || `ZAP error on ${method}`));
            return;
          }
        }
      });
    });
  }
}

export async function callZap<T = any>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { socketPath?: string; provider?: string; filter?: string; timeoutMs?: number } = {},
): Promise<T> {
  const zap = new ZapTransport(opts.socketPath);
  return zap.call<T>(method, params, opts);
}

// ── Social Session Discovery with Automatic `hanzo.getCookies` Fallback ───────

export interface SocialCookieRule {
  provider: string;
  domains: string[];
  cookieNames: string[];
}

export const SOCIAL_COOKIE_RULES: SocialCookieRule[] = [
  { provider: 'x', domains: ['x.com', 'twitter.com'], cookieNames: ['auth_token', 'twid'] },
  { provider: 'linkedin', domains: ['linkedin.com'], cookieNames: ['li_at'] },
  { provider: 'reddit', domains: ['reddit.com'], cookieNames: ['reddit_session', 'token_v2'] },
  { provider: 'facebook', domains: ['facebook.com'], cookieNames: ['c_user', 'xs'] },
  { provider: 'instagram', domains: ['instagram.com'], cookieNames: ['sessionid', 'ds_user_id'] },
  { provider: 'threads', domains: ['threads.net', 'threads.com'], cookieNames: ['sessionid', 'ds_user_id'] },
  { provider: 'youtube', domains: ['youtube.com'], cookieNames: ['SAPISID', '__Secure-3PAPISID', 'SID'] },
  { provider: 'tiktok', domains: ['tiktok.com'], cookieNames: ['sessionid', 'sid_tt'] },
  { provider: 'bluesky', domains: ['bsky.app'], cookieNames: ['bsky_storage'] },
  { provider: 'mastodon', domains: ['mastodon.social'], cookieNames: ['_mastodon_session'] },
  { provider: 'github', domains: ['github.com'], cookieNames: ['user_session', '__Host-user_session_same_site'] },
  { provider: 'discord', domains: ['discord.com'], cookieNames: ['__dcfduid'] },
  { provider: 'hn', domains: ['news.ycombinator.com'], cookieNames: ['user'] },
  { provider: 'medium', domains: ['medium.com'], cookieNames: ['uid', 'sid'] },
  { provider: 'devto', domains: ['dev.to'], cookieNames: ['remember_user_token'] },
  { provider: 'lastpass', domains: ['lastpass.com'], cookieNames: ['PHPSESSID', 'LPB64', 'lp_session'] },
  { provider: 'hanzo', domains: ['hanzo.ai', 'hanzo.id'], cookieNames: ['hanzo_session', 'casdoor_session_id', 'access-token'] },
];

export interface DetectedSession {
  provider: string;
  loggedIn: boolean;
  domains: string[];
  cookieNames: string[];
}

/**
 * Matches cookies by domain + cookie NAME only. Cookie values are NEVER read, stored, or returned.
 */
export function matchSocialSessionsFromCookies(
  cookies: Array<{ name?: string; domain?: string }>,
): DetectedSession[] {
  const out: DetectedSession[] = [];
  for (const rule of SOCIAL_COOKIE_RULES) {
    const matchedNames = new Set<string>();
    const matchedDomains = new Set<string>();
    for (const c of cookies) {
      const name = String(c?.name || '');
      const dom = String(c?.domain || '').replace(/^\./, '').toLowerCase();
      if (!name || !dom) continue;
      const domainOk = rule.domains.some((d) => dom === d || dom.endsWith(`.${d}`));
      if (!domainOk) continue;
      if (rule.cookieNames.includes(name)) {
        matchedNames.add(name);
        matchedDomains.add(dom);
      }
    }
    out.push({
      provider: rule.provider,
      loggedIn: matchedNames.size > 0,
      domains: Array.from(matchedDomains),
      cookieNames: Array.from(matchedNames),
    });
  }
  return out;
}

/**
 * Queries connected social/app sessions via ZAP `social.sessions`, automatically
 * falling back to `hanzo.getCookies` / `Network.getAllCookies` when talking to
 * an extension instance that has not been reloaded yet. Never returns cookie values.
 */
export async function getSessionsViaZap(
  zap = new ZapTransport(),
  opts: { provider?: string; filter?: string } = {},
): Promise<{ source: 'social.sessions' | 'getCookies-fallback'; sessions: any[] }> {
  try {
    const direct = await zap.call<any>('social.sessions', {}, opts);
    if (direct && (Array.isArray(direct.sessions) || Array.isArray(direct))) {
      return {
        source: 'social.sessions',
        sessions: Array.isArray(direct.sessions) ? direct.sessions : direct,
      };
    }
  } catch {
    // Extension may predate `social.sessions`; fall back to cookie-name inspection.
  }

  let rawCookies: Array<{ name?: string; domain?: string }> = [];
  try {
    const res = await zap.call<any>('hanzo.getCookies', {}, opts);
    rawCookies = Array.isArray(res?.cookies) ? res.cookies : Array.isArray(res) ? res : [];
  } catch {
    const res = await zap.call<any>('Network.getAllCookies', {}, opts);
    rawCookies = Array.isArray(res?.cookies) ? res.cookies : Array.isArray(res) ? res : [];
  }

  // Sanitize immediately to { name, domain } only — never retain values
  const sanitized = rawCookies.map((c) => ({
    name: typeof c?.name === 'string' ? c.name : '',
    domain: typeof c?.domain === 'string' ? c.domain : '',
  }));
  return {
    source: 'getCookies-fallback',
    sessions: matchSocialSessionsFromCookies(sanitized),
  };
}
