import { describe, it, expect } from 'vitest';
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  APIKEY_STORAGE_KEY,
  PEOPLE_CHAR_BUDGET,
  pickBearer,
  chatCompletionsURL,
  modelsURL,
  normHost,
  oauthBaseUrl,
  restPath,
  restUrl,
  raasPath,
  raasUrl,
  STAFFING,
  RECRUITING,
  ABSENCE,
  COMMON,
  isWorkdayEnv,
  isSandboxHost,
  readServerConfig,
} from '../src/config.js';

const HOST = 'https://wd2-impl-services1.workday.com';
const TENANT = 'acme';

describe('config: gateway constants', () => {
  it('points at api.hanzo.ai with /v1 paths and never /api/', () => {
    expect(HANZO_API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(chatCompletionsURL()).not.toContain('/api/');
  });

  it('defaults to a zen model and a sane budget', () => {
    expect(DEFAULT_MODEL).toBe('zen5');
    expect(PEOPLE_CHAR_BUDGET).toBeGreaterThan(10_000);
    expect(APIKEY_STORAGE_KEY).toContain('workday');
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

describe('config: normHost', () => {
  it('strips one or many trailing slashes', () => {
    expect(normHost('https://x.workday.com/')).toBe('https://x.workday.com');
    expect(normHost('https://x.workday.com///')).toBe('https://x.workday.com');
    expect(normHost('https://x.workday.com')).toBe('https://x.workday.com');
  });
});

describe('config: service descriptors', () => {
  it('pins each Workday REST service + version', () => {
    expect(STAFFING).toEqual({ api: 'staffing', version: 'v6' });
    expect(RECRUITING).toEqual({ api: 'recruiting', version: 'v4' });
    expect(ABSENCE).toEqual({ api: 'absenceManagement', version: 'v1' });
    expect(COMMON).toEqual({ api: 'common', version: 'v1' });
  });
});

describe('config: OAuth + REST + RaaS URL builders', () => {
  it('builds the tenant OAuth root', () => {
    expect(oauthBaseUrl(HOST, TENANT)).toBe(
      'https://wd2-impl-services1.workday.com/ccx/oauth2/acme',
    );
  });
  it('normalizes a trailing slash on the host in every builder', () => {
    expect(oauthBaseUrl(HOST + '/', TENANT)).toBe(oauthBaseUrl(HOST, TENANT));
    expect(restUrl(HOST + '/', TENANT, STAFFING, '/workers')).toBe(
      restUrl(HOST, TENANT, STAFFING, '/workers'),
    );
  });
  it('builds a host-relative REST path with service + version + tenant', () => {
    expect(restPath(TENANT, STAFFING, '/workers')).toBe('/ccx/api/staffing/v6/acme/workers');
    expect(restPath(TENANT, RECRUITING, '/jobRequisitions')).toBe(
      '/ccx/api/recruiting/v4/acme/jobRequisitions',
    );
    expect(restPath(TENANT, ABSENCE)).toBe('/ccx/api/absenceManagement/v1/acme');
  });
  it('builds an absolute REST url', () => {
    expect(restUrl(HOST, TENANT, STAFFING, '/workers/123')).toBe(
      'https://wd2-impl-services1.workday.com/ccx/api/staffing/v6/acme/workers/123',
    );
  });
  it('builds the RaaS custom-report path + url', () => {
    expect(raasPath(TENANT, 'lmcneil', 'Team_Time_Off')).toBe(
      '/ccx/service/customreport2/acme/lmcneil/Team_Time_Off',
    );
    expect(raasUrl(HOST, TENANT, 'lmcneil', 'Team_Time_Off')).toBe(
      'https://wd2-impl-services1.workday.com/ccx/service/customreport2/acme/lmcneil/Team_Time_Off',
    );
  });
});

describe('config: isWorkdayEnv', () => {
  it('accepts the two environments', () => {
    expect(isWorkdayEnv('production')).toBe(true);
    expect(isWorkdayEnv('sandbox')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isWorkdayEnv('impl')).toBe(false);
    expect(isWorkdayEnv(undefined)).toBe(false);
  });
});

describe('config: isSandboxHost', () => {
  it('detects an implementation host by -impl', () => {
    expect(isSandboxHost('https://wd2-impl-services1.workday.com')).toBe(true);
    expect(isSandboxHost('https://impl.workday.com')).toBe(false);
    expect(isSandboxHost('https://services1.myworkday.com')).toBe(false);
  });
});

describe('config: readServerConfig', () => {
  const base = {
    WORKDAY_HOST: HOST,
    WORKDAY_TENANT: TENANT,
    WORKDAY_CLIENT_ID: 'cid',
    WORKDAY_CLIENT_SECRET: 'secret',
    WORKDAY_REDIRECT_URI: 'https://workday.hanzo.ai/oauth/callback',
  };

  it('reads a full config, defaulting env to sandbox and port to 8791', () => {
    const cfg = readServerConfig(base);
    expect(cfg.workdayHost).toBe(HOST);
    expect(cfg.workdayTenant).toBe('acme');
    expect(cfg.workdayClientId).toBe('cid');
    expect(cfg.workdayClientSecret).toBe('secret');
    expect(cfg.workdayRedirectUri).toBe('https://workday.hanzo.ai/oauth/callback');
    expect(cfg.workdayEnv).toBe('sandbox');
    expect(cfg.port).toBe(8791);
  });

  it('normalizes a trailing slash on the host', () => {
    const cfg = readServerConfig({ ...base, WORKDAY_HOST: HOST + '/' });
    expect(cfg.workdayHost).toBe(HOST);
  });

  it('honours WORKDAY_ENV and PORT', () => {
    const cfg = readServerConfig({ ...base, WORKDAY_ENV: 'production', PORT: '9002' });
    expect(cfg.workdayEnv).toBe('production');
    expect(cfg.port).toBe(9002);
  });

  it('coerces an unknown WORKDAY_ENV to sandbox', () => {
    expect(readServerConfig({ ...base, WORKDAY_ENV: 'staging' }).workdayEnv).toBe('sandbox');
  });

  it('throws listing every missing required value', () => {
    expect(() => readServerConfig({})).toThrow(/WORKDAY_HOST/);
    expect(() => readServerConfig({})).toThrow(/WORKDAY_TENANT/);
    expect(() => readServerConfig({})).toThrow(/WORKDAY_CLIENT_ID/);
    expect(() => readServerConfig({})).toThrow(/WORKDAY_CLIENT_SECRET/);
    expect(() => readServerConfig({})).toThrow(/WORKDAY_REDIRECT_URI/);
    expect(() => readServerConfig({ WORKDAY_HOST: HOST })).toThrow(
      /WORKDAY_TENANT, WORKDAY_CLIENT_ID, WORKDAY_CLIENT_SECRET, WORKDAY_REDIRECT_URI/,
    );
  });
});
