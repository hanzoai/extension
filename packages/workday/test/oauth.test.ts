import { describe, it, expect } from 'vitest';
import {
  basicAuthHeader,
  authorizeUrl,
  tokenUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  carryRefreshToken,
  tokenExpiresAt,
  isExpired,
} from '../src/workday-oauth.js';

const HOST = 'https://wd2-impl-services1.workday.com';
const TENANT = 'acme';

describe('oauth: basicAuthHeader', () => {
  it('base64-encodes client_id:client_secret as HTTP Basic', () => {
    const h = basicAuthHeader('cid', 'sec');
    expect(h).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`);
    // Decodes back to the pair.
    const decoded = Buffer.from(h.replace('Basic ', ''), 'base64').toString('utf8');
    expect(decoded).toBe('cid:sec');
  });
  it('never leaks the raw secret in the header value', () => {
    expect(basicAuthHeader('cid', 'SUPERSECRET')).not.toContain('SUPERSECRET');
  });
});

describe('oauth: authorizeUrl', () => {
  it('builds the tenant consent URL with the standard params', () => {
    const url = new URL(
      authorizeUrl({
        host: HOST,
        tenant: TENANT,
        clientId: 'cid',
        redirectUri: 'https://workday.hanzo.ai/oauth/callback',
        state: 'st-1',
      }),
    );
    expect(url.origin).toBe('https://wd2-impl-services1.workday.com');
    expect(url.pathname).toBe('/ccx/oauth2/acme/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://workday.hanzo.ai/oauth/callback');
    expect(url.searchParams.get('state')).toBe('st-1');
  });

  it('omits scope when empty', () => {
    const url = new URL(
      authorizeUrl({ host: HOST, tenant: TENANT, clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: [] }),
    );
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('space-joins scopes when present', () => {
    const url = new URL(
      authorizeUrl({ host: HOST, tenant: TENANT, clientId: 'c', redirectUri: 'https://x/cb', state: 's', scopes: ['Staffing', 'Time_Off'] }),
    );
    expect(url.searchParams.get('scope')).toBe('Staffing Time_Off');
  });
});

describe('oauth: tokenUrl', () => {
  it('resolves the token endpoint on the tenant OAuth root', () => {
    expect(tokenUrl(HOST, TENANT)).toBe('https://wd2-impl-services1.workday.com/ccx/oauth2/acme/token');
  });
});

describe('oauth: tokenExchange', () => {
  it('puts the client credentials in the Basic header, NOT the body', () => {
    const req = tokenExchange({
      host: HOST,
      tenant: TENANT,
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'the-code',
      redirectUri: 'https://workday.hanzo.ai/oauth/callback',
    });
    expect(req.url).toBe('https://wd2-impl-services1.workday.com/ccx/oauth2/acme/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.headers.Authorization).toBe(basicAuthHeader('cid', 'sec'));
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('redirect_uri')).toBe('https://workday.hanzo.ai/oauth/callback');
    // Secret + id are NOT in the body (they ride in the Basic header).
    expect(body.has('client_secret')).toBe(false);
    expect(body.has('client_id')).toBe(false);
  });

  it('never puts the secret in the body string', () => {
    const req = tokenExchange({ host: HOST, tenant: TENANT, clientId: 'c', clientSecret: 'SUPER', code: 'x', redirectUri: 'https://x/cb' });
    expect(req.body).not.toContain('SUPER');
  });
});

describe('oauth: refreshExchange', () => {
  it('form-encodes the refresh grant with Basic client auth', () => {
    const req = refreshExchange({ host: HOST, tenant: TENANT, clientId: 'cid', clientSecret: 'sec', refreshToken: 'r-1' });
    expect(req.url).toBe('https://wd2-impl-services1.workday.com/ccx/oauth2/acme/token');
    expect(req.headers.Authorization).toBe(basicAuthHeader('cid', 'sec'));
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r-1');
    expect(body.has('code')).toBe(false);
    expect(body.has('client_secret')).toBe(false);
  });
});

describe('oauth: parseTokenResponse', () => {
  it('parses a full token set (no created_at on Workday)', () => {
    const t = parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    expect(t.access_token).toBe('at');
    expect(t.refresh_token).toBe('rt');
    expect(t.expires_in).toBe(3600);
    expect(t.token_type).toBe('Bearer');
  });

  it('throws on a Workday error payload with the description', () => {
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

describe('oauth: carryRefreshToken (Workday does not rotate)', () => {
  it('keeps the prior refresh token when the refresh response omits one', () => {
    const prev = { access_token: 'old', refresh_token: 'keep-me', expires_in: 3600 };
    const next = { access_token: 'new', expires_in: 3600 };
    expect(carryRefreshToken(prev, next).refresh_token).toBe('keep-me');
    expect(carryRefreshToken(prev, next).access_token).toBe('new');
  });
  it('keeps a rotated refresh token when the response does carry one', () => {
    const prev = { access_token: 'old', refresh_token: 'old-r' };
    const next = { access_token: 'new', refresh_token: 'new-r' };
    expect(carryRefreshToken(prev, next).refresh_token).toBe('new-r');
  });
});

describe('oauth: expiry math (mint-time based)', () => {
  it('computes expiry from mintedAt + expires_in minus skew', () => {
    const t = { access_token: 'a', expires_in: 3600 };
    expect(tokenExpiresAt(t, 1000, 60)).toBe(1000 + 3600 - 60);
  });

  it('treats a missing expires_in as ttl 0', () => {
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
