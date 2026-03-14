import { describe, it, expect, vi } from 'vitest';
import {
  IAM_LOGIN_URL,
  IAM_API_URL,
  API_BASE_URL,
  KMS_API_URL,
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPES,
  DEFAULT_REDIRECT_URI,
  STORAGE_KEYS,
  LOCAL_PROVIDER_DEFAULTS,
  DEFAULT_MCP_PORT,
  DEFAULT_CDP_PORT,
  DEFAULT_CDP_BRIDGE_PORT,
  DEFAULT_RAG_TOP_K,
  MODEL_CACHE_TTL_MS,
  BRAND_URLS,
  loadRuntimeConfig,
} from '../src/shared/config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('IAM constants', () => {
  it('IAM_LOGIN_URL is hanzo.id', () => {
    expect(IAM_LOGIN_URL).toBe('https://hanzo.id');
  });

  it('IAM_API_URL is iam.hanzo.ai', () => {
    expect(IAM_API_URL).toBe('https://iam.hanzo.ai');
  });

  it('API_BASE_URL is api.hanzo.ai', () => {
    expect(API_BASE_URL).toBe('https://api.hanzo.ai');
  });

  it('KMS_API_URL is kms.hanzo.ai', () => {
    expect(KMS_API_URL).toBe('https://kms.hanzo.ai');
  });

  it('DEFAULT_CLIENT_ID is app-hanzo', () => {
    expect(DEFAULT_CLIENT_ID).toBe('app-hanzo');
  });

  it('DEFAULT_SCOPES includes openid', () => {
    expect(DEFAULT_SCOPES).toContain('openid');
  });

  it('DEFAULT_REDIRECT_URI is hanzo.ai/callback', () => {
    expect(DEFAULT_REDIRECT_URI).toBe('https://hanzo.ai/callback');
  });
});

describe('STORAGE_KEYS', () => {
  it('has all required keys', () => {
    expect(STORAGE_KEYS.accessToken).toBe('hanzo_iam_access_token');
    expect(STORAGE_KEYS.refreshToken).toBe('hanzo_iam_refresh_token');
    expect(STORAGE_KEYS.idToken).toBe('hanzo_iam_id_token');
    expect(STORAGE_KEYS.expiresAt).toBe('hanzo_iam_expires_at');
    expect(STORAGE_KEYS.user).toBe('hanzo_iam_user');
  });

  it('all values follow hanzo_iam_ prefix convention', () => {
    for (const val of Object.values(STORAGE_KEYS)) {
      expect(val).toMatch(/^hanzo_iam_/);
    }
  });
});

describe('LOCAL_PROVIDER_DEFAULTS', () => {
  it('has all 4 providers', () => {
    expect(Object.keys(LOCAL_PROVIDER_DEFAULTS)).toHaveLength(4);
    expect(LOCAL_PROVIDER_DEFAULTS).toHaveProperty('ollama');
    expect(LOCAL_PROVIDER_DEFAULTS).toHaveProperty('lmstudio');
    expect(LOCAL_PROVIDER_DEFAULTS).toHaveProperty('hanzo-desktop');
    expect(LOCAL_PROVIDER_DEFAULTS).toHaveProperty('hanzo-node');
  });

  it('each provider has name, url, probePorts', () => {
    for (const provider of Object.values(LOCAL_PROVIDER_DEFAULTS)) {
      expect(provider.name).toBeTruthy();
      expect(provider.url).toMatch(/^http:\/\/localhost:/);
      expect(Array.isArray(provider.probePorts)).toBe(true);
      expect(provider.probePorts.length).toBeGreaterThan(0);
    }
  });
});

describe('Infrastructure ports', () => {
  it('ports are defined', () => {
    expect(DEFAULT_MCP_PORT).toBe(3001);
    expect(DEFAULT_CDP_PORT).toBe(9223);
    expect(DEFAULT_CDP_BRIDGE_PORT).toBe(9224);
  });
});

describe('BRAND_URLS', () => {
  it('has all required URLs', () => {
    expect(BRAND_URLS.console).toContain('console.hanzo.ai');
    expect(BRAND_URLS.billing).toContain('billing.hanzo.ai');
    expect(BRAND_URLS.docs).toContain('docs.hanzo.ai');
    expect(BRAND_URLS.homepage).toBe('https://hanzo.ai');
  });
});

// ---------------------------------------------------------------------------
// loadRuntimeConfig
// ---------------------------------------------------------------------------

describe('loadRuntimeConfig', () => {
  it('returns defaults when storage is empty', async () => {
    const mockStorage = {
      get: vi.fn(async (_keys: string[]) => ({})),
    };

    const config = await loadRuntimeConfig(mockStorage as any);
    expect(config.iamLoginUrl).toBe(IAM_LOGIN_URL);
    expect(config.iamApiUrl).toBe(IAM_API_URL);
    expect(config.apiBaseUrl).toBe(API_BASE_URL);
    expect(config.kmsApiUrl).toBe(KMS_API_URL);
    expect(config.clientId).toBe(DEFAULT_CLIENT_ID);
    expect(config.scopes).toBe(DEFAULT_SCOPES);
    expect(config.redirectUri).toBe(DEFAULT_REDIRECT_URI);
    expect(config.cdpBridgePort).toBe(DEFAULT_CDP_BRIDGE_PORT);
  });

  it('reads overrides from storage', async () => {
    const mockStorage = {
      get: vi.fn(async (_keys: string[]) => ({
        hanzo_config_iam_login_url: 'https://custom.hanzo.id',
        hanzo_config_api_base: 'https://custom.api.hanzo.ai',
        hanzo_config_kms_url: 'https://custom.kms.hanzo.ai',
      })),
    };

    const config = await loadRuntimeConfig(mockStorage as any);
    expect(config.iamLoginUrl).toBe('https://custom.hanzo.id');
    expect(config.apiBaseUrl).toBe('https://custom.api.hanzo.ai');
    expect(config.kmsApiUrl).toBe('https://custom.kms.hanzo.ai');
    // Non-overridden fields use defaults
    expect(config.clientId).toBe(DEFAULT_CLIENT_ID);
  });

  it('ignores empty string overrides', async () => {
    const mockStorage = {
      get: vi.fn(async (_keys: string[]) => ({
        hanzo_config_iam_login_url: '',
      })),
    };

    const config = await loadRuntimeConfig(mockStorage as any);
    expect(config.iamLoginUrl).toBe(IAM_LOGIN_URL);
  });
});
