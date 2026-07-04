import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  APIKEY_STORAGE_KEY,
  DOCUMENT_CHAR_BUDGET,
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  hosts,
  normalizeHost,
  isHttpUrl,
  apiBaseUrl,
  WORK_API_VERSION,
  readServerConfig,
} from '../src/config.js';

describe('config: gateway constants', () => {
  it('points at api.hanzo.ai with /v1 paths and never /api/', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
    expect(modelsURL()).not.toContain('/api/');
  });

  it('defaults to a zen model and a sane budget', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
    expect(DOCUMENT_CHAR_BUDGET).toBeGreaterThan(10_000);
    expect(APIKEY_STORAGE_KEY).toContain('imanage');
  });
});

describe('config: pickBearer', () => {
  it('prefers a pasted key over an oauth token', () => {
    expect(pickBearer('hk-abc', 'oauth-xyz')).toBe('hk-abc');
  });
  it('falls back to the oauth token, trimming whitespace', () => {
    expect(pickBearer('   ', '  tok  ')).toBe('tok');
  });
  it('returns empty when both are blank (anonymous)', () => {
    expect(pickBearer('', '')).toBe('');
    expect(pickBearer('  ', '')).toBe('');
  });
});

describe('config: normalizeHost', () => {
  it('adds https:// to a bare host', () => {
    expect(normalizeHost('cloudimanage.com')).toBe('https://cloudimanage.com');
  });
  it('keeps an explicit scheme and strips path + trailing slash', () => {
    expect(normalizeHost('https://work.firm.com/')).toBe('https://work.firm.com');
    expect(normalizeHost('https://work.firm.com/api/v2')).toBe('https://work.firm.com');
  });
  it('preserves a port', () => {
    expect(normalizeHost('work.firm.com:8443')).toBe('https://work.firm.com:8443');
  });
  it('returns empty for an empty host', () => {
    expect(normalizeHost('')).toBe('');
    expect(normalizeHost('   ')).toBe('');
  });
});

describe('config: isHttpUrl', () => {
  it('accepts bare hosts and full urls', () => {
    expect(isHttpUrl('cloudimanage.com')).toBe(true);
    expect(isHttpUrl('https://work.firm.com')).toBe(true);
    expect(isHttpUrl('http://localhost:8793')).toBe(true);
  });
  it('rejects empty / nonsense', () => {
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl('ftp://x')).toBe(false);
  });
});

describe('config: hosts + apiBaseUrl', () => {
  it('resolves auth + api to the same host by default', () => {
    const h = hosts('cloudimanage.com');
    expect(h.auth).toBe('https://cloudimanage.com');
    expect(h.api).toBe('https://cloudimanage.com');
  });
  it('honours a distinct api host', () => {
    const h = hosts('cc.firm.com', 'work.firm.com');
    expect(h.auth).toBe('https://cc.firm.com');
    expect(h.api).toBe('https://work.firm.com');
  });
  it('builds the /api/v2 Work API root (iManage own path)', () => {
    expect(apiBaseUrl('cloudimanage.com')).toBe('https://cloudimanage.com/api/v2');
    expect(apiBaseUrl('https://work.firm.com/')).toBe('https://work.firm.com/api/v2');
    expect(WORK_API_VERSION).toBe('v2');
  });
});

describe('config: readServerConfig', () => {
  const base = {
    IMANAGE_CLIENT_ID: 'cid',
    IMANAGE_CLIENT_SECRET: 'secret',
    IMANAGE_REDIRECT_URI: 'https://imanage.hanzo.ai/oauth/callback',
    IMANAGE_HOST: 'https://cloudimanage.com',
  };

  it('reads a full config, defaulting port to 8793 and empty scope defaults', () => {
    const cfg = readServerConfig(base);
    expect(cfg.imanageClientId).toBe('cid');
    expect(cfg.imanageClientSecret).toBe('secret');
    expect(cfg.imanageRedirectUri).toBe('https://imanage.hanzo.ai/oauth/callback');
    expect(cfg.imanageHost).toBe('https://cloudimanage.com');
    expect(cfg.imanageApiHost).toBeUndefined();
    expect(cfg.customerId).toBe('');
    expect(cfg.libraryId).toBe('');
    expect(cfg.port).toBe(8793);
  });

  it('normalizes a bare host and honours PORT + scope defaults + api host', () => {
    const cfg = readServerConfig({
      ...base,
      IMANAGE_HOST: 'cloudimanage.com',
      IMANAGE_API_HOST: 'work.firm.com',
      IMANAGE_CUSTOMER_ID: '1',
      IMANAGE_LIBRARY_ID: 'ACTIVE_US',
      PORT: '9100',
    });
    expect(cfg.imanageHost).toBe('https://cloudimanage.com');
    expect(cfg.imanageApiHost).toBe('https://work.firm.com');
    expect(cfg.customerId).toBe('1');
    expect(cfg.libraryId).toBe('ACTIVE_US');
    expect(cfg.port).toBe(9100);
  });

  it('throws listing every missing required secret/host', () => {
    expect(() => readServerConfig({})).toThrow(/IMANAGE_CLIENT_ID/);
    expect(() => readServerConfig({})).toThrow(/IMANAGE_CLIENT_SECRET/);
    expect(() => readServerConfig({})).toThrow(/IMANAGE_REDIRECT_URI/);
    expect(() => readServerConfig({})).toThrow(/IMANAGE_HOST/);
    expect(() => readServerConfig({ IMANAGE_CLIENT_ID: 'x' })).toThrow(
      /IMANAGE_CLIENT_SECRET, IMANAGE_REDIRECT_URI, IMANAGE_HOST/,
    );
  });

  it('rejects a malformed host / api host', () => {
    expect(() => readServerConfig({ ...base, IMANAGE_HOST: 'not a url' })).toThrow(/IMANAGE_HOST is not a valid/);
    expect(() => readServerConfig({ ...base, IMANAGE_API_HOST: 'not a host' })).toThrow(/IMANAGE_API_HOST is not a valid/);
  });
});
