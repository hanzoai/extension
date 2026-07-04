import { describe, it, expect } from 'vitest';
import {
  authorizeUrl,
  tokenUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  carryRefreshToken,
  tokenExpiresAt,
  isExpired,
} from '../src/canvas-oauth.js';

const HOST = 'school.instructure.com';

describe('oauth: authorizeUrl', () => {
  it('builds the consent URL with the standard Canvas params', () => {
    const url = new URL(
      authorizeUrl({
        host: HOST,
        clientId: 'cid',
        redirectUri: 'https://canvas.hanzo.ai/oauth/callback',
        state: 'st-1',
      }),
    );
    expect(url.origin).toBe('https://school.instructure.com');
    expect(url.pathname).toBe('/login/oauth2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://canvas.hanzo.ai/oauth/callback');
    expect(url.searchParams.get('state')).toBe('st-1');
  });

  it('omits scope when empty and normalizes a host with a scheme', () => {
    const url = new URL(
      authorizeUrl({ host: 'https://school.instructure.com/', clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: [] }),
    );
    expect(url.origin).toBe('https://school.instructure.com');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('space-joins scopes when present', () => {
    const url = new URL(
      authorizeUrl({
        host: HOST,
        clientId: 'c',
        redirectUri: 'https://x/cb',
        state: 's',
        scopes: ['url:GET|/api/v1/courses', 'url:GET|/api/v1/courses/:id'],
      }),
    );
    expect(url.searchParams.get('scope')).toBe('url:GET|/api/v1/courses url:GET|/api/v1/courses/:id');
  });
});

describe('oauth: token endpoints', () => {
  it('resolves the token URL per host', () => {
    expect(tokenUrl(HOST)).toBe('https://school.instructure.com/login/oauth2/token');
    expect(tokenUrl('canvas.school.edu')).toBe('https://canvas.school.edu/login/oauth2/token');
  });
});

describe('oauth: tokenExchange', () => {
  it('form-encodes the code grant with client credentials + redirect_uri in the body', () => {
    const req = tokenExchange({
      host: HOST,
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'the-code',
      redirectUri: 'https://canvas.hanzo.ai/oauth/callback',
    });
    expect(req.url).toBe('https://school.instructure.com/login/oauth2/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
    expect(body.get('redirect_uri')).toBe('https://canvas.hanzo.ai/oauth/callback');
  });

  it('never puts the secret in the URL', () => {
    const req = tokenExchange({ host: HOST, clientId: 'c', clientSecret: 'SUPER', code: 'x', redirectUri: 'https://x/cb' });
    expect(req.url).not.toContain('SUPER');
  });
});

describe('oauth: refreshExchange', () => {
  it('form-encodes the refresh grant with client credentials and no redirect_uri', () => {
    const req = refreshExchange({ host: HOST, clientId: 'cid', clientSecret: 'sec', refreshToken: 'r-1' });
    expect(req.url).toBe('https://school.instructure.com/login/oauth2/token');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r-1');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
    expect(body.has('code')).toBe(false);
    expect(body.has('redirect_uri')).toBe(false);
  });
});

describe('oauth: parseTokenResponse', () => {
  it('parses a full token set including the Canvas user', () => {
    const t = parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
      user: { id: 7, name: 'Prof. Ada' },
    });
    expect(t.access_token).toBe('at');
    expect(t.refresh_token).toBe('rt');
    expect(t.expires_in).toBe(3600);
    expect(t.user).toEqual({ id: 7, name: 'Prof. Ada' });
  });

  it('throws on a Canvas error payload with the description', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant', error_description: 'code used' })).toThrow(/code used/);
  });

  it('throws when access_token is missing or empty', () => {
    expect(() => parseTokenResponse({})).toThrow(/missing access_token/);
    expect(() => parseTokenResponse({ access_token: '' })).toThrow(/missing access_token/);
    expect(() => parseTokenResponse(null)).toThrow(/empty token response/);
  });

  it('drops non-string/non-number optional fields defensively', () => {
    const t = parseTokenResponse({ access_token: 'at', refresh_token: 123, expires_in: 'soon' });
    expect(t.refresh_token).toBeUndefined();
    expect(t.expires_in).toBeUndefined();
    expect(t.user).toBeUndefined();
  });
});

describe('oauth: carryRefreshToken (Canvas does not rotate)', () => {
  it('keeps the previous refresh token when the refresh response omits it', () => {
    const prev = { access_token: 'a0', refresh_token: 'rt-keep' };
    const next = { access_token: 'a1' };
    expect(carryRefreshToken(next, prev).refresh_token).toBe('rt-keep');
  });
  it('uses a new refresh token if one is returned', () => {
    const prev = { access_token: 'a0', refresh_token: 'old' };
    const next = { access_token: 'a1', refresh_token: 'new' };
    expect(carryRefreshToken(next, prev).refresh_token).toBe('new');
  });
});

describe('oauth: expiry math', () => {
  it('computes expiry from mintedAt + expires_in minus skew', () => {
    const t = { access_token: 'a', expires_in: 3600 };
    expect(tokenExpiresAt(t, 1000, 60)).toBe(1000 + 3600 - 60);
  });

  it('treats a token with no expires_in as immediately (skew-)expired', () => {
    const t = { access_token: 'a' };
    expect(tokenExpiresAt(t, 5000, 0)).toBe(5000);
  });

  it('reports not-expired before, expired at/after the skewed boundary', () => {
    const t = { access_token: 'a', expires_in: 3600 };
    const minted = 1000;
    const boundary = minted + 3600 - 60;
    expect(isExpired(t, minted, boundary - 1, 60)).toBe(false);
    expect(isExpired(t, minted, boundary, 60)).toBe(true);
    expect(isExpired(t, minted, boundary + 100, 60)).toBe(true);
  });
});
