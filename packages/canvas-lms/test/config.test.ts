import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  APIKEY_STORAGE_KEY,
  COURSE_CHAR_BUDGET,
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  normalizeHost,
  authBase,
  apiBaseUrl,
  readServerConfig,
  OAUTH_SCOPES,
  RECOMMENDED_SCOPES,
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
    expect(COURSE_CHAR_BUDGET).toBeGreaterThan(10_000);
    expect(APIKEY_STORAGE_KEY).toContain('canvas');
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
  it('strips a scheme, path, and trailing slash to a bare host', () => {
    expect(normalizeHost('https://school.instructure.com/')).toBe('school.instructure.com');
    expect(normalizeHost('http://canvas.school.edu/courses/1')).toBe('canvas.school.edu');
    expect(normalizeHost('school.instructure.com')).toBe('school.instructure.com');
    expect(normalizeHost('  school.instructure.com  ')).toBe('school.instructure.com');
  });
});

describe('config: authBase + apiBaseUrl', () => {
  it('builds the OAuth login origin from a host', () => {
    expect(authBase('school.instructure.com')).toBe('https://school.instructure.com');
    expect(authBase('https://school.instructure.com/')).toBe('https://school.instructure.com');
  });
  it('builds the /api/v1 REST root from a host', () => {
    expect(apiBaseUrl('school.instructure.com')).toBe('https://school.instructure.com/api/v1');
    expect(apiBaseUrl('canvas.school.edu')).toBe('https://canvas.school.edu/api/v1');
  });
});

describe('config: scopes', () => {
  it('requests no scopes by default (works with or without scope enforcement)', () => {
    expect(OAUTH_SCOPES).toEqual([]);
  });
  it('documents the granular read + write scopes for enforcement', () => {
    expect(RECOMMENDED_SCOPES.length).toBeGreaterThan(5);
    expect(RECOMMENDED_SCOPES).toContain('url:GET|/api/v1/courses');
    expect(RECOMMENDED_SCOPES.some((s) => s.startsWith('url:PUT|'))).toBe(true);
    expect(RECOMMENDED_SCOPES.some((s) => s.startsWith('url:POST|'))).toBe(true);
  });
});

describe('config: readServerConfig', () => {
  const base = {
    CANVAS_HOST: 'school.instructure.com',
    CANVAS_CLIENT_ID: 'cid',
    CANVAS_CLIENT_SECRET: 'secret',
    CANVAS_REDIRECT_URI: 'https://canvas.hanzo.ai/oauth/callback',
  };

  it('reads a full config, normalizing the host and defaulting the port to 8791', () => {
    const cfg = readServerConfig({ ...base, CANVAS_HOST: 'https://school.instructure.com/' });
    expect(cfg.canvasHost).toBe('school.instructure.com');
    expect(cfg.canvasClientId).toBe('cid');
    expect(cfg.canvasClientSecret).toBe('secret');
    expect(cfg.canvasRedirectUri).toBe('https://canvas.hanzo.ai/oauth/callback');
    expect(cfg.port).toBe(8791);
  });

  it('honours PORT', () => {
    expect(readServerConfig({ ...base, PORT: '9002' }).port).toBe(9002);
  });

  it('throws listing every missing required value', () => {
    expect(() => readServerConfig({})).toThrow(/CANVAS_HOST/);
    expect(() => readServerConfig({})).toThrow(/CANVAS_CLIENT_ID/);
    expect(() => readServerConfig({})).toThrow(/CANVAS_CLIENT_SECRET/);
    expect(() => readServerConfig({})).toThrow(/CANVAS_REDIRECT_URI/);
    expect(() => readServerConfig({ CANVAS_HOST: 'h' })).toThrow(
      /CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REDIRECT_URI/,
    );
  });
});
