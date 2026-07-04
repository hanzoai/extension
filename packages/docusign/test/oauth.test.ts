import { describe, it, expect } from 'vitest';
import {
  authorizeUrl,
  basicAuth,
  tokenExchange,
  refreshExchange,
  userInfoUrl,
  parseTokenResponse,
  parseUserInfo,
  defaultAccount,
  apiBaseUrl,
} from '../src/docusign-oauth';
import { OAUTH_SCOPES } from '../src/config';

describe('authorizeUrl', () => {
  it('builds the demo authorize URL with the documented params', () => {
    const url = authorizeUrl({
      env: 'demo',
      clientId: 'ik-123',
      redirectUri: 'https://docusign.hanzo.ai/oauth/callback',
      scopes: OAUTH_SCOPES,
      state: 'csrf-1',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://account-d.docusign.com/oauth/auth');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('ik-123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://docusign.hanzo.ai/oauth/callback');
    expect(u.searchParams.get('state')).toBe('csrf-1');
    // scopes are space-joined
    expect(u.searchParams.get('scope')).toBe('signature openid');
  });

  it('targets the production account server for env=production', () => {
    const url = authorizeUrl({ env: 'production', clientId: 'ik', redirectUri: 'https://x/cb', scopes: ['signature'], state: 's' });
    expect(new URL(url).origin).toBe('https://account.docusign.com');
  });
});

describe('basicAuth', () => {
  it('is Basic base64(client_id:client_secret)', () => {
    const header = basicAuth('ikey', 'skey');
    expect(header.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    expect(decoded).toBe('ikey:skey');
  });
});

describe('tokenExchange', () => {
  it('shapes the code→token request: Basic header + form body, secret not in body/url', () => {
    const req = tokenExchange({ env: 'demo', clientId: 'ik', clientSecret: 'SECRET', code: 'abc' });
    expect(req.url).toBe('https://account-d.docusign.com/oauth/token');
    expect(req.headers.Authorization.startsWith('Basic ')).toBe(true);
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    // secret must never leak into the body or URL
    expect(req.body).not.toContain('SECRET');
    expect(req.url).not.toContain('SECRET');
  });
});

describe('refreshExchange', () => {
  it('shapes the refresh_token request', () => {
    const req = refreshExchange({ env: 'production', clientId: 'ik', clientSecret: 's', refreshToken: 'rt' });
    expect(req.url).toBe('https://account.docusign.com/oauth/token');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
  });
});

describe('userInfoUrl', () => {
  it('is the account-server /oauth/userinfo', () => {
    expect(userInfoUrl('demo')).toBe('https://account-d.docusign.com/oauth/userinfo');
  });
});

describe('parseTokenResponse', () => {
  it('returns the token set on success', () => {
    const t = parseTokenResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 28800, token_type: 'Bearer' });
    expect(t.access_token).toBe('AT');
    expect(t.refresh_token).toBe('RT');
    expect(t.expires_in).toBe(28800);
  });
  it('throws DocuSign error on a failure body', () => {
    expect(() => parseTokenResponse({ error: 'invalid_grant', error_description: 'code expired' })).toThrow(/code expired/);
  });
  it('throws when access_token is missing', () => {
    expect(() => parseTokenResponse({ token_type: 'Bearer' })).toThrow(/access_token/);
  });
  it('throws on an empty body', () => {
    expect(() => parseTokenResponse(null)).toThrow();
  });
});

describe('parseUserInfo / defaultAccount / apiBaseUrl', () => {
  const payload = {
    sub: 'user-guid',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    accounts: [
      { account_id: 'acct-1', account_name: 'Demo A', base_uri: 'https://demo.docusign.net', is_default: 'false' },
      { account_id: 'acct-2', account_name: 'Demo B', base_uri: 'https://demo.docusign.net/', is_default: true },
    ],
  };

  it('normalizes snake_case accounts to camelCase and strips trailing slash on base_uri', () => {
    const info = parseUserInfo(payload);
    expect(info.sub).toBe('user-guid');
    expect(info.email).toBe('ada@example.com');
    expect(info.accounts).toHaveLength(2);
    expect(info.accounts[1].accountId).toBe('acct-2');
    expect(info.accounts[1].baseUri).toBe('https://demo.docusign.net');
    expect(info.accounts[1].isDefault).toBe(true);
  });

  it('picks the is_default account, tolerating string "true"', () => {
    expect(defaultAccount(parseUserInfo(payload)).accountId).toBe('acct-2');
  });

  it('falls back to the first account when none is default', () => {
    const info = parseUserInfo({ ...payload, accounts: [{ account_id: 'only', base_uri: 'https://x.docusign.net', is_default: false }] });
    expect(defaultAccount(info).accountId).toBe('only');
  });

  it('drops accounts missing an id or base_uri, throws when none usable', () => {
    expect(() => parseUserInfo({ accounts: [{ account_id: '', base_uri: 'https://x' }] })).toThrow(/no usable accounts/);
  });

  it('builds the eSignature REST root at /restapi/v2.1', () => {
    expect(apiBaseUrl('https://demo.docusign.net')).toBe('https://demo.docusign.net/restapi/v2.1');
    expect(apiBaseUrl('https://demo.docusign.net/')).toBe('https://demo.docusign.net/restapi/v2.1');
  });
});
