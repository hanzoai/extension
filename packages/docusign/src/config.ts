// DocuSign config — the api.hanzo.ai model gateway, the default model, the
// pasted-key storage for the web panel, and the server-side secret set
// (DocuSign OAuth + Connect webhook HMAC). Endpoints and the bearer choice
// mirror @hanzo/meetings and @hanzo/pdf so the productivity suite stays DRY;
// the agreement-specific pieces (document-text windowing, the four AI actions)
// live in hanzo.ts / actions.ts, not here.

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
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-docusign';

// localStorage key for the pasted Hanzo API key (`sk-…`) in the web panel. The
// Extension-App panel is a static web page (iframe), not an Office host with
// roamingSettings, so the zero-setup credential lives in localStorage — same as
// @hanzo/pdf and @hanzo/meetings.
export const APIKEY_STORAGE_KEY = 'hanzo.docusign.apiKey';

// Agreement text budget. A long contract runs to tens of thousands of words;
// the whole thing won't fit a model window and shouldn't be sent. This caps the
// characters of document text we attach to any one request — chosen so it fits
// comfortably inside a modern context window alongside the reply, and is honest
// rather than optimal (we truncate visibly, never drop silently).
export const DOCUMENT_CHAR_BUDGET = 60_000;

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

// ---- DocuSign OAuth + API bases -------------------------------------------
//
// DocuSign has two OAuth environments (the "account server") and per-account
// regional REST bases returned at login via /oauth/userinfo. We never hard-code
// a REST host: the base_uri for the signed-in account comes from userinfo and is
// stored with the account. The account server, however, is a fixed pair.

// The DocuSign account server (OAuth). Demo/developer vs production.
export const DOCUSIGN_ACCOUNT_SERVER = {
  demo: 'https://account-d.docusign.com',
  production: 'https://account.docusign.com',
} as const;

// Which environment is a DocuSign env value.
export type DocusignEnv = keyof typeof DOCUSIGN_ACCOUNT_SERVER;

// accountServer resolves the OAuth account-server origin for an environment.
export function accountServer(env: DocusignEnv): string {
  return DOCUSIGN_ACCOUNT_SERVER[env];
}

// The eSignature REST API version segment. v2.1 is current; we never bump to a
// speculative v2.2 — one version, forward only.
export const ESIGN_API_VERSION = 'v2.1';

// ---- Server-side configuration (DocuSign OAuth + Connect webhook) ---------
//
// These are read from the environment by src/server.ts. They NEVER reach the
// browser bundle: the integration key (client id) is public, but the secret key
// and the Connect HMAC key are server-only and are validated to be present
// before the server will start (readServerConfig throws on a missing secret).

export interface ServerConfig {
  /** DocuSign integration key / OAuth client id (public). */
  docusignClientId: string;
  /** DocuSign OAuth secret key (SERVER ONLY — token exchange). */
  docusignClientSecret: string;
  /** OAuth redirect registered on the app (e.g. https://docusign.hanzo.ai/oauth/callback). */
  docusignRedirectUri: string;
  /** DocuSign environment: 'demo' (account-d) or 'production' (account). */
  docusignEnv: DocusignEnv;
  /**
   * Connect HMAC key — verifies the X-DocuSign-Signature-* header on every
   * event. Configured in the Connect configuration's HMAC section. Server only.
   */
  connectHmacKey: string;
  /**
   * Hanzo API key the server uses to summarize a completed envelope. The webhook
   * runs with no user in the loop, so it needs its own bearer. Optional: without
   * it, the server verifies + routes events but cannot summarize (it logs and
   * skips), which readServerConfig reports honestly.
   */
  hanzoApiKey: string;
  /** Listen port. */
  port: number;
}

// The OAuth scopes the app requests. `signature` is the eSignature REST scope;
// `openid` is what /oauth/userinfo needs to return the account list + base_uri.
export const OAUTH_SCOPES = ['signature', 'openid'] as const;

// isDocusignEnv narrows an arbitrary string to a DocusignEnv, defaulting unknown
// values to 'demo' (the safe, non-production sandbox). Boundary guard.
export function isDocusignEnv(v: string | undefined): v is DocusignEnv {
  return v === 'demo' || v === 'production';
}

// readServerConfig fails fast (throws) if a required DocuSign secret is missing —
// a server that can neither exchange OAuth codes nor verify Connect events must
// not pretend to start. hanzoApiKey is the one optional field (see above). Pure
// given an env map, so it is unit-tested without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const docusignClientId = env.DOCUSIGN_CLIENT_ID;
  const docusignClientSecret = env.DOCUSIGN_CLIENT_SECRET;
  const docusignRedirectUri = env.DOCUSIGN_REDIRECT_URI;
  const connectHmacKey = env.DOCUSIGN_CONNECT_HMAC_KEY;
  const missing: string[] = [];
  if (!docusignClientId) missing.push('DOCUSIGN_CLIENT_ID');
  if (!docusignClientSecret) missing.push('DOCUSIGN_CLIENT_SECRET');
  if (!docusignRedirectUri) missing.push('DOCUSIGN_REDIRECT_URI');
  if (!connectHmacKey) missing.push('DOCUSIGN_CONNECT_HMAC_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    docusignClientId: docusignClientId!,
    docusignClientSecret: docusignClientSecret!,
    docusignRedirectUri: docusignRedirectUri!,
    docusignEnv: isDocusignEnv(env.DOCUSIGN_ENV) ? env.DOCUSIGN_ENV : 'demo',
    connectHmacKey: connectHmacKey!,
    hanzoApiKey: env.HANZO_API_KEY || '',
    port: Number(env.PORT) || 8789,
  };
}
