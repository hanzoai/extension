import { describe, it, expect } from 'vitest';
import {
  oauthAuthorizeUrl,
  tokenExchange,
  tokenRefresh,
  parseTokenResponse,
  isExpired,
} from '../src/clio-oauth';
import { clioBase } from '../src/config';

const base = clioBase('us');

describe('oauthAuthorizeUrl', () => {
  it('builds the authorize URL with all required params', () => {
    const url = oauthAuthorizeUrl({
      base,
      clientId: 'CID',
      redirectUri: 'https://clio.hanzo.ai/oauth/callback',
      state: 'st4te',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://app.clio.com/oauth/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('https://clio.hanzo.ai/oauth/callback');
    expect(u.searchParams.get('state')).toBe('st4te');
    expect(u.searchParams.get('scope')).toBe('read write');
    // offline access default → refresh token
    expect(u.searchParams.get('access_type')).toBe('offline');
  });

  it('honors a custom scope and can disable offline access', () => {
    const url = oauthAuthorizeUrl({
      base,
      clientId: 'CID',
      redirectUri: 'https://x/cb',
      state: 's',
      scope: 'read',
      offlineAccess: false,
    });
    const u = new URL(url);
    expect(u.searchParams.get('scope')).toBe('read');
    expect(u.searchParams.has('access_type')).toBe(false);
  });

  it('targets the eu authorize host when built from the eu base', () => {
    const url = oauthAuthorizeUrl({ base: clioBase('eu'), clientId: 'C', redirectUri: 'https://x/cb', state: 's' });
    expect(url.startsWith('https://eu.app.clio.com/oauth/authorize?')).toBe(true);
  });
});

describe('tokenExchange', () => {
  it('shapes an authorization_code POST as urlencoded form', () => {
    const req = tokenExchange({
      base,
      clientId: 'CID',
      clientSecret: 'SECRET',
      redirectUri: 'https://x/cb',
      code: 'auth-code',
    });
    expect(req.url).toBe('https://app.clio.com/oauth/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.headers.Accept).toBe('application/json');
    const form = new URLSearchParams(req.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code');
    expect(form.get('client_id')).toBe('CID');
    expect(form.get('client_secret')).toBe('SECRET');
    expect(form.get('redirect_uri')).toBe('https://x/cb');
  });
});

describe('tokenRefresh', () => {
  it('shapes a refresh_token POST', () => {
    const req = tokenRefresh({ base, clientId: 'CID', clientSecret: 'SECRET', refreshToken: 'r3fresh' });
    expect(req.url).toBe('https://app.clio.com/oauth/token');
    const form = new URLSearchParams(req.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('r3fresh');
    expect(form.get('client_id')).toBe('CID');
    expect(form.get('client_secret')).toBe('SECRET');
  });
});

describe('parseTokenResponse', () => {
  it('computes an absolute expiry from expires_in against injected now', () => {
    const now = 1_000_000;
    const t = parseTokenResponse(
      { access_token: 'AT', refresh_token: 'RT', token_type: 'bearer', expires_in: 3600 },
      now,
    );
    expect(t.accessToken).toBe('AT');
    expect(t.refreshToken).toBe('RT');
    expect(t.tokenType).toBe('bearer');
    expect(t.expiresAt).toBe(now + 3600 * 1000);
  });

  it('defaults token_type and tolerates a missing refresh_token', () => {
    const t = parseTokenResponse({ access_token: 'AT', expires_in: 60 }, 0);
    expect(t.tokenType).toBe('bearer');
    expect(t.refreshToken).toBe('');
  });

  it('throws on an OAuth error payload with the description', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant', error_description: 'bad code' })).toThrow(/bad code/);
  });

  it('throws when access_token is absent', () => {
    expect(() => parseTokenResponse({ token_type: 'bearer' })).toThrow(/no access_token/);
  });
});

describe('isExpired', () => {
  const t = parseTokenResponse({ access_token: 'AT', expires_in: 3600 }, 0);
  it('is false well before expiry', () => {
    expect(isExpired(t, 1000)).toBe(false);
  });
  it('is true past expiry', () => {
    expect(isExpired(t, 3600 * 1000 + 1)).toBe(true);
  });
  it('refreshes early within the skew window', () => {
    // 30s before the 3600s expiry, default 60s skew → treated as expired
    expect(isExpired(t, 3600 * 1000 - 30_000)).toBe(true);
  });
});
