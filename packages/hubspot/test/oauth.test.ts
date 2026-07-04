import { describe, it, expect } from 'vitest';
import {
  authorizeUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
} from '../src/oauth.js';

describe('authorizeUrl', () => {
  it('builds the authorize URL with space-joined scopes and state', () => {
    const url = authorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://hubspot.hanzo.ai/oauth/callback',
      scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
      state: 'csrf123',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://app.hubspot.com/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('https://hubspot.hanzo.ai/oauth/callback');
    expect(u.searchParams.get('scope')).toBe(
      'crm.objects.contacts.read crm.objects.contacts.write',
    );
    expect(u.searchParams.get('state')).toBe('csrf123');
    expect(u.searchParams.get('optional_scope')).toBeNull();
  });

  it('adds optional_scope only when optional scopes are given', () => {
    const url = authorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://x/cb',
      scopes: ['a'],
      state: 's',
      optionalScopes: ['b', 'c'],
    });
    expect(new URL(url).searchParams.get('optional_scope')).toBe('b c');
  });
});

describe('tokenExchange', () => {
  it('shapes the code→token request as a form body on /oauth/v1/token', () => {
    const req = tokenExchange({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://x/cb',
      code: 'abc',
    });
    expect(req.url).toBe('https://api.hubapi.com/oauth/v1/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('secret');
    expect(body.get('redirect_uri')).toBe('https://x/cb');
    expect(body.get('code')).toBe('abc');
  });

  it('keeps the secret out of the URL', () => {
    const req = tokenExchange({ clientId: 'c', clientSecret: 'topsecret', redirectUri: 'r', code: 'x' });
    expect(req.url).not.toContain('topsecret');
  });
});

describe('refreshExchange', () => {
  it('shapes a refresh_token grant without a redirect_uri', () => {
    const req = refreshExchange({ clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' });
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
    expect(body.get('redirect_uri')).toBeNull();
  });
});

describe('parseTokenResponse', () => {
  it('parses a valid token set', () => {
    const t = parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 1800,
      token_type: 'bearer',
    });
    expect(t).toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 1800,
      token_type: 'bearer',
    });
  });

  it('throws on a HubSpot { status: "error" } payload with its message', () => {
    expect(() =>
      parseTokenResponse({ status: 'error', message: 'invalid code' }),
    ).toThrow(/invalid code/);
  });

  it('throws on an OAuth2 error payload', () => {
    expect(() =>
      parseTokenResponse({ error: 'invalid_grant', error_description: 'expired' }),
    ).toThrow(/expired/);
  });

  it('throws when access_token is missing', () => {
    expect(() => parseTokenResponse({ token_type: 'bearer' })).toThrow(/missing access_token/);
  });

  it('throws on an empty response', () => {
    expect(() => parseTokenResponse(null)).toThrow(/empty token response/);
  });

  it('drops non-string optional fields rather than trusting them', () => {
    const t = parseTokenResponse({ access_token: 'at', refresh_token: 123, expires_in: 'x' });
    expect(t.refresh_token).toBeUndefined();
    expect(t.expires_in).toBeUndefined();
  });
});
