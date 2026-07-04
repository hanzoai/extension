import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  chatCompletionsURL,
  modelsURL,
  clioBase,
  clioApiRoot,
  clioAuthorizeURL,
  clioTokenURL,
  CLIO_REGION_BASES,
  CLIO_API_VERSION,
  CLIO_SCOPES,
  DEFAULT_MODEL,
} from '../src/config';

describe('Hanzo gateway endpoints', () => {
  it('chat + models go through api.hanzo.ai/v1 with no /api/ prefix', () => {
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).not.toContain('/api/');
    expect(DEFAULT_MODEL).toBe('zen-1');
  });
});

describe('Clio regional bases', () => {
  it('maps every region to its documented host', () => {
    expect(CLIO_REGION_BASES.us).toBe('https://app.clio.com');
    expect(CLIO_REGION_BASES.eu).toBe('https://eu.app.clio.com');
    expect(CLIO_REGION_BASES.au).toBe('https://au.app.clio.com');
    expect(CLIO_REGION_BASES.ca).toBe('https://ca.app.clio.com');
  });

  it('clioBase defaults to US and resolves each region', () => {
    expect(clioBase()).toBe('https://app.clio.com');
    expect(clioBase('eu')).toBe('https://eu.app.clio.com');
    expect(clioBase('au')).toBe('https://au.app.clio.com');
    expect(clioBase('ca')).toBe('https://ca.app.clio.com');
  });

  it('clioBase honors an explicit override and strips trailing slashes', () => {
    expect(clioBase('us', 'https://firm.clio.example///')).toBe('https://firm.clio.example');
  });

  it('falls back to US for an unknown region', () => {
    // @ts-expect-error — exercising the defensive default
    expect(clioBase('xx')).toBe('https://app.clio.com');
  });
});

describe('Clio derived endpoints', () => {
  const base = clioBase('us');
  it('builds the REST v4 root and both OAuth endpoints', () => {
    expect(clioApiRoot(base)).toBe('https://app.clio.com/api/v4');
    expect(clioAuthorizeURL(base)).toBe('https://app.clio.com/oauth/authorize');
    expect(clioTokenURL(base)).toBe('https://app.clio.com/oauth/token');
  });
  it('uses eu host when built from the eu base', () => {
    const eu = clioBase('eu');
    expect(clioApiRoot(eu)).toBe('https://eu.app.clio.com/api/v4');
    expect(clioTokenURL(eu)).toBe('https://eu.app.clio.com/oauth/token');
  });
  it('pins the API version and requests read+write scopes', () => {
    expect(CLIO_API_VERSION).toBe('4.0.11');
    expect(CLIO_SCOPES).toBe('read write');
  });
});
