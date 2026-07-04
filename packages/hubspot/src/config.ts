// Hanzo-for-HubSpot config — the two backends this app talks to and nothing
// else. Hanzo (the model gateway, api.hanzo.ai/v1, reached via @hanzo/ai) and
// HubSpot (OAuth + CRM REST, api.hubapi.com/crm/v3). No `/api/` prefix on Hanzo
// (it is api.hanzo.ai already); HubSpot uses its literal `/crm/v3/...` and
// `/oauth/v1/...` paths.
//
// Rule: secrets never live here. The HubSpot client_secret and the Hanzo API
// key are read from the serverless-function environment (process.env), never
// bundled into the card's React frontend.

// ── Hanzo model gateway ───────────────────────────────────────────────────

/** Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. /v1
 *  only, never an `/api/` prefix (api.hanzo.ai IS the api host). */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when a portal has not picked one. A Zen model (qwen3+); the
 *  gateway routes it. Overridable per request via the card's model picker. */
export const DEFAULT_MODEL = 'zen5';

/** Public IAM origin that mints Hanzo user tokens (owner-scoping via @hanzo/iam). */
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';

/** OAuth client id an inbound Hanzo token is audienced to (validation). The
 *  <org>-<app> naming scheme used across the Hanzo suite. */
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-hubspot';

// ── HubSpot API ────────────────────────────────────────────────────────────

/** HubSpot's single global REST API origin (no regional fan-out). */
export const HUBSPOT_API_BASE_URL = 'https://api.hubapi.com';

/** HubSpot's OAuth server origin (authorize page + token endpoint). */
export const HUBSPOT_OAUTH_BASE_URL = 'https://app.hubspot.com';

/** The CRM REST API version segment. v3 is current; we never bump to a
 *  speculative v4 — one version, forward only. */
export const CRM_API_VERSION = 'v3';

/** The CRM REST API root — `${base}/crm/v3`. Every CRM call in api/ builds on
 *  top of this. */
export function crmApiRoot(base: string = HUBSPOT_API_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/crm/${CRM_API_VERSION}`;
}

/** The OAuth authorize page a browser is redirected to for install/consent. */
export function hubspotAuthorizeURL(base: string = HUBSPOT_OAUTH_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/oauth/authorize`;
}

/** The OAuth token endpoint (code→token + refresh, server-side only). Note it
 *  lives on the API host, not the app host. */
export function hubspotTokenURL(base: string = HUBSPOT_API_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/oauth/v1/token`;
}

// ── Record-context budget ────────────────────────────────────────────────

/** Record-context character budget. A record plus its associations (deals,
 *  companies, recent notes) can run long; the whole thing won't fit a model
 *  window and shouldn't be sent whole. This caps the characters of assembled
 *  record text attached to any one request — chosen to fit comfortably inside a
 *  modern context window alongside the reply. We truncate visibly, never drop
 *  silently. Same "fit ordered text to a budget" contract as @hanzo/notion. */
export const RECORD_CHAR_BUDGET = 48_000;

/** The CRM object types the card mounts on. HubSpot's canonical plural names —
 *  the same strings used in the card config's `objectTypes` and in a CRM v3
 *  path segment (`/crm/v3/objects/contacts`). */
export const SUPPORTED_OBJECT_TYPES = ['contacts', 'companies', 'deals'] as const;
export type ObjectType = (typeof SUPPORTED_OBJECT_TYPES)[number];

/** isObjectType narrows an arbitrary string to a supported ObjectType. Boundary
 *  guard used before an object type reaches a CRM path. */
export function isObjectType(v: string | undefined): v is ObjectType {
  return v === 'contacts' || v === 'companies' || v === 'deals';
}
