/**
 * Environment configuration — the process boundary.
 *
 * Secrets live in the environment, never in source or the repo. `loadConfig`
 * reads them once, validates them, and returns a frozen {@link Config}. Every
 * other module takes config as an argument and never touches `process.env`, so
 * they stay pure and testable.
 */

/** Default catalog shown in the model picker when `HANZO_MODELS` is unset. */
export const DEFAULT_MODELS = ['zen-eco-3b', 'zen-mini-8b', 'zen-4b'] as const;

/** Resolved, validated configuration for the Teams app. */
export interface Config {
  /** Azure Bot registration app id (Bot Framework `MicrosoftAppId`). */
  appId: string;
  /** Azure Bot registration secret (Bot Framework `MicrosoftAppPassword`). */
  appPassword: string;
  /** Azure AD tenant id. Empty for the multi-tenant `MultiTenant` type. */
  appTenantId: string;
  /** Bot app type: `MultiTenant` (default), `SingleTenant`, or `UserAssignedMSI`. */
  appType: string;
  /** Hanzo API key sent as the bearer token to api.hanzo.ai. */
  hanzoApiKey: string;
  /** AI base URL. `@hanzo/ai` defaults to https://api.hanzo.ai; override for dev. */
  hanzoBaseUrl?: string;
  /** Model ids offered in the picker. */
  models: string[];
  /** Default model id (first of {@link models} unless overridden). */
  defaultModel: string;
  /** HTTP port for the messaging endpoint. */
  port: number;
}

/** Raw environment record. `process.env` shape without a hard `process` dep. */
export type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Set it in the environment (never commit secrets); see README.`,
    );
  }
  return v;
}

function models(env: Env): string[] {
  const raw = env.HANZO_MODELS;
  if (!raw) return [...DEFAULT_MODELS];
  const list = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_MODELS];
}

function port(env: Env): number {
  const raw = env.PORT?.trim();
  if (!raw) return 3978;
  // Strict: reject trailing garbage ("80x", "3978 #http") that parseInt accepts.
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid PORT ${env.PORT}: expected an integer in 1..65535.`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT ${env.PORT}: expected an integer in 1..65535.`);
  }
  return n;
}

/**
 * Read and validate configuration from an environment record.
 *
 * `MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD`, and `HANZO_API_KEY` are
 * required; everything else has a safe default. Throws on missing required
 * vars or a malformed `PORT` — fail loud at startup, never at request time.
 */
export function loadConfig(env: Env = process.env): Config {
  const list = models(env);
  const first = list[0];
  if (!first) throw new Error('HANZO_MODELS resolved to an empty list.');
  const defaultModel = env.HANZO_DEFAULT_MODEL?.trim() || first;
  if (!list.includes(defaultModel)) {
    throw new Error(
      `HANZO_DEFAULT_MODEL ${defaultModel} is not in HANZO_MODELS (${list.join(', ')}).`,
    );
  }

  return Object.freeze({
    appId: required(env, 'MICROSOFT_APP_ID'),
    appPassword: required(env, 'MICROSOFT_APP_PASSWORD'),
    appTenantId: env.MICROSOFT_APP_TENANT_ID?.trim() ?? '',
    appType: env.MICROSOFT_APP_TYPE?.trim() || 'MultiTenant',
    hanzoApiKey: required(env, 'HANZO_API_KEY'),
    hanzoBaseUrl: env.HANZO_BASE_URL?.trim() || undefined,
    models: list,
    defaultModel,
    port: port(env),
  });
}
