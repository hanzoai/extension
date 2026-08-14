import { describe, it, expect } from 'vitest';
import {
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  qboApiHost,
  isQboEnv,
  readServerConfig,
  OAUTH_SCOPES,
  HANZO_API_BASE_URL,
  QBO_API_VERSION,
  QBO_MINOR_VERSION,
  INTUIT_AUTHORIZE_URL,
  INTUIT_TOKEN_URL,
} from '../src/config';

describe('pickBearer', () => {
  it('prefers the pasted API key over the oauth token', () => {
    expect(pickBearer('sk-123', 'oauth-tok')).toBe('sk-123');
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
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
  });
});

describe('Intuit + QBO hosts', () => {
  it('pins the single Intuit OAuth authorize + token hosts', () => {
    expect(INTUIT_AUTHORIZE_URL).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(INTUIT_TOKEN_URL).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
  });
  it('maps sandbox and production to the two Accounting API hosts', () => {
    expect(qboApiHost('sandbox')).toBe('https://sandbox-quickbooks.api.intuit.com');
    expect(qboApiHost('production')).toBe('https://quickbooks.api.intuit.com');
  });
  it('narrows only sandbox/production', () => {
    expect(isQboEnv('sandbox')).toBe(true);
    expect(isQboEnv('production')).toBe(true);
    expect(isQboEnv('prod')).toBe(false);
    expect(isQboEnv(undefined)).toBe(false);
  });
  it('requests the accounting + openid scopes', () => {
    expect(OAUTH_SCOPES).toContain('com.intuit.quickbooks.accounting');
    expect(OAUTH_SCOPES).toContain('openid');
  });
  it('uses Accounting API v3 with a pinned minorversion', () => {
    expect(QBO_API_VERSION).toBe('v3');
    expect(QBO_MINOR_VERSION).toMatch(/^\d+$/);
  });
});

describe('readServerConfig', () => {
  const base = {
    INTUIT_CLIENT_ID: 'ik',
    INTUIT_CLIENT_SECRET: 'sk',
    INTUIT_REDIRECT_URI: 'https://quickbooks.hanzo.ai/oauth/callback',
  };

  it('reads a full config and defaults env=sandbox, port=8790', () => {
    const cfg = readServerConfig(base);
    expect(cfg.intuitClientId).toBe('ik');
    expect(cfg.intuitClientSecret).toBe('sk');
    expect(cfg.intuitRedirectUri).toBe('https://quickbooks.hanzo.ai/oauth/callback');
    expect(cfg.qboEnv).toBe('sandbox');
    expect(cfg.hanzoApiKey).toBe('');
    expect(cfg.port).toBe(8790);
  });

  it('honors QBO_ENV=production, HANZO_API_KEY, and PORT', () => {
    const cfg = readServerConfig({ ...base, QBO_ENV: 'production', HANZO_API_KEY: 'sk-x', PORT: '9100' });
    expect(cfg.qboEnv).toBe('production');
    expect(cfg.hanzoApiKey).toBe('sk-x');
    expect(cfg.port).toBe(9100);
  });

  it('falls back to sandbox for an unknown QBO_ENV', () => {
    expect(readServerConfig({ ...base, QBO_ENV: 'staging' }).qboEnv).toBe('sandbox');
  });

  it.each(['INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET', 'INTUIT_REDIRECT_URI'])(
    'throws when %s is missing',
    (key) => {
      const env: Record<string, string | undefined> = { ...base };
      delete env[key];
      expect(() => readServerConfig(env)).toThrow(key);
    },
  );
});
