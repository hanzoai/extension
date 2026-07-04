import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  crmApiRoot,
  hubspotAuthorizeURL,
  hubspotTokenURL,
  isObjectType,
  SUPPORTED_OBJECT_TYPES,
  RECORD_CHAR_BUDGET,
} from '../src/config.js';

describe('Hanzo gateway config', () => {
  it('points at api.hanzo.ai with no /api/ prefix', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(HANZO_API_BASE_URL).not.toContain('/api/');
  });
  it('defaults to a zen model', () => {
    expect(DEFAULT_MODEL).toMatch(/^zen/);
  });
});

describe('HubSpot endpoints', () => {
  it('crmApiRoot is /crm/v3 on the api host', () => {
    expect(crmApiRoot()).toBe('https://api.hubapi.com/crm/v3');
  });
  it('authorize is on the app host, token is on the api host', () => {
    expect(hubspotAuthorizeURL()).toBe('https://app.hubspot.com/oauth/authorize');
    expect(hubspotTokenURL()).toBe('https://api.hubapi.com/oauth/v1/token');
  });
});

describe('isObjectType', () => {
  it('accepts the three supported types', () => {
    for (const t of SUPPORTED_OBJECT_TYPES) expect(isObjectType(t)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isObjectType('tickets')).toBe(false);
    expect(isObjectType(undefined)).toBe(false);
    expect(isObjectType('')).toBe(false);
  });
});

describe('RECORD_CHAR_BUDGET', () => {
  it('is a sane positive cap', () => {
    expect(RECORD_CHAR_BUDGET).toBeGreaterThan(1000);
  });
});
