// Clio integration config — the two backends this app talks to and nothing
// else. Hanzo (the model gateway, api.hanzo.ai/v1, mirrored from @hanzo/office-addin)
// and Clio (OAuth + REST v4, app.clio.com by default, regional bases configurable).
//
// Rule: no `/api/` prefix on Hanzo (it is api.hanzo.ai already); Clio uses its
// literal `/api/v4` + `/oauth/*` paths. Secrets never live here — the Clio
// client_secret is read from the environment by server.ts, never bundled.

// ── Hanzo model gateway ───────────────────────────────────────────────────
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

// Default model. Overridable per-request; the gateway routes it.
export const DEFAULT_MODEL = 'zen-1';

export function chatCompletionsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/models`;
}

// ── Clio regions ──────────────────────────────────────────────────────────
// Clio hosts one deployment per data-residency region; the OAuth host and the
// API host share the SAME origin per region (there is no separate auth host).
// A firm's tokens and data live in exactly one region, so the base is a single
// configurable value, not a fan-out.
export type ClioRegion = 'us' | 'eu' | 'au' | 'ca';

export const CLIO_REGION_BASES: Record<ClioRegion, string> = {
  us: 'https://app.clio.com',
  eu: 'https://eu.app.clio.com',
  au: 'https://au.app.clio.com',
  ca: 'https://ca.app.clio.com',
};

export const DEFAULT_CLIO_REGION: ClioRegion = 'us';

// The Clio REST API version pin. Sent as X-API-Version on every call so Clio
// serves a stable response shape regardless of what it rolls forward to.
export const CLIO_API_VERSION = '4.0.11';

// clioBase resolves a region (or an explicit base override) to the origin used
// for BOTH /oauth/* and /api/v4. An explicit base wins — a firm on a private
// Clio host, or a test, can pass one directly. Otherwise the region table.
// Trailing slashes are stripped so callers can always append `/oauth/...`.
export function clioBase(region: ClioRegion = DEFAULT_CLIO_REGION, override?: string): string {
  const raw = override || CLIO_REGION_BASES[region] || CLIO_REGION_BASES[DEFAULT_CLIO_REGION];
  return raw.replace(/\/+$/, '');
}

// The Clio REST v4 root and the two OAuth endpoints, derived from the base.
export function clioApiRoot(base: string): string {
  return `${base}/api/v4`;
}
export function clioAuthorizeURL(base: string): string {
  return `${base}/oauth/authorize`;
}
export function clioTokenURL(base: string): string {
  return `${base}/oauth/token`;
}

// OAuth scopes Clio grants. Clio scopes are coarse (all/read/write per the
// app's declared access); we request read+write because the write-back actions
// (notes, activities, document upload) need write. Documented in README.
export const CLIO_SCOPES = 'read write';
