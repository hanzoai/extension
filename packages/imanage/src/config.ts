// iManage config — the customer's iManage Work host (auth/control-center + Work
// API), the Work API version segment, the api.hanzo.ai model gateway, and the
// server-side secret set (iManage OAuth). Endpoints and the bearer choice mirror
// @hanzo/procore / @hanzo/clio so the productivity suite stays DRY; the
// legal-DMS-specific pieces (document-context windowing, the AI actions) live in
// documents.ts / hanzo.ts / actions.ts, not here.
//
// iManage is NOT a fixed sandbox↔production pair like Procore: every customer runs
// on their own host (iManage Cloud `cloudimanage.com`, a regional cloud host, or
// an on-prem Work server). So the host is a configured value, not an enum — the
// OAuth + Work API URLs are all derived from it.

// ---- Hanzo model gateway --------------------------------------------------

// Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. /v1 only,
// never an /api/ prefix (api.hanzo.ai IS the api host). NOTE: the /api/ ban is a
// Hanzo-gateway rule; iManage's OWN Work API path IS `/api/v2/...` and that is
// correct — it is iManage's host, not ours.
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

// Default model. A Zen model (qwen3+). Overridable per-request via the picker;
// the gateway routes it.
export const DEFAULT_MODEL = 'zen5';

// Public IAM origin that mints Hanzo user tokens, and the OAuth client id an
// inbound Hanzo token is audienced to (owner-scoping validation via @hanzo/iam).
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-imanage';

// localStorage key for the pasted Hanzo API key (`sk-…`) in the web panel. The
// panel is a static web page (iframe), not a host with roamingSettings, so the
// zero-setup credential lives in localStorage — same as @hanzo/procore.
export const APIKEY_STORAGE_KEY = 'hanzo.imanage.apiKey';

// Document text budget. A legal document (or a matter's document set) is far
// larger than a model window and must not be sent whole. This caps the characters
// of iManage document text we attach to any one request — chosen so it fits
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

// ---- iManage Work hosts + Work API ----------------------------------------
//
// One iManage customer has (usually) ONE host serving both the OAuth
// control-center endpoints (/auth/oauth2/authorize + /token) and the Work API
// (/api/v2/...). Some deployments front the Work API on a separate host, so we
// allow an optional API host that defaults to the auth host. We never hard-code a
// single host inline — every URL is built from a normalized host string, so
// pointing at a different customer's iManage is one env value.
//
//   iManage Cloud (US):  https://cloudimanage.com
//   regional cloud:      https://<region>.imanage.work
//   on-prem Work server: https://work.<firm>.com
//
// Docs: docs.imanage.com (Work API) and the iManage Control Center OAuth2 guide.

export interface ImanageHosts {
  /** Auth / control-center host — /auth/oauth2/authorize and /token live here. */
  auth: string;
  /** Work API host — /api/v2/... lives here. */
  api: string;
}

// normalizeHost coerces a host value into a clean `https://host[:port]` origin:
// adds https:// when a bare host is given, and strips any trailing slash / path so
// the endpoint builders can append their own paths cleanly. Pure — unit-tested.
export function normalizeHost(host: string): string {
  const trimmed = (host || '').trim();
  if (trimmed === '') return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    // Fall back to a best-effort strip so a malformed value never throws here;
    // isHttpUrl is the boundary guard that rejects it in readServerConfig.
    return withScheme.replace(/\/+$/, '');
  }
}

// isHttpUrl narrows an arbitrary string to a usable http(s) origin. Boundary guard
// used by readServerConfig so the service refuses to start against a nonsense host.
export function isHttpUrl(v: string | undefined): boolean {
  if (!v) return false;
  // A value that already carries a scheme keeps it (so ftp:// etc. is rejected);
  // a bare host is assumed https.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
  try {
    const u = new URL(hasScheme ? v : `https://${v}`);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// hosts resolves the auth + api host set from a configured host (and an optional
// distinct API host). Pure — the request wrappers take the resolved strings.
export function hosts(host: string, apiHost?: string): ImanageHosts {
  const auth = normalizeHost(host);
  const api = apiHost && apiHost.trim() ? normalizeHost(apiHost) : auth;
  return { auth, api };
}

// The Work API version segment. v2 is current for the resources we read
// (workspaces, folders, documents, search); we never bump to a speculative v3 —
// one version, forward only.
export const WORK_API_VERSION = 'v2';

// apiBaseUrl turns an API host into the Work API root: `${api}/api/v2`. Every
// iManage Work API call is built on top of this. Pure — the request wrappers in
// imanage-api.ts take this string. (The `/api/` here is iManage's own path.)
export function apiBaseUrl(apiHost: string): string {
  return `${normalizeHost(apiHost)}/api/${WORK_API_VERSION}`;
}

// The OAuth scopes the app requests. iManage's Authorization Code grant treats
// scope as optional (access is governed by the user's Work permissions and the
// app registration in Control Center); we send it only when non-empty, leaving
// room for future fine-grained scopes without a code change.
export const OAUTH_SCOPES = [] as const;

// ---- Server-side configuration (iManage OAuth) ----------------------------
//
// These are read from the environment by src/server.ts. They NEVER reach the
// browser bundle: the client id + host are non-secret, but the client secret is
// server-only and is validated to be present before the server will start
// (readServerConfig throws on a missing secret). This is the ONLY place the secret
// exists.
//
// customerId / libraryId are the (non-secret) scoping defaults a single-tenant
// deployment fixes so the panel opens pre-scoped; they are optional (the panel can
// also take them from its launch-context query or manual fields).

export interface ServerConfig {
  /** iManage OAuth client id (public). */
  imanageClientId: string;
  /** iManage OAuth client secret (SERVER ONLY — token exchange + refresh). */
  imanageClientSecret: string;
  /** OAuth redirect registered on the app (e.g. https://imanage.hanzo.ai/oauth/callback). */
  imanageRedirectUri: string;
  /** The customer's iManage host (auth control-center + Work API unless apiHost set). */
  imanageHost: string;
  /** Optional distinct Work API host; defaults to imanageHost. */
  imanageApiHost?: string;
  /** Non-secret default customer id the panel opens scoped to (optional). */
  customerId: string;
  /** Non-secret default library id the panel opens scoped to (optional). */
  libraryId: string;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required iManage secret/host is
// missing or malformed — a server that cannot exchange OAuth codes or reach a Work
// host must not pretend to start. Pure given an env map, so it is unit-tested
// without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const imanageClientId = env.IMANAGE_CLIENT_ID;
  const imanageClientSecret = env.IMANAGE_CLIENT_SECRET;
  const imanageRedirectUri = env.IMANAGE_REDIRECT_URI;
  const imanageHost = env.IMANAGE_HOST;
  const missing: string[] = [];
  if (!imanageClientId) missing.push('IMANAGE_CLIENT_ID');
  if (!imanageClientSecret) missing.push('IMANAGE_CLIENT_SECRET');
  if (!imanageRedirectUri) missing.push('IMANAGE_REDIRECT_URI');
  if (!imanageHost) missing.push('IMANAGE_HOST');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  if (!isHttpUrl(imanageHost)) {
    throw new Error(`IMANAGE_HOST is not a valid http(s) host: ${imanageHost}`);
  }
  if (env.IMANAGE_API_HOST && !isHttpUrl(env.IMANAGE_API_HOST)) {
    throw new Error(`IMANAGE_API_HOST is not a valid http(s) host: ${env.IMANAGE_API_HOST}`);
  }
  return {
    imanageClientId: imanageClientId!,
    imanageClientSecret: imanageClientSecret!,
    imanageRedirectUri: imanageRedirectUri!,
    imanageHost: normalizeHost(imanageHost!),
    imanageApiHost: env.IMANAGE_API_HOST ? normalizeHost(env.IMANAGE_API_HOST) : undefined,
    customerId: env.IMANAGE_CUSTOMER_ID?.trim() || '',
    libraryId: env.IMANAGE_LIBRARY_ID?.trim() || '',
    port: Number(env.PORT) || 8793,
  };
}
