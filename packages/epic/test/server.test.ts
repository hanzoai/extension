import { describe, it, expect, vi } from 'vitest';
import {
  readServerConfig,
  memoryStore,
  discoverSmart,
  exchangeCode,
  ensureFreshToken,
  resolveProxyTarget,
  readSid,
  type ServerConfig,
} from '../src/server.js';
import type { SmartContext } from '../src/smart-oauth.js';

function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CFG: ServerConfig = {
  clientId: 'my-client',
  clientSecret: 'shh',
  redirectUri: 'https://epic.hanzo.ai/oauth/callback',
  sessionTtlMs: 3_600_000,
  port: 8791,
};

const BASE = 'https://fhir.example.org/r4';

describe('readServerConfig', () => {
  it('requires client id + redirect, secret optional', () => {
    const cfg = readServerConfig({
      SMART_CLIENT_ID: 'id',
      SMART_REDIRECT_URI: 'https://x/cb',
    });
    expect(cfg.clientId).toBe('id');
    expect(cfg.clientSecret).toBe(''); // public app
    expect(cfg.port).toBe(8791);
  });
  it('reads the confidential secret when present', () => {
    const cfg = readServerConfig({
      SMART_CLIENT_ID: 'id',
      SMART_REDIRECT_URI: 'https://x/cb',
      SMART_CLIENT_SECRET: 's',
      PORT: '9000',
      SESSION_TTL_SECONDS: '600',
    });
    expect(cfg.clientSecret).toBe('s');
    expect(cfg.port).toBe(9000);
    expect(cfg.sessionTtlMs).toBe(600_000);
  });
  it('throws listing every missing required var', () => {
    expect(() => readServerConfig({})).toThrow(/SMART_CLIENT_ID.*SMART_REDIRECT_URI/);
  });
});

describe('discoverSmart', () => {
  it('fetches the well-known and returns the endpoints', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      res(200, { authorization_endpoint: `${BASE}/auth`, token_endpoint: `${BASE}/token` }),
    );
    const cfg = await discoverSmart(BASE, doFetch);
    expect(cfg.authorizationEndpoint).toBe(`${BASE}/auth`);
    expect(doFetch.mock.calls[0][0]).toBe(`${BASE}/.well-known/smart-configuration`);
  });

  it('rejects a non-http(s) iss (SSRF guard)', async () => {
    await expect(discoverSmart('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(discoverSmart('not-a-url')).rejects.toThrow(/valid URL/);
  });

  it('surfaces a discovery failure', async () => {
    const doFetch = vi.fn().mockResolvedValue(res(404, {}));
    await expect(discoverSmart(BASE, doFetch)).rejects.toThrow(/discovery 404/);
  });
});

describe('exchangeCode (server-side secret + PKCE)', () => {
  it('POSTs the exchange and parses the SMART context', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      res(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, patient: 'P-1', scope: 's' }),
    );
    const pending = { state: 'st', codeVerifier: 'ver', tokenEndpoint: `${BASE}/token`, fhirBase: BASE };
    const ctx = await exchangeCode(CFG, pending, 'the-code', doFetch);
    expect(ctx.accessToken).toBe('AT');
    expect(ctx.patient).toBe('P-1');
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/token`);
    const body = new URLSearchParams(init.body);
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('client_secret')).toBe('shh'); // confidential
  });

  it('surfaces an OAuth error from the token endpoint', async () => {
    const doFetch = vi.fn().mockResolvedValue(res(400, { error: 'invalid_grant', error_description: 'bad code' }));
    const pending = { state: 'st', codeVerifier: 'ver', tokenEndpoint: `${BASE}/token`, fhirBase: BASE };
    await expect(exchangeCode(CFG, pending, 'x', doFetch)).rejects.toThrow(/bad code/);
  });
});

describe('ensureFreshToken', () => {
  const base = (expiresAt: number, refresh = 'RT'): SmartContext => ({
    accessToken: 'OLD',
    refreshToken: refresh,
    tokenType: 'Bearer',
    expiresAt,
    patient: 'P-1',
    encounter: '',
    scope: 's',
    idToken: '',
    fhirBase: '',
  });

  it('returns the live token when not near expiry', async () => {
    const store = memoryStore();
    const sess = { ctx: base(Date.now() + 3_600_000), fhirBase: BASE, tokenEndpoint: `${BASE}/token` };
    const doFetch = vi.fn();
    expect(await ensureFreshToken(CFG, store, 'sid', sess, doFetch)).toBe('OLD');
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and keeps the old refresh_token/patient', async () => {
    const store = memoryStore();
    store.putSession('sid', base(0), BASE, `${BASE}/token`);
    const sess = store.getSession('sid')!;
    const doFetch = vi.fn().mockResolvedValue(res(200, { access_token: 'NEW', expires_in: 3600 }));
    const token = await ensureFreshToken(CFG, store, 'sid', sess, doFetch);
    expect(token).toBe('NEW');
    const updated = store.getSession('sid')!;
    expect(updated.ctx.accessToken).toBe('NEW');
    expect(updated.ctx.refreshToken).toBe('RT'); // preserved
    expect(updated.ctx.patient).toBe('P-1'); // preserved
  });

  it('does not refresh when there is no refresh_token', async () => {
    const store = memoryStore();
    const sess = { ctx: base(0, ''), fhirBase: BASE, tokenEndpoint: `${BASE}/token` };
    const doFetch = vi.fn();
    expect(await ensureFreshToken(CFG, store, 'sid', sess, doFetch)).toBe('OLD');
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe('resolveProxyTarget (the PHI proxy guard)', () => {
  it('resolves a relative allowed resource under the session base', () => {
    expect(resolveProxyTarget(BASE, `Condition?patient=P-1&_count=50`)).toBe(
      `${BASE}/Condition?patient=P-1&_count=50`,
    );
    expect(resolveProxyTarget(BASE, 'Patient/P-1')).toBe(`${BASE}/Patient/P-1`);
  });

  it('accepts an absolute next-page URL under the same base', () => {
    const next = `${BASE}/Observation?patient=P-1&_getpages=abc`;
    expect(resolveProxyTarget(BASE, next)).toBe(next);
  });

  it('refuses a resource type outside the read scopes', () => {
    expect(() => resolveProxyTarget(BASE, 'Appointment?patient=P-1')).toThrow(/not permitted/);
    expect(() => resolveProxyTarget(BASE, 'metadata')).toThrow(/not permitted/);
  });

  it('refuses a path that escapes the session FHIR base (SSRF / cross-tenant)', () => {
    expect(() => resolveProxyTarget(BASE, 'https://evil.example.com/Condition')).toThrow(/escapes/);
    expect(() => resolveProxyTarget(BASE, 'https://fhir.example.org/OTHER/Condition')).toThrow(/escapes/);
  });

  it('refuses a malformed path', () => {
    expect(() => resolveProxyTarget(BASE, 'http://')).toThrow();
  });
});

describe('session store + cookie', () => {
  it('takePending is single-use (defends against state replay)', () => {
    const store = memoryStore();
    store.putPending({ state: 'st', codeVerifier: 'v', tokenEndpoint: 't', fhirBase: BASE });
    expect(store.takePending('st')).toBeDefined();
    expect(store.takePending('st')).toBeUndefined(); // replay yields nothing
  });

  it('readSid extracts the opaque session id from the cookie header', () => {
    expect(readSid('foo=bar; epic_sid=abc123; baz=qux')).toBe('abc123');
    expect(readSid('epic_sid=only')).toBe('only');
    expect(readSid(undefined)).toBe('');
    expect(readSid('no_session_here=1')).toBe('');
  });
});
