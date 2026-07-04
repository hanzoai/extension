import { describe, it, expect } from 'vitest';
import {
  readEnv,
  memoryStore,
  newSessionId,
  proxyPathAllowed,
} from '../src/server';
import type { TokenSet } from '../src/notion-oauth';

describe('readEnv', () => {
  it('requires client id, secret, and redirect', () => {
    expect(() => readEnv({} as any)).toThrow(/required/);
    expect(() =>
      readEnv({ NOTION_CLIENT_ID: 'a', NOTION_CLIENT_SECRET: 'b' } as any),
    ).toThrow(/required/);
  });
  it('reads all four fields with a default port', () => {
    const env = readEnv({
      NOTION_CLIENT_ID: 'cid',
      NOTION_CLIENT_SECRET: 'sec',
      NOTION_REDIRECT_URI: 'https://notion.hanzo.ai/oauth/callback',
    } as any);
    expect(env).toEqual({
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'https://notion.hanzo.ai/oauth/callback',
      port: 8788,
    });
  });
  it('honours PORT', () => {
    const env = readEnv({
      NOTION_CLIENT_ID: 'c',
      NOTION_CLIENT_SECRET: 's',
      NOTION_REDIRECT_URI: 'r',
      PORT: '9000',
    } as any);
    expect(env.port).toBe(9000);
  });
});

describe('session store + id', () => {
  it('mints unguessable, unique, 64-hex ids', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
  it('stores and retrieves a token set', () => {
    const store = memoryStore();
    const tok: TokenSet = {
      accessToken: 'bot',
      tokenType: 'bearer',
      botId: '',
      workspaceId: 'ws',
      workspaceName: 'Acme',
      workspaceIcon: '',
    };
    const id = newSessionId();
    store.put(id, tok);
    expect(store.get(id)).toBe(tok);
    expect(store.get('nope')).toBeUndefined();
  });
});

describe('proxyPathAllowed — only the exact Notion v1 subpaths this app uses', () => {
  it('allows the reads', () => {
    expect(proxyPathAllowed('GET', '/pages/abc123')).toBe(true);
    expect(proxyPathAllowed('GET', '/databases/db1')).toBe(true);
    expect(proxyPathAllowed('GET', '/blocks/pg/children')).toBe(true);
  });
  it('allows the writes', () => {
    expect(proxyPathAllowed('POST', '/search')).toBe(true);
    expect(proxyPathAllowed('POST', '/pages')).toBe(true);
    expect(proxyPathAllowed('POST', '/databases/db1/query')).toBe(true);
    expect(proxyPathAllowed('PATCH', '/blocks/pg/children')).toBe(true);
  });
  it('rejects anything else — no general Notion credential from a session', () => {
    expect(proxyPathAllowed('GET', '/users')).toBe(false);
    expect(proxyPathAllowed('GET', '/users/me')).toBe(false);
    expect(proxyPathAllowed('DELETE', '/blocks/pg')).toBe(false);
    expect(proxyPathAllowed('GET', '/blocks/pg')).toBe(false); // read a block, not its children
    expect(proxyPathAllowed('POST', '/pages/abc/anything')).toBe(false);
    expect(proxyPathAllowed('GET', '/pages/abc/children')).toBe(false);
  });
  it('is method-scoped: a write method on a read path is rejected', () => {
    expect(proxyPathAllowed('POST', '/pages/abc123')).toBe(false);
    expect(proxyPathAllowed('GET', '/search')).toBe(false);
  });
});
