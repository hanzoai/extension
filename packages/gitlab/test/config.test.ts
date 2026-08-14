import { describe, it, expect } from 'vitest';
import {
  loadConfig,
  HANZO_API_BASE_URL,
  DEFAULT_GITLAB_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_MAX_DIFF_CHARS,
  GITLAB_TOKEN_SCOPES,
  GITLAB_WEBHOOK_TRIGGERS,
} from '../src/config.js';

const base = {
  GITLAB_TOKEN: 'glpat-abc',
  GITLAB_WEBHOOK_SECRET: 'whsec',
};

describe('loadConfig', () => {
  it('loads required GitLab credentials and applies defaults', () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.gitlab.token).toBe('glpat-abc');
    expect(c.gitlab.webhookSecret).toBe('whsec');
    expect(c.gitlab.baseURL).toBe(DEFAULT_GITLAB_BASE_URL);
    expect(c.hanzo.baseURL).toBe(HANZO_API_BASE_URL);
    expect(c.hanzo.apiKey).toBe('');
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(c.maxDiffChars).toBe(DEFAULT_MAX_DIFF_CHARS);
    expect(c.port).toBe(3000);
  });

  it.each(['GITLAB_TOKEN', 'GITLAB_WEBHOOK_SECRET'])('throws when %s is missing', (key) => {
    const env = { ...base } as Record<string, string>;
    delete env[key];
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(new RegExp(key));
  });

  it('reads a self-managed base url and Hanzo overrides', () => {
    const c = loadConfig({
      ...base,
      GITLAB_BASE_URL: 'https://gitlab.acme.internal',
      HANZO_API_BASE_URL: 'https://gw.example.com',
      HANZO_API_KEY: 'sk-abc',
      HANZO_MODEL: 'zen5-coder',
      HANZO_MAX_DIFF_CHARS: '500',
      PORT: '8080',
    } as NodeJS.ProcessEnv);
    expect(c.gitlab.baseURL).toBe('https://gitlab.acme.internal');
    expect(c.hanzo.baseURL).toBe('https://gw.example.com');
    expect(c.hanzo.apiKey).toBe('sk-abc');
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

describe('exported service manifest', () => {
  it('declares the exact token scope the README documents', () => {
    expect(GITLAB_TOKEN_SCOPES).toEqual(['api']);
  });

  it('subscribes to merge request, issue, and note events', () => {
    expect(GITLAB_WEBHOOK_TRIGGERS).toEqual([
      'merge_requests_events',
      'issues_events',
      'note_events',
    ]);
  });
});
