/**
 * Centralized configuration — single source of truth for all endpoints,
 * client IDs, ports, and defaults across Chrome / Firefox / Safari.
 *
 * All values are configurable via chrome.storage.local (or browser.storage.local).
 * Storage keys follow the convention: hanzo_config_{key}
 *
 * Priority: storage override > environment-injected > compile-time default
 */

// ── IAM / Auth ─────────────────────────────────────────────────────────

/** Login UI domain (Hanzo ID) */
export const IAM_LOGIN_URL = 'https://hanzo.id';

/** IAM API domain (Hanzo IAM backend, fronted by Hanzo's API gateway) */
export const IAM_API_URL = 'https://iam.hanzo.ai';

/**
 * IAM API path prefix. Hanzo convention is `/v1/<service>/<endpoint>` — never
 * `/api/`. The Hanzo IAM upstream uses `/api/*` natively but the prod gateway
 * rewrites `/v1/iam/*` → upstream. Always reference endpoints through this
 * constant so prefix changes are a single edit.
 */
export const IAM_API_PATH = '/v1/iam';

/** OAuth2 client ID — override via storage key 'hanzo_config_client_id' */
export const DEFAULT_CLIENT_ID = 'app-hanzo';

/** OAuth2 scopes */
export const DEFAULT_SCOPES = 'openid profile email';

/** OAuth redirect URI — override via storage key 'hanzo_config_redirect_uri' */
export const DEFAULT_REDIRECT_URI = 'https://hanzo.ai/callback';

/** Token storage keys (matching @hanzo/iam SDK convention) */
export const STORAGE_KEYS = {
  accessToken: 'hanzo_iam_access_token',
  refreshToken: 'hanzo_iam_refresh_token',
  idToken: 'hanzo_iam_id_token',
  expiresAt: 'hanzo_iam_expires_at',
  user: 'hanzo_iam_user',
} as const;

// ── Hanzo Cloud API ────────────────────────────────────────────────────

/** Cloud API base — override via storage key 'hanzo_config_api_base' */
export const API_BASE_URL = 'https://api.hanzo.ai';

// ── KMS (Secrets Management) ──────────────────────────────────────────

/** KMS API base — override via storage key 'hanzo_config_kms_url' */
export const KMS_API_URL = 'https://kms.hanzo.ai';

// ── Local Provider Defaults ────────────────────────────────────────────

export const LOCAL_PROVIDER_DEFAULTS = {
  ollama: { name: 'Ollama', url: 'http://localhost:11434', probePorts: [11434] },
  lmstudio: { name: 'LM Studio', url: 'http://localhost:1234/v1', probePorts: [1234] },
  'hanzo-desktop': { name: 'Hanzo Desktop', url: 'http://localhost:11435', probePorts: [11435, 9550] },
  'hanzo-node': { name: 'Hanzo Node', url: 'http://localhost:3690', probePorts: [3690, 8080] },
} as const;

// ── Infrastructure Ports ───────────────────────────────────────────────

export const DEFAULT_MCP_PORT = 3001;
export const DEFAULT_CDP_PORT = 9223;
export const DEFAULT_CDP_BRIDGE_PORT = 9224;

// ── RAG defaults ───────────────────────────────────────────────────────

export const DEFAULT_RAG_TOP_K = 5;

// ── Cache / Timing ─────────────────────────────────────────────────────

export const MODEL_CACHE_TTL_MS = 60 * 1000;

// ── Brand URLs (for UI links — not API calls) ──────────────────────────

export const BRAND_URLS = {
  console: 'https://console.hanzo.ai',
  billing: 'https://billing.hanzo.ai',
  docs: 'https://docs.hanzo.ai',
  homepage: 'https://hanzo.ai',
  register: 'https://hanzo.id/register',
  forgotPassword: 'https://hanzo.id/forgot',
} as const;

// ── Runtime Config Loader ──────────────────────────────────────────────

export interface RuntimeConfig {
  iamLoginUrl: string;
  iamApiUrl: string;
  apiBaseUrl: string;
  kmsApiUrl: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  cdpBridgePort: number;
}

const CONFIG_STORAGE_MAP: Record<keyof RuntimeConfig, { key: string; fallback: string | number }> = {
  iamLoginUrl: { key: 'hanzo_config_iam_login_url', fallback: IAM_LOGIN_URL },
  iamApiUrl: { key: 'hanzo_config_iam_api_url', fallback: IAM_API_URL },
  apiBaseUrl: { key: 'hanzo_config_api_base', fallback: API_BASE_URL },
  kmsApiUrl: { key: 'hanzo_config_kms_url', fallback: KMS_API_URL },
  clientId: { key: 'hanzo_config_client_id', fallback: DEFAULT_CLIENT_ID },
  scopes: { key: 'hanzo_config_scopes', fallback: DEFAULT_SCOPES },
  redirectUri: { key: 'hanzo_config_redirect_uri', fallback: DEFAULT_REDIRECT_URI },
  cdpBridgePort: { key: 'hanzo_config_cdp_bridge_port', fallback: DEFAULT_CDP_BRIDGE_PORT },
};

/**
 * Load runtime configuration from extension storage.
 * Any value can be overridden by setting the corresponding storage key.
 *
 * Accepts both the raw chrome.storage.local object (callback-based) and the
 * BrowserStorage adapter (Promise-based). Uses await so both work correctly.
 */
export async function loadRuntimeConfig(
  storage: { get(keys: string[]): Promise<Record<string, any>> } | typeof chrome.storage.local,
): Promise<RuntimeConfig> {
  const keys = Object.values(CONFIG_STORAGE_MAP).map(v => v.key);

  // Use Promise-based API (works with BrowserStorage adapter AND MV3 chrome.storage.local)
  const result: Record<string, any> = await (storage as any).get(keys);

  const config = {} as RuntimeConfig;
  for (const [field, { key, fallback }] of Object.entries(CONFIG_STORAGE_MAP)) {
    const stored = result[key];
    if (stored !== undefined && stored !== null && stored !== '') {
      (config as any)[field] = typeof fallback === 'number' ? Number(stored) : String(stored);
    } else {
      (config as any)[field] = fallback;
    }
  }
  return config;
}
