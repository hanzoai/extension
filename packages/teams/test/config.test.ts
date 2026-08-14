import { describe, it, expect } from 'vitest';
import { loadConfig, DEFAULT_MODELS, type Env } from '../src/config';

const base: Env = {
  MICROSOFT_APP_ID: 'app-id',
  MICROSOFT_APP_PASSWORD: 'app-secret',
  HANZO_API_KEY: 'sk-test',
};

describe('loadConfig', () => {
  it('loads required vars and applies defaults', () => {
    const c = loadConfig(base);
    expect(c.appId).toBe('app-id');
    expect(c.appPassword).toBe('app-secret');
    expect(c.hanzoApiKey).toBe('sk-test');
    expect(c.appType).toBe('MultiTenant');
    expect(c.appTenantId).toBe('');
    expect(c.port).toBe(3978);
    expect(c.models).toEqual([...DEFAULT_MODELS]);
    expect(c.defaultModel).toBe(DEFAULT_MODELS[0]);
    expect(c.hanzoBaseUrl).toBeUndefined();
  });

  it('is frozen', () => {
    const c = loadConfig(base);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('parses a custom model list and default model', () => {
    const c = loadConfig({
      ...base,
      HANZO_MODELS: 'zen-4b, zen-coder-14b ,zen-mini-8b',
      HANZO_DEFAULT_MODEL: 'zen-mini-8b',
    });
    expect(c.models).toEqual(['zen-4b', 'zen-coder-14b', 'zen-mini-8b']);
    expect(c.defaultModel).toBe('zen-mini-8b');
  });

  it('falls back to the first model when default is unset', () => {
    const c = loadConfig({ ...base, HANZO_MODELS: 'zen-4b,zen-eco-3b' });
    expect(c.defaultModel).toBe('zen-4b');
  });

  it('honors a custom port and base url', () => {
    const c = loadConfig({ ...base, PORT: '8080', HANZO_BASE_URL: 'http://localhost:1234' });
    expect(c.port).toBe(8080);
    expect(c.hanzoBaseUrl).toBe('http://localhost:1234');
  });

  it('throws on a missing required var', () => {
    const { MICROSOFT_APP_PASSWORD: _omit, ...partial } = base;
    expect(() => loadConfig(partial)).toThrow(/MICROSOFT_APP_PASSWORD/);
  });

  it('throws on an invalid port', () => {
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PORT: '99999' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects a port with trailing garbage instead of truncating it', () => {
    expect(() => loadConfig({ ...base, PORT: '80x' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PORT: '3978 #http' })).toThrow(/PORT/);
  });

  it('rejects a default model that is not in the model list', () => {
    expect(() =>
      loadConfig({ ...base, HANZO_MODELS: 'zen-4b', HANZO_DEFAULT_MODEL: 'zen-99b' }),
    ).toThrow(/HANZO_DEFAULT_MODEL/);
  });
});
