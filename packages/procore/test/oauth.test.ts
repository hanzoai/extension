import { describe, it, expect } from 'vitest';
import {
  authorizeUrl,
  tokenUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  tokenExpiresAt,
  isExpired,
} from '../src/procore-oauth.js';

describe('oauth: authorizeUrl', () => {
  it('builds the sandbox consent URL with the standard params', () => {
    const url = new URL(
      authorizeUrl({
        env: 'sandbox',
        clientId: 'cid',
        redirectUri: 'https://procore.hanzo.ai/oauth/callback',
        state: 'st-1',
      }),
    );
    expect(url.origin).toBe('https://login-sandbox.procore.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://procore.hanzo.ai/oauth/callback');
    expect(url.searchParams.get('state')).toBe('st-1');
  });

  it('uses the production login host and omits scope when empty', () => {
    const url = new URL(
      authorizeUrl({ env: 'production', clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: [] }),
    );
    expect(url.origin).toBe('https://login.procore.com');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('space-joins scopes when present', () => {
    const url = new URL(
      authorizeUrl({ env: 'sandbox', clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: ['a', 'b'] }),
    );
    expect(url.searchParams.get('scope')).toBe('a b');
  });
});

describe('oauth: token endpoints', () => {
  it('resolves the token URL per environment', () => {
    expect(tokenUrl('sandbox')).toBe('https://login-sandbox.procore.com/oauth/token');
    expect(tokenUrl('production')).toBe('https://login.procore.com/oauth/token');
  });
});

describe('oauth: tokenExchange', () => {
  it('form-encodes the code grant with client credentials + redirect_uri in the body', () => {
    const req = tokenExchange({
      env: 'sandbox',
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'the-code',
      redirectUri: 'https://procore.hanzo.ai/oauth/callback',
    });
    expect(req.url).toBe('https://login-sandbox.procore.com/oauth/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
    expect(body.get('redirect_uri')).toBe('https://procore.hanzo.ai/oauth/callback');
  });

  it('never puts the secret in the URL', () => {
    const req = tokenExchange({ env: 'production', clientId: 'c', clientSecret: 'SUPER', code: 'x', redirectUri: 'https://x/cb' });
    expect(req.url).not.toContain('SUPER');
  });
});

describe('oauth: refreshExchange', () => {
  it('form-encodes the refresh grant with client credentials', () => {
    const req = refreshExchange({ env: 'sandbox', clientId: 'cid', clientSecret: 'sec', refreshToken: 'r-1' });
    expect(req.url).toBe('https://login-sandbox.procore.com/oauth/token');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r-1');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
    expect(body.has('code')).toBe(false);
  });
});

describe('oauth: parseTokenResponse', () => {
  it('parses a full token set', () => {
    const t = parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 7200,
      created_at: 1000,
      token_type: 'Bearer',
    });
    expect(t.access_token).toBe('at');
    expect(t.refresh_token).toBe('rt');
    expect(t.expires_in).toBe(7200);
    expect(t.created_at).toBe(1000);
  });

  it('throws on a Procore error payload with the description', () => {
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
  });
});

describe('oauth: expiry math', () => {
  it('computes expiry from created_at + expires_in minus skew', () => {
    const t = { access_token: 'a', created_at: 1000, expires_in: 7200 };
    expect(tokenExpiresAt(t, 1000, 60)).toBe(1000 + 7200 - 60);
  });

  it('falls back to now when created_at is absent', () => {
    const t = { access_token: 'a', expires_in: 100 };
    expect(tokenExpiresAt(t, 5000, 0)).toBe(5000 + 100);
  });

  it('reports not-expired before, expired at/after the skewed boundary', () => {
    const t = { access_token: 'a', created_at: 1000, expires_in: 7200 };
    const boundary = 1000 + 7200 - 60;
    expect(isExpired(t, boundary - 1, 60)).toBe(false);
    expect(isExpired(t, boundary, 60)).toBe(true);
    expect(isExpired(t, boundary + 100, 60)).toBe(true);
  });
});
