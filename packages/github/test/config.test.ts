import { describe, it, expect } from 'vitest';
import {
  loadConfig,
  normalizePrivateKey,
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_MAX_DIFF_CHARS,
  GITHUB_APP_PERMISSIONS,
  GITHUB_APP_EVENTS,
} from '../src/config.js';

const base = {
  GITHUB_APP_ID: '12345',
  GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
  GITHUB_WEBHOOK_SECRET: 'whsec',
};

describe('loadConfig', () => {
  it('loads required GitHub credentials and applies Hanzo defaults', () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.github.appId).toBe('12345');
    expect(c.github.webhookSecret).toBe('whsec');
    expect(c.hanzo.baseURL).toBe(HANZO_API_BASE_URL);
    expect(c.hanzo.apiKey).toBe('');
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(c.maxDiffChars).toBe(DEFAULT_MAX_DIFF_CHARS);
    expect(c.port).toBe(3000);
  });

  it.each(['GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET'])(
    'throws when %s is missing',
    (key) => {
      const env = { ...base } as Record<string, string>;
      delete env[key];
      expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(new RegExp(key));
    },
  );

  it('reads overrides for model, base url, api key, and diff budget', () => {
    const c = loadConfig({
      ...base,
      HANZO_API_BASE_URL: 'https://gw.example.com',
      HANZO_API_KEY: 'hk-abc',
      HANZO_MODEL: 'zen5-coder',
      HANZO_MAX_DIFF_CHARS: '500',
      PORT: '8080',
    } as NodeJS.ProcessEnv);
    expect(c.hanzo.baseURL).toBe('https://gw.example.com');
    expect(c.hanzo.apiKey).toBe('hk-abc');
    expect(c.model).toBe('zen5-coder');
    expect(c.maxDiffChars).toBe(500);
    expect(c.port).toBe(8080);
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ ...base, PORT: 'nope' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PORT: '0' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
  });

  it('rejects an invalid HANZO_MAX_DIFF_CHARS', () => {
    expect(() =>
      loadConfig({ ...base, HANZO_MAX_DIFF_CHARS: '-1' } as NodeJS.ProcessEnv),
    ).toThrow(/MAX_DIFF_CHARS/);
  });
});

describe('normalizePrivateKey', () => {
  it('restores escaped newlines from a one-line env var', () => {
    expect(normalizePrivateKey('a\\nb\\nc')).toBe('a\nb\nc');
  });

  it('leaves a real multi-line PEM untouched', () => {
    const pem = '-----BEGIN-----\nkey\n-----END-----';
    expect(normalizePrivateKey(pem)).toBe(pem);
  });
});

describe('exported app manifest', () => {
  it('declares the exact permissions the README documents', () => {
    expect(GITHUB_APP_PERMISSIONS).toEqual({
      pull_requests: 'write',
      issues: 'write',
      contents: 'read',
      metadata: 'read',
    });
  });

  it('subscribes to pull_request, issues, and issue_comment', () => {
    expect(GITHUB_APP_EVENTS).toEqual(['pull_request', 'issues', 'issue_comment']);
  });
});
