import { describe, it, expect } from 'vitest';
import {
  authorizeUrl,
  basicAuth,
  tokenExchange,
  refreshExchange,
  revokeExchange,
  parseTokenResponse,
  parseCallback,
} from '../src/qbo-oauth';
import { OAUTH_SCOPES, INTUIT_TOKEN_URL, INTUIT_REVOKE_URL } from '../src/config';

describe('authorizeUrl', () => {
  it('builds the Intuit authorize URL with the documented params', () => {
    const url = authorizeUrl({
      clientId: 'ik-123',
      redirectUri: 'https://quickbooks.hanzo.ai/oauth/callback',
      scopes: OAUTH_SCOPES,
      state: 'csrf-1',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('ik-123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://quickbooks.hanzo.ai/oauth/callback');
    expect(u.searchParams.get('state')).toBe('csrf-1');
    // scopes are space-joined
    expect(u.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting openid');
  });

  it('uses the same authorize host regardless of environment (env selects the API host, not OAuth)', () => {
    const a = authorizeUrl({ clientId: 'ik', redirectUri: 'https://x/cb', scopes: ['openid'], state: 's' });
    expect(new URL(a).origin).toBe('https://appcenter.intuit.com');
  });
});

describe('basicAuth', () => {
  it('is Basic base64(client_id:client_secret)', () => {
    const header = basicAuth('ikey', 'skey');
    expect(header.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(header.slice(6), 'base64').toString('utf8')).toBe('ikey:skey');
  });
});

describe('tokenExchange', () => {
  it('shapes the code→token request: Basic header + form body with redirect_uri; secret not in body/url', () => {
    const req = tokenExchange({
      clientId: 'ik',
      clientSecret: 'SECRET',
      code: 'abc',
      redirectUri: 'https://quickbooks.hanzo.ai/oauth/callback',
    });
    expect(req.url).toBe(INTUIT_TOKEN_URL);
    expect(req.headers.Authorization.startsWith('Basic ')).toBe(true);
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.headers.Accept).toBe('application/json');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    // Intuit REQUIRES redirect_uri in the token body (unlike DocuSign).
    expect(body.get('redirect_uri')).toBe('https://quickbooks.hanzo.ai/oauth/callback');
    // secret must never leak into the body or URL
    expect(req.body).not.toContain('SECRET');
    expect(req.url).not.toContain('SECRET');
  });
});

describe('refreshExchange', () => {
  it('shapes the refresh_token request against the token endpoint', () => {
    const req = refreshExchange({ clientId: 'ik', clientSecret: 's', refreshToken: 'rt' });
    expect(req.url).toBe(INTUIT_TOKEN_URL);
    expect(req.headers.Authorization.startsWith('Basic ')).toBe(true);
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
  });
});

describe('revokeExchange', () => {
  it('shapes the revoke request as JSON to the revoke endpoint', () => {
    const req = revokeExchange({ clientId: 'ik', clientSecret: 's', token: 'rt' });
    expect(req.url).toBe(INTUIT_REVOKE_URL);
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(req.body)).toEqual({ token: 'rt' });
  });
});

describe('parseTokenResponse', () => {
  it('returns the token set on success, normalizing snake_case fields', () => {
    const t = parseTokenResponse({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400,
      token_type: 'bearer',
      id_token: 'IDT',
    });
    expect(t.accessToken).toBe('AT');
    expect(t.refreshToken).toBe('RT');
    expect(t.expiresIn).toBe(3600);
    expect(t.refreshExpiresIn).toBe(8726400);
    expect(t.tokenType).toBe('bearer');
    expect(t.idToken).toBe('IDT');
  });
  it('throws Intuit error on a failure body', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant', error_description: 'code expired' })).toThrow(/code expired/);
  });
  it('throws when access_token is missing', () => {
    expect(() => parseTokenResponse({ refresh_token: 'RT' })).toThrow(/access_token/);
  });
  it('throws when refresh_token is missing', () => {
    expect(() => parseTokenResponse({ access_token: 'AT' })).toThrow(/refresh_token/);
  });
  it('throws on an empty body', () => {
    expect(() => parseTokenResponse(null)).toThrow();
  });
});

describe('parseCallback', () => {
  it('reads code, realmId, and state from the redirect query', () => {
    const cb = parseCallback(new URLSearchParams('code=AUTH&realmId=123456789&state=csrf-1'));
    expect(cb).toEqual({ code: 'AUTH', realmId: '123456789', state: 'csrf-1' });
  });
  it('throws on the Intuit error redirect', () => {
    expect(() =>
      parseCallback(new URLSearchParams('error=access_denied&error_description=user+declined')),
    ).toThrow(/user declined|access_denied/);
  });
  it('throws when code is missing', () => {
    expect(() => parseCallback(new URLSearchParams('realmId=1&state=s'))).toThrow(/code/);
  });
  it('throws when realmId is missing', () => {
    expect(() => parseCallback(new URLSearchParams('code=AUTH&state=s'))).toThrow(/realmId/);
  });
});
