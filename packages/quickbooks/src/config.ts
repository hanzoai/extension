// QuickBooks Online config — the api.hanzo.ai model gateway, the default model,
// the pasted-key storage for the web panel, and the server-side secret set
// (Intuit OAuth2 + the QBO API base). The gateway endpoints and bearer choice
// mirror @hanzo/docusign / @hanzo/pdf so the productivity suite stays DRY; the
// accounting-specific pieces (report → analysis text, the AI actions) live in
// finance.ts / hanzo.ts, not here.

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
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-quickbooks';

// localStorage key for the pasted Hanzo API key (`hk-…`) in the web panel. The
// panel is a static web page hosted behind hanzoai/ingress, not an Office host
// with roamingSettings, so the zero-setup credential lives in localStorage —
// same as @hanzo/docusign and @hanzo/pdf.
export const APIKEY_STORAGE_KEY = 'hanzo.quickbooks.apiKey';

// Financial-context budget. A P&L or a page of transactions serializes to a lot
// of JSON; the whole thing won't fit a model window and shouldn't be sent. This
// caps the characters of assembled analysis text we attach to any one request —
// chosen so it fits comfortably inside a modern context window alongside the
// reply, and is honest rather than optimal (we truncate visibly, never drop
// silently). finance.ts enforces it.
export const CONTEXT_CHAR_BUDGET = 60_000;

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

// ---- Intuit OAuth2 + QuickBooks Online API bases --------------------------
//
// Intuit runs ONE OAuth2 authorization server (appcenter + oauth.platform) for
// both sandbox and production; only the Accounting API host differs (sandbox vs
// prod). The environment therefore selects the API host, not the OAuth host.
// Docs: developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

// The Intuit OAuth2 authorization endpoint (browser consent screen). Single host
// for both environments.
export const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';

// The Intuit OAuth2 token endpoint (code→token + refresh). Single host.
export const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// The Intuit OAuth2 token-revocation endpoint (disconnect).
export const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

// The QuickBooks Online Accounting API v3 host, per environment. `sandbox` is
// the safe developer company; `production` is the live company.
export const QBO_API_HOST = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
} as const;

// Which environment is a QBO env value.
export type QboEnv = keyof typeof QBO_API_HOST;

// qboApiHost resolves the Accounting API origin for an environment.
export function qboApiHost(env: QboEnv): string {
  return QBO_API_HOST[env];
}

// The Accounting API version segment. v3 is current; we never bump to a
// speculative v4 — one version, forward only.
export const QBO_API_VERSION = 'v3';

// The minor version pins the exact QBO schema so a field we depend on cannot
// shift under us. Sent as the `minorversion` query param on every call.
export const QBO_MINOR_VERSION = '73';

// The OAuth scopes the app requests. The accounting scope grants the Accounting
// API; openid returns the id_token (identity) at token exchange.
export const OAUTH_SCOPES = ['com.intuit.quickbooks.accounting', 'openid'] as const;

// isQboEnv narrows an arbitrary string to a QboEnv, defaulting unknown values to
// 'sandbox' (the safe, non-production developer company). Boundary guard.
export function isQboEnv(v: string | undefined): v is QboEnv {
  return v === 'sandbox' || v === 'production';
}

// ---- Server-side configuration (Intuit OAuth2) ----------------------------
//
// These are read from the environment by src/server.ts. They NEVER reach the
// browser bundle: the client id is public, but the client secret is server-only
// and is validated to be present before the server will start (readServerConfig
// throws on a missing secret).

export interface ServerConfig {
  /** Intuit OAuth2 client id (public). */
  intuitClientId: string;
  /** Intuit OAuth2 client secret (SERVER ONLY — token exchange + refresh). */
  intuitClientSecret: string;
  /** OAuth redirect registered on the app (e.g. https://quickbooks.hanzo.ai/oauth/callback). */
  intuitRedirectUri: string;
  /** QBO environment: 'sandbox' (developer company) or 'production'. */
  qboEnv: QboEnv;
  /**
   * Hanzo API key the server uses to run AI over the books via the proxy. The
   * proxy funnels the panel's model calls server-side; without a key the server
   * still proxies QBO reads and runs anonymous/public models, which
   * readServerConfig reports honestly.
   */
  hanzoApiKey: string;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required Intuit secret is missing —
// a server that can neither exchange OAuth codes nor refresh tokens must not
// pretend to start. hanzoApiKey is the one optional field (see above). Pure
// given an env map, so it is unit-tested without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const intuitClientId = env.INTUIT_CLIENT_ID;
  const intuitClientSecret = env.INTUIT_CLIENT_SECRET;
  const intuitRedirectUri = env.INTUIT_REDIRECT_URI;
  const missing: string[] = [];
  if (!intuitClientId) missing.push('INTUIT_CLIENT_ID');
  if (!intuitClientSecret) missing.push('INTUIT_CLIENT_SECRET');
  if (!intuitRedirectUri) missing.push('INTUIT_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    intuitClientId: intuitClientId!,
    intuitClientSecret: intuitClientSecret!,
    intuitRedirectUri: intuitRedirectUri!,
    qboEnv: isQboEnv(env.QBO_ENV) ? env.QBO_ENV : 'sandbox',
    hanzoApiKey: env.HANZO_API_KEY || '',
    port: Number(env.PORT) || 8790,
  };
}
