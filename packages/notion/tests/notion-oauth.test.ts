import { describe, it, expect } from 'vitest';
import {
  oauthAuthorizeUrl,
  basicAuthHeader,
  tokenExchange,
  parseTokenResponse,
} from '../src/notion-oauth';
import { NOTION_VERSION } from '../src/config';

describe('oauthAuthorizeUrl', () => {
  const p = {
    clientId: 'CID',
    redirectUri: 'https://notion.hanzo.ai/oauth/callback',
    state: 'st-123',
  };

  it('targets Notion authorize with code + owner=user + state', () => {
    const url = new URL(oauthAuthorizeUrl(p));
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('owner')).toBe('user');
    expect(url.searchParams.get('redirect_uri')).toBe(p.redirectUri);
    expect(url.searchParams.get('state')).toBe('st-123');
  });

  it('honours a base override (self-host / test)', () => {
    const url = new URL(oauthAuthorizeUrl({ ...p, base: 'https://notion.local' }));
    expect(url.origin).toBe('https://notion.local');
  });
});

describe('basicAuthHeader', () => {
  it('base64-encodes client_id:client_secret', () => {
    expect(basicAuthHeader('id', 'secret')).toBe(
      'Basic ' + Buffer.from('id:secret').toString('base64'),
    );
  });
});

describe('tokenExchange', () => {
  it('shapes a JSON POST with Basic auth + Notion-Version, secret NOT in the body', () => {
    const req = tokenExchange({
      clientId: 'CID',
      clientSecret: 'SEC',
      redirectUri: 'https://notion.hanzo.ai/oauth/callback',
      code: 'auth-code',
    });
    expect(req.url).toBe('https://api.notion.com/v1/oauth/token');
    expect(req.headers.Authorization).toBe(basicAuthHeader('CID', 'SEC'));
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['Notion-Version']).toBe(NOTION_VERSION);
    const body = JSON.parse(req.body);
    expect(body).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'https://notion.hanzo.ai/oauth/callback',
    });
    // The secret is carried ONLY in the Authorization header, never the body.
    expect(req.body).not.toContain('SEC');
  });
});

describe('parseTokenResponse', () => {
  it('maps the bot token + workspace metadata', () => {
    const t = parseTokenResponse({
      access_token: 'secret_bot_token',
      token_type: 'bearer',
      bot_id: 'bot-1',
      workspace_id: 'ws-1',
      workspace_name: 'Acme',
      workspace_icon: 'https://x/icon.png',
    });
    expect(t.accessToken).toBe('secret_bot_token');
    expect(t.botId).toBe('bot-1');
    expect(t.workspaceId).toBe('ws-1');
    expect(t.workspaceName).toBe('Acme');
    expect(t.workspaceIcon).toBe('https://x/icon.png');
  });

  it('defaults token_type and tolerates missing workspace fields', () => {
    const t = parseTokenResponse({ access_token: 'tok' });
    expect(t.tokenType).toBe('bearer');
    expect(t.botId).toBe('');
    expect(t.workspaceName).toBe('');
  });

  it('throws Notion’s error with its description', () => {
    expect(() =>
      parseTokenResponse({ error: 'invalid_grant', error_description: 'code used' }),
    ).toThrow(/Notion OAuth error: code used/);
  });

  it('throws when there is no access_token', () => {
    expect(() => parseTokenResponse({ token_type: 'bearer' })).toThrow(/no access_token/);
  });
});
