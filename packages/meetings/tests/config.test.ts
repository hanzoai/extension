import { describe, it, expect } from 'vitest';
import {
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  readServerConfig,
  DEFAULT_MODEL,
} from '../src/config';
import { authorizeUrl, tokenExchange, parseTokenResponse } from '../src/zoom/oauth';

describe('pickBearer', () => {
  it('prefers a pasted API key over an OAuth token', () => {
    expect(pickBearer('hk-key', 'oauth-tok')).toBe('hk-key');
  });
  it('falls back to the OAuth token, then empty', () => {
    expect(pickBearer('', 'oauth-tok')).toBe('oauth-tok');
    expect(pickBearer('', '')).toBe('');
  });
  it('ignores whitespace-only credentials', () => {
    expect(pickBearer('  ', 'oauth-tok')).toBe('oauth-tok');
  });
});

describe('gateway URLs (/v1, never /api/)', () => {
  it('points at api.hanzo.ai/v1', () => {
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
  });
  it('has a zen default model', () => {
    expect(DEFAULT_MODEL).toBe('zen-1');
  });
});

describe('readServerConfig', () => {
  const full = {
    ZOOM_CLIENT_ID: 'cid',
    ZOOM_CLIENT_SECRET: 'csecret',
    ZOOM_REDIRECT_URI: 'https://meetings.hanzo.ai/zoom/oauth/callback',
    ZOOM_WEBHOOK_SECRET_TOKEN: 'whsec',
  };

  it('reads a complete config with the optional Hanzo key and a default port', () => {
    const cfg = readServerConfig({ ...full, HANZO_API_KEY: 'hk-1' });
    expect(cfg.zoomClientId).toBe('cid');
    expect(cfg.zoomWebhookSecret).toBe('whsec');
    expect(cfg.hanzoApiKey).toBe('hk-1');
    expect(cfg.port).toBe(8788);
  });

  it('allows a missing HANZO_API_KEY (verify+route without summarizing)', () => {
    const cfg = readServerConfig(full);
    expect(cfg.hanzoApiKey).toBe('');
  });

  it('honors PORT', () => {
    expect(readServerConfig({ ...full, PORT: '9000' }).port).toBe(9000);
  });

  it('throws naming every missing required secret', () => {
    expect(() => readServerConfig({})).toThrow(/ZOOM_CLIENT_ID/);
    expect(() => readServerConfig({ ZOOM_CLIENT_ID: 'x' })).toThrow(/ZOOM_CLIENT_SECRET/);
    expect(() => readServerConfig({ ...full, ZOOM_WEBHOOK_SECRET_TOKEN: undefined })).toThrow(
      /ZOOM_WEBHOOK_SECRET_TOKEN/,
    );
  });
});

describe('Zoom OAuth request shaping', () => {
  it('builds the authorize URL with state', () => {
    const url = new URL(authorizeUrl('cid', 'https://h/cb', 'st8'));
    expect(url.origin + url.pathname).toBe('https://zoom.us/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://h/cb');
    expect(url.searchParams.get('state')).toBe('st8');
  });

  it('puts the secret in the Basic header, not the body', () => {
    const req = tokenExchange({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://h/cb', code: 'abc' });
    expect(req.url).toBe('https://zoom.us/oauth/token');
    expect(req.headers.Authorization).toBe('Basic ' + Buffer.from('cid:sec').toString('base64'));
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.body).not.toContain('sec'); // secret is NOT in the body
    const params = new URLSearchParams(req.body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('abc');
    expect(params.get('redirect_uri')).toBe('https://h/cb');
  });

  it('parses a token response and throws on an error body', () => {
    expect(parseTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })).toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: undefined,
      token_type: undefined,
    });
    expect(() => parseTokenResponse({ error: 'invalid_grant', reason: 'bad code' })).toThrow(/bad code/);
    expect(() => parseTokenResponse({})).toThrow(/missing access_token/);
  });
});
