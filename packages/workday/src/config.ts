// Workday config — the tenant address (host + tenant name), the REST/RaaS
// endpoint builders, the api.hanzo.ai model gateway, and the server-side secret
// set (Workday OAuth). Endpoints and the bearer choice mirror @hanzo/procore and
// @hanzo/docusign so the productivity suite stays DRY; the HR-specific pieces
// (people-context windowing, the AI actions) live in people.ts / hanzo.ts /
// actions.ts, not here.
//
// Unlike Procore (a fixed production/sandbox host pair), a Workday customer runs
// on a specific datacenter host (e.g. https://wd2-impl-services1.workday.com) with
// a named tenant (e.g. `acme`). Both are deployment config, not hard-coded — every
// URL is built from `host` + `tenant`, so pointing at a different tenant is one
// env change. Implementation ("sandbox") tenants carry `-impl` in the host.

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
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-workday';

// localStorage key for the pasted Hanzo API key (`sk-…`) in the web panel. The
// panel is a static web page (iframe), not a host with roamingSettings, so the
// zero-setup credential lives in localStorage — same as @hanzo/procore.
export const APIKEY_STORAGE_KEY = 'hanzo.workday.apiKey';

// People text budget. A tenant has thousands of workers; the whole corpus won't
// fit a model window and shouldn't be sent. This caps the characters of Workday
// text we attach to any one request — chosen so it fits comfortably inside a
// modern context window alongside the reply, and is honest rather than optimal
// (we truncate visibly, never drop silently).
export const PEOPLE_CHAR_BUDGET = 60_000;

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

// ---- Workday tenant address -----------------------------------------------

// normHost strips a trailing slash so `${host}${path}` never doubles the slash.
// The ONE place a Workday host is normalized. Pure.
export function normHost(host: string): string {
  return host.replace(/\/+$/, '');
}

// A Workday REST API is addressed by a service name + version, both in the path.
// Workday versions each service independently (staffing v6, recruiting v4,
// absenceManagement v1), so the pair travels together.
export interface WorkdayService {
  api: string;
  version: string;
}

// The REST services this app reads. One value per service — we never bump to a
// speculative version; when Workday ships a new version we change it here once.
export const STAFFING: WorkdayService = { api: 'staffing', version: 'v6' };
export const RECRUITING: WorkdayService = { api: 'recruiting', version: 'v4' };
export const ABSENCE: WorkdayService = { api: 'absenceManagement', version: 'v1' };
export const COMMON: WorkdayService = { api: 'common', version: 'v1' };

// oauthBaseUrl is the tenant's OAuth 2.0 root: `${host}/ccx/oauth2/{tenant}`. The
// /authorize and /token endpoints hang off it (built in workday-oauth.ts). Pure.
export function oauthBaseUrl(host: string, tenant: string): string {
  return `${normHost(host)}/ccx/oauth2/${tenant}`;
}

// restPath builds the host-relative REST path for a service + sub-path:
// `/ccx/api/{api}/{version}/{tenant}{sub}`. Host-agnostic on purpose so the same
// builder serves the server (which prepends the host) and any path-only consumer.
// Pure — unit-tested.
export function restPath(tenant: string, service: WorkdayService, sub = ''): string {
  return `/ccx/api/${service.api}/${service.version}/${tenant}${sub}`;
}

// restUrl is the absolute REST URL for a service + sub-path on a host. Pure.
export function restUrl(host: string, tenant: string, service: WorkdayService, sub = ''): string {
  return `${normHost(host)}${restPath(tenant, service, sub)}`;
}

// raasPath builds the host-relative Report-as-a-Service path for a custom report:
// `/ccx/service/customreport2/{tenant}/{owner}/{report}`. `owner` is the report
// owner's username (the ISU/account the report is shared from). Pure.
export function raasPath(tenant: string, owner: string, report: string): string {
  return `/ccx/service/customreport2/${tenant}/${owner}/${report}`;
}

// raasUrl is the absolute RaaS URL for a custom report on a host. Pure.
export function raasUrl(host: string, tenant: string, owner: string, report: string): string {
  return `${normHost(host)}${raasPath(tenant, owner, report)}`;
}

// The OAuth scopes the app requests. Workday's Authorization Code grant governs
// access by the API Client's registered functional-area scope in the tenant, so
// the authorize call omits `scope` for a standard client; it is only appended
// when non-empty, for forward-compat with fine-grained scopes.
export const OAUTH_SCOPES = [] as const;

// ---- Environment label ----------------------------------------------------

// Which environment a deployment targets. Purely a label for the UI/logs —
// Workday has no fixed host per environment (each datacenter differs); sandbox is
// an implementation tenant (host carries `-impl`).
export type WorkdayEnv = 'sandbox' | 'production';

// isWorkdayEnv narrows an arbitrary string to a WorkdayEnv, else undefined-safe.
export function isWorkdayEnv(v: string | undefined): v is WorkdayEnv {
  return v === 'sandbox' || v === 'production';
}

// isSandboxHost reports whether a Workday host is an implementation ("sandbox")
// tenant — Workday implementation hosts carry `-impl` (e.g. wd2-impl-services1).
// Used to sanity-check that env label and host agree. Pure.
export function isSandboxHost(host: string): boolean {
  return /-impl/i.test(host);
}

// ---- Server-side configuration (Workday OAuth) ----------------------------
//
// Read from the environment by src/server.ts. These NEVER reach the browser
// bundle: the client id + host + tenant are effectively public, but the client
// secret is server-only and is validated to be present before the server will
// start (readServerConfig throws on a missing secret). This is the ONLY place the
// secret exists.

export interface ServerConfig {
  /** Workday datacenter host origin, e.g. https://wd2-impl-services1.workday.com */
  workdayHost: string;
  /** Workday tenant name, e.g. acme */
  workdayTenant: string;
  /** Workday OAuth client id (public). */
  workdayClientId: string;
  /** Workday OAuth client secret (SERVER ONLY — token exchange + refresh). */
  workdayClientSecret: string;
  /** OAuth redirect registered on the API Client (e.g. https://workday.hanzo.ai/oauth/callback). */
  workdayRedirectUri: string;
  /** Environment label: 'sandbox' (implementation) or 'production'. */
  workdayEnv: WorkdayEnv;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required Workday value is missing — a
// server that cannot address the tenant or exchange OAuth codes must not pretend
// to start. Pure given an env map, so it is unit-tested without touching
// process.env. The host is normalized here at the one boundary.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const workdayHost = env.WORKDAY_HOST;
  const workdayTenant = env.WORKDAY_TENANT;
  const workdayClientId = env.WORKDAY_CLIENT_ID;
  const workdayClientSecret = env.WORKDAY_CLIENT_SECRET;
  const workdayRedirectUri = env.WORKDAY_REDIRECT_URI;
  const missing: string[] = [];
  if (!workdayHost) missing.push('WORKDAY_HOST');
  if (!workdayTenant) missing.push('WORKDAY_TENANT');
  if (!workdayClientId) missing.push('WORKDAY_CLIENT_ID');
  if (!workdayClientSecret) missing.push('WORKDAY_CLIENT_SECRET');
  if (!workdayRedirectUri) missing.push('WORKDAY_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    workdayHost: normHost(workdayHost!),
    workdayTenant: workdayTenant!,
    workdayClientId: workdayClientId!,
    workdayClientSecret: workdayClientSecret!,
    workdayRedirectUri: workdayRedirectUri!,
    workdayEnv: isWorkdayEnv(env.WORKDAY_ENV) ? env.WORKDAY_ENV : 'sandbox',
    port: Number(env.PORT) || 8791,
  };
}
