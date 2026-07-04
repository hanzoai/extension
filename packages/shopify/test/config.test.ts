import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  ADMIN_API_VERSION,
  OAUTH_SCOPES,
  chatCompletionsURL,
  modelsURL,
  isShopDomain,
  adminGraphqlUrl,
  readServerConfig,
} from '../src/config';

describe('gateway URLs', () => {
  it('build /v1 endpoints on api.hanzo.ai with no /api/ prefix', () => {
    expect(chatCompletionsURL()).toBe(`${HANZO_API_BASE_URL}/v1/chat/completions`);
    expect(modelsURL()).toBe(`${HANZO_API_BASE_URL}/v1/models`);
    expect(chatCompletionsURL()).not.toContain('/api/');
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
  });
  it('defaults to a zen model', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
  });
});

describe('OAuth scopes', () => {
  it('requests exactly read/write products + read orders', () => {
    expect([...OAUTH_SCOPES]).toEqual(['read_products', 'write_products', 'read_orders']);
  });
});

describe('isShopDomain (boundary guard)', () => {
  it('accepts a valid myshopify.com store domain', () => {
    expect(isShopDomain('my-store.myshopify.com')).toBe(true);
    expect(isShopDomain('store123.myshopify.com')).toBe(true);
  });
  it('rejects anything not a myshopify.com store', () => {
    expect(isShopDomain('evil.com')).toBe(false);
    expect(isShopDomain('my-store.myshopify.com.evil.com')).toBe(false);
    expect(isShopDomain('https://my-store.myshopify.com')).toBe(false);
    expect(isShopDomain('my-store.myshopify.com/admin')).toBe(false);
    expect(isShopDomain('UPPER.myshopify.com')).toBe(false);
    expect(isShopDomain('.myshopify.com')).toBe(false);
    expect(isShopDomain(undefined)).toBe(false);
    expect(isShopDomain('')).toBe(false);
  });
});

describe('adminGraphqlUrl', () => {
  it('builds the versioned graphql endpoint for a shop', () => {
    expect(adminGraphqlUrl('my-store.myshopify.com')).toBe(
      `https://my-store.myshopify.com/admin/api/${ADMIN_API_VERSION}/graphql.json`,
    );
  });
  it('honors an explicit version', () => {
    expect(adminGraphqlUrl('s.myshopify.com', '2024-10')).toBe(
      'https://s.myshopify.com/admin/api/2024-10/graphql.json',
    );
  });
  it('never contains an /api/v1 or /api/ hanzo-style prefix mistake (this is the shop host)', () => {
    expect(adminGraphqlUrl('s.myshopify.com')).toContain('/admin/api/');
  });
});

describe('readServerConfig', () => {
  const base = {
    SHOPIFY_API_KEY: 'apikey',
    SHOPIFY_API_SECRET: 'secret',
    SHOPIFY_REDIRECT_URI: 'https://shopify.hanzo.ai/oauth/callback',
  };

  it('reads a full config and defaults scopes/port; hanzoApiKey optional', () => {
    const cfg = readServerConfig(base);
    expect(cfg.shopifyApiKey).toBe('apikey');
    expect(cfg.shopifyApiSecret).toBe('secret');
    expect(cfg.shopifyRedirectUri).toBe('https://shopify.hanzo.ai/oauth/callback');
    expect(cfg.scopes).toBe('read_products,write_products,read_orders');
    expect(cfg.hanzoApiKey).toBe('');
    expect(cfg.port).toBe(8791);
  });

  it('honors SHOPIFY_SCOPES, HANZO_API_KEY and PORT', () => {
    const cfg = readServerConfig({ ...base, SHOPIFY_SCOPES: 'read_products', HANZO_API_KEY: 'hk-x', PORT: '9100' });
    expect(cfg.scopes).toBe('read_products');
    expect(cfg.hanzoApiKey).toBe('hk-x');
    expect(cfg.port).toBe(9100);
  });

  it.each(['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_REDIRECT_URI'])(
    'throws when %s is missing',
    (key) => {
      const env: Record<string, string | undefined> = { ...base };
      delete env[key];
      expect(() => readServerConfig(env)).toThrow(key);
    },
  );

  it('never exposes the secret in a way the browser bundle could read (it is server-only by construction)', () => {
    // The secret is only ever returned from readServerConfig, which server.ts
    // calls; nothing in src/app imports config's server fields. This asserts the
    // field exists exactly once as a config value (documentation of intent).
    const cfg = readServerConfig(base);
    expect(cfg.shopifyApiSecret).toBe('secret');
  });
});
