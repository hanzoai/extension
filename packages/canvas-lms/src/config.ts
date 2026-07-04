// Canvas LMS config — the institution's Canvas host, the Canvas REST API version
// segment, the api.hanzo.ai model gateway, and the server-side secret set (Canvas
// OAuth). Endpoints and the bearer choice mirror @hanzo/procore and @hanzo/docusign
// so the productivity suite stays DRY; the education-specific pieces
// (course-context windowing, the AI actions) live in course.ts / hanzo.ts /
// actions.ts, not here.

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
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-canvas';

// localStorage key for the pasted Hanzo API key (`hk-…`) in the web panel. The
// panel is a static web page (iframe), not a host with roamingSettings, so the
// zero-setup credential lives in localStorage — same as @hanzo/procore.
export const APIKEY_STORAGE_KEY = 'hanzo.canvas.apiKey';

// Course text budget. A busy course has many assignments, pages, discussions, and
// submissions; the whole corpus won't fit a model window and shouldn't be sent.
// This caps the characters of course text we attach to any one request — chosen so
// it fits comfortably inside a modern context window alongside the reply, and is
// honest rather than optimal (we truncate visibly, never drop silently).
export const COURSE_CHAR_BUDGET = 60_000;

// pickBearer chooses the credential to send to the Hanzo gateway: a pasted API key
// wins over an OAuth token (an explicit key is a deliberate override), else the
// token, else empty (anonymous — the gateway still serves public models). Pure —
// unit-tested.
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

// ---- Canvas host + API ----------------------------------------------------
//
// Canvas LMS is self-hosted per institution: each school runs its own Canvas at
// its own host (e.g. `school.instructure.com` or a custom domain). There is no
// fixed host list — the host is a deployment value, so every Canvas URL (OAuth
// login + REST API) is built from the configured host. We never hard-code an
// institution host inline.
//
// Docs: canvas.instructure.com/doc/api/file.oauth.html and
// canvas.instructure.com/doc/api/index.html (REST API).

// normalizeHost strips a scheme, a trailing slash, and any path/query so a raw
// value like `https://school.instructure.com/` or `school.instructure.com`
// resolves to the bare host `school.instructure.com`. Pure — the ONE place a host
// is cleaned, so every URL builder gets a canonical host. Boundary guard.
export function normalizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}

// authBase turns a host into the OAuth login origin — `/login/oauth2/auth` and
// `/login/oauth2/token` live here. Pure.
export function authBase(host: string): string {
  return `https://${normalizeHost(host)}`;
}

// The REST API version segment. v1 is Canvas's current (and only) REST version;
// we never bump to a speculative v2 — one version, forward only. This is Canvas's
// OWN `/api/v1` path, not a Hanzo gateway path (the /api/ ban is only for
// api.hanzo.ai, which uses /v1).
export const REST_API_VERSION = 'v1';

// apiBaseUrl turns a host into the REST root: `https://{host}/api/v1`. Every Canvas
// API call is built on top of this. Pure — the request wrappers in canvas-api.ts
// take this string.
export function apiBaseUrl(host: string): string {
  return `${authBase(host)}/api/${REST_API_VERSION}`;
}

// The OAuth scopes the app requests. Canvas only enforces scopes when the
// Developer Key has "Enforce Scopes" enabled; a standard key ignores the `scope`
// parameter (permissions follow the authorizing user's Canvas role). We default to
// none so the app installs against either key type, and document the granular
// URL-scopes to add (see RECOMMENDED_SCOPES) when enforcement is on. The authorize
// URL only appends `scope` when this is non-empty.
export const OAUTH_SCOPES = [] as const;

// RECOMMENDED_SCOPES documents the exact Canvas URL-scopes to request when the
// Developer Key enforces scopes — the read surface this app uses plus the two
// gated writes. Not sent by default (see OAUTH_SCOPES); referenced by the README
// and available for a deployment that opts into scope enforcement.
export const RECOMMENDED_SCOPES = [
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:id',
  'url:GET|/api/v1/courses/:course_id/assignments',
  'url:GET|/api/v1/courses/:course_id/assignments/:id',
  'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions',
  'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
  'url:GET|/api/v1/courses/:course_id/discussion_topics',
  'url:GET|/api/v1/courses/:course_id/pages',
  'url:GET|/api/v1/courses/:course_id/pages/:url_or_id',
  'url:GET|/api/v1/courses/:course_id/modules',
  'url:GET|/api/v1/courses/:course_id/enrollments',
  'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
  'url:POST|/api/v1/courses/:course_id/discussion_topics',
] as const;

// ---- Server-side configuration (Canvas OAuth) -----------------------------
//
// These are read from the environment by src/server.ts. They NEVER reach the
// browser bundle: the client id and host are public, but the client secret is
// server-only and is validated to be present before the server will start
// (readServerConfig throws on a missing secret). This is the ONLY place the secret
// exists.

export interface ServerConfig {
  /** Canvas institution host, e.g. `school.instructure.com` (bare, normalized). */
  canvasHost: string;
  /** Canvas Developer Key client id (public). */
  canvasClientId: string;
  /** Canvas Developer Key client secret (SERVER ONLY — token exchange + refresh). */
  canvasClientSecret: string;
  /** OAuth redirect registered on the key (e.g. https://canvas.hanzo.ai/oauth/callback). */
  canvasRedirectUri: string;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required Canvas value is missing — a
// server that cannot exchange OAuth codes (or does not know which Canvas host to
// call) must not pretend to start. Pure given an env map, so it is unit-tested
// without touching process.env. The host is normalized at this one boundary.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const canvasHost = env.CANVAS_HOST;
  const canvasClientId = env.CANVAS_CLIENT_ID;
  const canvasClientSecret = env.CANVAS_CLIENT_SECRET;
  const canvasRedirectUri = env.CANVAS_REDIRECT_URI;
  const missing: string[] = [];
  if (!canvasHost) missing.push('CANVAS_HOST');
  if (!canvasClientId) missing.push('CANVAS_CLIENT_ID');
  if (!canvasClientSecret) missing.push('CANVAS_CLIENT_SECRET');
  if (!canvasRedirectUri) missing.push('CANVAS_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    canvasHost: normalizeHost(canvasHost!),
    canvasClientId: canvasClientId!,
    canvasClientSecret: canvasClientSecret!,
    canvasRedirectUri: canvasRedirectUri!,
    port: Number(env.PORT) || 8791,
  };
}
