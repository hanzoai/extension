import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAuthorizeURL, normalizeTokens, exchangeCode, refreshTokens, parseCallback, fetchUserInfo,
} from '../src/oauth';
import { challengeFromVerifier } from '../src/pkce';

describe('buildAuthorizeURL', () => {
  it('is the HIP-0111 authorize URL with PKCE S256', () => {
    const u = new URL(buildAuthorizeURL({
      clientId: 'hanzo-office', redirectUri: 'https://office.hanzo.ai/auth-callback.html',
      challenge: 'CHAL', state: 'STATE',
    }));
    expect(u.origin + u.pathname).toBe('https://hanzo.id/v1/iam/oauth/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('hanzo-office');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe('CHAL');
    expect(u.searchParams.get('state')).toBe('STATE');
  });
});

describe('normalizeTokens', () => {
  it('turns expires_in into an absolute expiresAt', () => {
    const t = normalizeTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, 1_000_000);
    expect(t.accessToken).toBe('a');
    expect(t.refreshToken).toBe('r');
    expect(t.expiresAt).toBe(1_000_000 + 3600_000);
  });
  it('throws without an access_token', () => {
    expect(() => normalizeTokens({})).toThrow(/access_token/);
  });
});

describe('parseCallback', () => {
  it('extracts code/state/error from a redirect URL', () => {
    expect(parseCallback('https://x/cb?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz', error: undefined });
    expect(parseCallback('https://x/cb?error=access_denied').error).toBe('access_denied');
  });
});

describe('exchangeCode + refreshTokens (form-encoded, HIP-0111)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs form-urlencoded to the /v1/iam token URL and normalizes', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://iam.hanzo.ai/v1/iam/oauth/token');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(init.body.toString());
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code_verifier')).toBe('ver');
      return { ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 60 }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const t = await exchangeCode({ clientId: 'hanzo-vscode', code: 'c', verifier: 'ver', redirectUri: 'https://hanzo.ai/callback' });
    expect(t.accessToken).toBe('AT');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refresh reuses the old refresh_token when IAM does not rotate it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', expires_in: 60 }) } as any)));
    const t = await refreshTokens({ clientId: 'hanzo-cli', refreshToken: 'OLD' });
    expect(t.accessToken).toBe('AT2');
    expect(t.refreshToken).toBe('OLD');
  });

  it('surfaces a failed exchange', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' } as any)));
    await expect(exchangeCode({ clientId: 'x', code: 'c', verifier: 'v', redirectUri: 'r' })).rejects.toThrow(/400/);
  });

  it('userinfo reads sub/email/org', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://iam.hanzo.ai/v1/iam/oauth/userinfo');
      expect(init.headers.Authorization).toBe('Bearer AT');
      return { ok: true, json: async () => ({ sub: 'u1', email: 'z@hanzo.ai', owner: 'acme' }) } as any;
    }));
    const u = await fetchUserInfo('AT');
    expect(u).toEqual({ sub: 'u1', name: undefined, email: 'z@hanzo.ai', org: 'acme', picture: undefined });
  });
});

describe('PKCE round-trips with the S256 challenge', () => {
  it('RFC 7636 test vector', async () => {
    expect(await challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
