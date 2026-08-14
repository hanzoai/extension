// Procore config — the two host sets (production vs sandbox), the Procore REST
// API version segment, the api.hanzo.ai model gateway, and the server-side
// secret set (Procore OAuth). Endpoints and the bearer choice mirror
// @hanzo/docusign and @hanzo/clio so the productivity suite stays DRY; the
// construction-specific pieces (project-context windowing, the AI actions) live
// in project.ts / hanzo.ts / actions.ts, not here.

// ---- Hanzo model gateway --------------------------------------------------

// Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. /v1 only,
// never an /api/ prefix (api.hanzo.ai IS the api host).
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

// Default model. A Zen model (qwen3+). Overridable per-request via the picker;
// the gateway routes it.
export const DEFAULT_MODEL = 'zen5';

// Public IAM origin that mints Hanzo user tokens, and the OAuth client id an
// inbound Hanzo token is audienced to (owner-scoping validation via @hanzo/iam).
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-procore';

// localStorage key for the pasted Hanzo API key (`sk-…`) in the web panel. The
// panel is a static web page (iframe), not a host with roamingSettings, so the
// zero-setup credential lives in localStorage — same as @hanzo/docusign.
export const APIKEY_STORAGE_KEY = 'hanzo.procore.apiKey';

// Project text budget. A busy project has many RFIs, submittals, and daily-log
// entries; the whole corpus won't fit a model window and shouldn't be sent.
// This caps the characters of project text we attach to any one request — chosen
// so it fits comfortably inside a modern context window alongside the reply, and
// is honest rather than optimal (we truncate visibly, never drop silently).
export const PROJECT_CHAR_BUDGET = 60_000;

// pickBearer chooses the credential to send to the Hanzo gateway: a pasted API
// key wins over an OAuth token (an explicit key is a deliberate override), else
// the token, else empty (anonymous — the gateway still serves public models).
// Pure — unit-tested.
export function pickBearer(apiKey: string, oauthToken: string): string {
  return (apiKey && apiKey.trim()) || (oauthToken && oauthToken.trim()) || '';
}

// chatCompletionsURL / modelsURL — the model gateway endpoints.
export function chatCompletionsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/models`;
}

// ---- Procore OAuth + API hosts --------------------------------------------
//
// Procore has two environments, each a fixed triple of hosts: the OAuth login
// host (authorize + token), the REST API host, and the app host. We never
// hard-code a single host inline — every URL is built from the selected
// environment's host set, so switching sandbox↔production is one env value.
//
//   production: login.procore.com    api.procore.com          app.procore.com
//   sandbox:    login-sandbox.procore.com  sandbox.procore.com  (per-company)
//
// Docs: developers.procore.com/documentation/oauth-introduction and
// developers.procore.com/reference/rest/docs/rest-api-overview.

export interface ProcoreHosts {
  /** OAuth login host — /oauth/authorize and /oauth/token live here. */
  login: string;
  /** REST API host — /rest/v1.0/... lives here. */
  api: string;
}

export const PROCORE_HOSTS = {
  production: {
    login: 'https://login.procore.com',
    api: 'https://api.procore.com',
  },
  sandbox: {
    login: 'https://login-sandbox.procore.com',
    api: 'https://sandbox.procore.com',
  },
} as const satisfies Record<string, ProcoreHosts>;

// Which environment is a Procore env value.
export type ProcoreEnv = keyof typeof PROCORE_HOSTS;

// hosts resolves the host set for an environment.
export function hosts(env: ProcoreEnv): ProcoreHosts {
  return PROCORE_HOSTS[env];
}

// The REST API version segment. v1.0 is current for the resources we read
// (projects, RFIs, submittals, documents, observations, daily logs); we never
// bump to a speculative v1.1 — one version, forward only.
export const REST_API_VERSION = 'v1.0';

// apiBaseUrl turns an environment into the REST root: `${api}/rest/v1.0`. Every
// Procore API call is built on top of this. Pure — the request wrappers in
// procore-api.ts take this string.
export function apiBaseUrl(env: ProcoreEnv): string {
  return `${hosts(env).api}/rest/${REST_API_VERSION}`;
}

// isProcoreEnv narrows an arbitrary string to a ProcoreEnv, defaulting unknown
// values to 'sandbox' (the safe, non-production environment). Boundary guard.
export function isProcoreEnv(v: string | undefined): v is ProcoreEnv {
  return v === 'production' || v === 'sandbox';
}

// The OAuth scopes the app requests. Procore's Authorization Code grant does not
// take a scope parameter for standard data-connection apps (permissions are
// granted per-company/tool in the Procore admin), but the account is included
// for completeness and forward-compat with fine-grained scopes.
export const OAUTH_SCOPES = [] as const;

// ---- Server-side configuration (Procore OAuth) ----------------------------
//
// These are read from the environment by src/server.ts. They NEVER reach the
// browser bundle: the client id is public, but the client secret is server-only
// and is validated to be present before the server will start (readServerConfig
// throws on a missing secret). This is the ONLY place the secret exists.

export interface ServerConfig {
  /** Procore OAuth client id (public). */
  procoreClientId: string;
  /** Procore OAuth client secret (SERVER ONLY — token exchange + refresh). */
  procoreClientSecret: string;
  /** OAuth redirect registered on the app (e.g. https://procore.hanzo.ai/oauth/callback). */
  procoreRedirectUri: string;
  /** Procore environment: 'sandbox' (login-sandbox) or 'production' (login). */
  procoreEnv: ProcoreEnv;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required Procore secret is missing —
// a server that cannot exchange OAuth codes must not pretend to start. Pure given
// an env map, so it is unit-tested without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const procoreClientId = env.PROCORE_CLIENT_ID;
  const procoreClientSecret = env.PROCORE_CLIENT_SECRET;
  const procoreRedirectUri = env.PROCORE_REDIRECT_URI;
  const missing: string[] = [];
  if (!procoreClientId) missing.push('PROCORE_CLIENT_ID');
  if (!procoreClientSecret) missing.push('PROCORE_CLIENT_SECRET');
  if (!procoreRedirectUri) missing.push('PROCORE_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    procoreClientId: procoreClientId!,
    procoreClientSecret: procoreClientSecret!,
    procoreRedirectUri: procoreRedirectUri!,
    procoreEnv: isProcoreEnv(env.PROCORE_ENV) ? env.PROCORE_ENV : 'sandbox',
    port: Number(env.PORT) || 8790,
  };
}
