import { describe, it, expect } from 'vitest';
import {
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  accountServer,
  isDocusignEnv,
  readServerConfig,
  OAUTH_SCOPES,
  HANZO_API_BASE_URL,
  ESIGN_API_VERSION,
} from '../src/config';

describe('pickBearer', () => {
  it('prefers the pasted API key over the oauth token', () => {
    expect(pickBearer('hk-123', 'oauth-tok')).toBe('hk-123');
  });
  it('falls back to the oauth token when no key', () => {
    expect(pickBearer('', 'oauth-tok')).toBe('oauth-tok');
    expect(pickBearer('   ', 'oauth-tok')).toBe('oauth-tok');
  });
  it('is empty (anonymous) when neither is present', () => {
    expect(pickBearer('', '')).toBe('');
  });
});

describe('gateway URLs', () => {
  it('build /v1 endpoints on api.hanzo.ai with no /api/ prefix', () => {
    expect(chatCompletionsURL()).toBe(`${HANZO_API_BASE_URL}/v1/chat/completions`);
    expect(modelsURL()).toBe(`${HANZO_API_BASE_URL}/v1/models`);
    expect(chatCompletionsURL()).not.toContain('/api/');
  });
});

describe('accountServer / env', () => {
  it('maps demo and production to the two DocuSign account servers', () => {
    expect(accountServer('demo')).toBe('https://account-d.docusign.com');
    expect(accountServer('production')).toBe('https://account.docusign.com');
  });
  it('narrows only demo/production', () => {
    expect(isDocusignEnv('demo')).toBe(true);
    expect(isDocusignEnv('production')).toBe(true);
    expect(isDocusignEnv('prod')).toBe(false);
    expect(isDocusignEnv(undefined)).toBe(false);
  });
  it('requests the signature + openid scopes', () => {
    expect(OAUTH_SCOPES).toContain('signature');
    expect(OAUTH_SCOPES).toContain('openid');
  });
  it('uses eSignature REST v2.1', () => {
    expect(ESIGN_API_VERSION).toBe('v2.1');
  });
});

describe('readServerConfig', () => {
  const base = {
    DOCUSIGN_CLIENT_ID: 'ik',
    DOCUSIGN_CLIENT_SECRET: 'sk',
    DOCUSIGN_REDIRECT_URI: 'https://docusign.hanzo.ai/oauth/callback',
    DOCUSIGN_CONNECT_HMAC_KEY: 'hmac',
  };

  it('reads a full config and defaults env=demo, port=8789', () => {
    const cfg = readServerConfig(base);
    expect(cfg.docusignClientId).toBe('ik');
    expect(cfg.docusignClientSecret).toBe('sk');
    expect(cfg.connectHmacKey).toBe('hmac');
    expect(cfg.docusignEnv).toBe('demo');
    expect(cfg.hanzoApiKey).toBe('');
    expect(cfg.port).toBe(8789);
  });

  it('honors DOCUSIGN_ENV=production, HANZO_API_KEY, and PORT', () => {
    const cfg = readServerConfig({ ...base, DOCUSIGN_ENV: 'production', HANZO_API_KEY: 'hk-x', PORT: '9000' });
    expect(cfg.docusignEnv).toBe('production');
    expect(cfg.hanzoApiKey).toBe('hk-x');
    expect(cfg.port).toBe(9000);
  });

  it('falls back to demo for an unknown DOCUSIGN_ENV', () => {
    expect(readServerConfig({ ...base, DOCUSIGN_ENV: 'staging' }).docusignEnv).toBe('demo');
  });

  it.each([
    'DOCUSIGN_CLIENT_ID',
    'DOCUSIGN_CLIENT_SECRET',
    'DOCUSIGN_REDIRECT_URI',
    'DOCUSIGN_CONNECT_HMAC_KEY',
  ])('throws when %s is missing', (key) => {
    const env: Record<string, string | undefined> = { ...base };
    delete env[key];
    expect(() => readServerConfig(env)).toThrow(key);
  });
});
