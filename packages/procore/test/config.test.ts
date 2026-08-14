import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  APIKEY_STORAGE_KEY,
  PROJECT_CHAR_BUDGET,
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  hosts,
  apiBaseUrl,
  isProcoreEnv,
  readServerConfig,
  PROCORE_HOSTS,
} from '../src/config.js';

describe('config: gateway constants', () => {
  it('points at api.hanzo.ai with /v1 paths and never /api/', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
  });

  it('defaults to a zen model and a sane budget', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
    expect(PROJECT_CHAR_BUDGET).toBeGreaterThan(10_000);
    expect(APIKEY_STORAGE_KEY).toContain('procore');
  });
});

describe('config: pickBearer', () => {
  it('prefers a pasted key over an oauth token', () => {
    expect(pickBearer('sk-abc', 'oauth-xyz')).toBe('sk-abc');
  });
  it('falls back to the oauth token, trimming whitespace', () => {
    expect(pickBearer('   ', '  tok  ')).toBe('tok');
  });
  it('returns empty when both are blank (anonymous)', () => {
    expect(pickBearer('', '')).toBe('');
    expect(pickBearer('  ', '')).toBe('');
  });
});

describe('config: hosts + apiBaseUrl', () => {
  it('exposes the exact production hosts', () => {
    expect(hosts('production').login).toBe('https://login.procore.com');
    expect(hosts('production').api).toBe('https://api.procore.com');
  });
  it('exposes the exact sandbox hosts', () => {
    expect(hosts('sandbox').login).toBe('https://login-sandbox.procore.com');
    expect(hosts('sandbox').api).toBe('https://sandbox.procore.com');
  });
  it('builds the rest/v1.0 root per environment', () => {
    expect(apiBaseUrl('production')).toBe('https://api.procore.com/rest/v1.0');
    expect(apiBaseUrl('sandbox')).toBe('https://sandbox.procore.com/rest/v1.0');
  });
  it('only defines the two known environments', () => {
    expect(Object.keys(PROCORE_HOSTS).sort()).toEqual(['production', 'sandbox']);
  });
});

describe('config: isProcoreEnv', () => {
  it('accepts the two environments', () => {
    expect(isProcoreEnv('production')).toBe(true);
    expect(isProcoreEnv('sandbox')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isProcoreEnv('demo')).toBe(false);
    expect(isProcoreEnv(undefined)).toBe(false);
  });
});

describe('config: readServerConfig', () => {
  const base = {
    PROCORE_CLIENT_ID: 'cid',
    PROCORE_CLIENT_SECRET: 'secret',
    PROCORE_REDIRECT_URI: 'https://procore.hanzo.ai/oauth/callback',
  };

  it('reads a full config, defaulting env to sandbox and port to 8790', () => {
    const cfg = readServerConfig(base);
    expect(cfg.procoreClientId).toBe('cid');
    expect(cfg.procoreClientSecret).toBe('secret');
    expect(cfg.procoreRedirectUri).toBe('https://procore.hanzo.ai/oauth/callback');
    expect(cfg.procoreEnv).toBe('sandbox');
    expect(cfg.port).toBe(8790);
  });

  it('honours PROCORE_ENV and PORT', () => {
    const cfg = readServerConfig({ ...base, PROCORE_ENV: 'production', PORT: '9001' });
    expect(cfg.procoreEnv).toBe('production');
    expect(cfg.port).toBe(9001);
  });

  it('coerces an unknown PROCORE_ENV to sandbox', () => {
    expect(readServerConfig({ ...base, PROCORE_ENV: 'staging' }).procoreEnv).toBe('sandbox');
  });

  it('throws listing every missing required secret', () => {
    expect(() => readServerConfig({})).toThrow(/PROCORE_CLIENT_ID/);
    expect(() => readServerConfig({})).toThrow(/PROCORE_CLIENT_SECRET/);
    expect(() => readServerConfig({})).toThrow(/PROCORE_REDIRECT_URI/);
    expect(() => readServerConfig({ PROCORE_CLIENT_ID: 'x' })).toThrow(/PROCORE_CLIENT_SECRET, PROCORE_REDIRECT_URI/);
  });
});
