import { describe, it, expect } from 'vitest';
import {
  authorizeUrl,
  tokenUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  tokenExpiresAt,
  isExpired,
} from '../src/imanage-oauth.js';

describe('oauth: authorizeUrl', () => {
  it('builds the control-center consent URL with the standard params', () => {
    const url = new URL(
      authorizeUrl({
        host: 'cloudimanage.com',
        clientId: 'cid',
        redirectUri: 'https://imanage.hanzo.ai/oauth/callback',
        state: 'st-1',
      }),
    );
    expect(url.origin).toBe('https://cloudimanage.com');
    expect(url.pathname).toBe('/auth/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://imanage.hanzo.ai/oauth/callback');
    expect(url.searchParams.get('state')).toBe('st-1');
  });

  it('normalizes a bare host and omits scope when empty', () => {
    const url = new URL(
      authorizeUrl({ host: 'work.firm.com', clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: [] }),
    );
    expect(url.origin).toBe('https://work.firm.com');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('space-joins scopes when present', () => {
    const url = new URL(
      authorizeUrl({ host: 'cloudimanage.com', clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: ['user', 'admin'] }),
    );
    expect(url.searchParams.get('scope')).toBe('user admin');
  });
});

describe('oauth: token endpoints', () => {
  it('resolves the token URL on the control-center host', () => {
    expect(tokenUrl('cloudimanage.com')).toBe('https://cloudimanage.com/auth/oauth2/token');
    expect(tokenUrl('https://work.firm.com/')).toBe('https://work.firm.com/auth/oauth2/token');
  });
});

describe('oauth: tokenExchange', () => {
  it('form-encodes the code grant with client credentials + redirect_uri in the body', () => {
    const req = tokenExchange({
      host: 'cloudimanage.com',
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'the-code',
      redirectUri: 'https://imanage.hanzo.ai/oauth/callback',
    });
    expect(req.url).toBe('https://cloudimanage.com/auth/oauth2/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
    expect(body.get('redirect_uri')).toBe('https://imanage.hanzo.ai/oauth/callback');
  });

  it('never puts the secret in the URL', () => {
    const req = tokenExchange({ host: 'cloudimanage.com', clientId: 'c', clientSecret: 'SUPER', code: 'x', redirectUri: 'https://x/cb' });
    expect(req.url).not.toContain('SUPER');
  });
});

describe('oauth: refreshExchange', () => {
  it('form-encodes the refresh grant with client credentials', () => {
    const req = refreshExchange({ host: 'cloudimanage.com', clientId: 'cid', clientSecret: 'sec', refreshToken: 'r-1' });
    expect(req.url).toBe('https://cloudimanage.com/auth/oauth2/token');
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
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'user',
    });
    expect(t.access_token).toBe('at');
    expect(t.refresh_token).toBe('rt');
    expect(t.expires_in).toBe(3600);
    expect(t.token_type).toBe('Bearer');
    expect(t.scope).toBe('user');
  });

  it('throws on an iManage error payload with the description', () => {
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

describe('oauth: expiry math (minted-at based — iManage sends no issued-at)', () => {
  it('computes expiry from mintedAt + expires_in minus skew', () => {
    const t = { access_token: 'a', expires_in: 3600 };
    expect(tokenExpiresAt(t, 1000, 60)).toBe(1000 + 3600 - 60);
  });

  it('treats a token with no expires_in as already at expiry (minus skew)', () => {
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
