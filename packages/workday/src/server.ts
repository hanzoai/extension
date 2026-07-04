// The Workday install + API-proxy service. This is the ONLY place the Workday
// client secret and the OAuth tokens exist — the secret is read from the
// environment (never bundled, never sent to the browser); tokens are minted by the
// OAuth flow and kept server-side, refreshed transparently on expiry. It:
//
//   GET  /oauth/install     → redirect the user to Workday's OAuth consent
//   GET  /oauth/callback    → exchange the code for a token, open a session, and
//                             hand the browser a session cookie
//   GET  /proxy/*           → forward a browser READ to the Workday REST/RaaS API
//                             with the session's Bearer token, refreshing the
//                             token first if it has expired. The browser never
//                             sees the token, the secret, or the tenant address.
//   GET  /healthz           → readiness
//
// v1 is READ-ONLY: the proxy accepts GET only (405 otherwise). Workday writes are
// heavy, kick off business-process approvals, and mutate the system of record — a
// gated write-back is a deliberate, documented future addition (see README), not
// an accident.
//
// It is a dependency-free Node http handler built on the pure modules (config,
// workday-oauth, workday-api) so it is deployable behind hanzoai/ingress as a
// small service at workday.hanzo.ai. The pure logic it wraps is what the tests
// cover; the http server is an integration concern.
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment (see config.readServerConfig):
//   WORKDAY_HOST, WORKDAY_TENANT, WORKDAY_CLIENT_ID, WORKDAY_CLIENT_SECRET,
//   WORKDAY_REDIRECT_URI, WORKDAY_ENV (sandbox | production), PORT (default 8791)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readServerConfig, OAUTH_SCOPES, type ServerConfig } from './config.js';
import {
  authorizeUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  carryRefreshToken,
  isExpired,
  type WorkdayTokenSet,
} from './workday-oauth.js';
import {
  listWorkers,
  getWorker,
  listDirectReports,
  listSupervisoryOrganizations,
  getSupervisoryOrganization,
  listJobRequisitions,
  getJobRequisition,
  listEligibleAbsenceTypes,
  timeOffReport,
  type PreparedGet,
  type Page,
  type Scope,
} from './workday-api.js';

// A server-side session: the tokens for one authorized user + when they were last
// minted (Workday tokens carry no created_at, so we track the mint wall-clock to
// compute expiry). In-memory here keyed by an opaque session id carried in an
// HttpOnly cookie; a production deployment persists this to hanzoai/kv (Valkey) so
// sessions survive a restart.
interface Session {
  token: WorkdayTokenSet;
  /** Wall-clock epoch seconds when the token was last minted/refreshed. */
  mintedAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_COOKIE = 'workday_sid';

// A pending OAuth `state` (CSRF token) minted at /oauth/install and consumed at
// /oauth/callback. A production deployment persists these (Valkey, short TTL); a
// Set is enough for a single instance.
const pendingStates = new Set<string>();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

// sessionIdFromCookie reads the session id from the Cookie header. Minimal parser
// — we only need our one cookie.
function sessionIdFromCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// GET /oauth/install → 302 to Workday's consent screen. `state` is a fresh CSRF
// token re-checked on callback.
function handleInstall(cfg: ServerConfig, res: ServerResponse): void {
  const state = randomUUID();
  pendingStates.add(state);
  const url = authorizeUrl({
    host: cfg.workdayHost,
    tenant: cfg.workdayTenant,
    clientId: cfg.workdayClientId,
    redirectUri: cfg.workdayRedirectUri,
    scopes: OAUTH_SCOPES,
    state,
  });
  res.writeHead(302, { Location: url });
  res.end();
}

// GET /oauth/callback?code=…&state=… → verify state, exchange the code for a token
// (secret in the server-side Basic header), open a session, and set the cookie.
async function handleOAuthCallback(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return json(res, 400, { error: 'missing code' });
  if (!state || !pendingStates.delete(state)) return json(res, 400, { error: 'invalid state' });

  const exReq = tokenExchange({
    host: cfg.workdayHost,
    tenant: cfg.workdayTenant,
    clientId: cfg.workdayClientId,
    clientSecret: cfg.workdayClientSecret,
    code,
    redirectUri: cfg.workdayRedirectUri,
  });
  let token: WorkdayTokenSet;
  try {
    const resp = await fetch(exReq.url, { method: 'POST', headers: exReq.headers, body: exReq.body });
    token = parseTokenResponse(await resp.json().catch(() => ({})));
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }

  const sid = randomUUID();
  sessions.set(sid, { token, mintedAt: nowSeconds() });
  log({ msg: 'oauth: session opened', sid });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': `${SESSION_COOKIE}=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/`,
  });
  res.end(JSON.stringify({ ok: true, installed: true }));
}

// freshToken returns a session's access token, refreshing first if it has expired.
// Workday does not rotate the refresh token, so we carry the prior one forward.
// Throws if the refresh fails (the caller returns 401 and the user re-installs).
async function freshToken(cfg: ServerConfig, sid: string, session: Session): Promise<string> {
  if (!isExpired(session.token, session.mintedAt, nowSeconds())) return session.token.access_token;
  const refreshToken = session.token.refresh_token;
  if (!refreshToken) throw new Error('session expired and no refresh token');
  const rReq = refreshExchange({
    host: cfg.workdayHost,
    tenant: cfg.workdayTenant,
    clientId: cfg.workdayClientId,
    clientSecret: cfg.workdayClientSecret,
    refreshToken,
  });
  const resp = await fetch(rReq.url, { method: 'POST', headers: rReq.headers, body: rReq.body });
  const next = carryRefreshToken(session.token, parseTokenResponse(await resp.json().catch(() => ({}))));
  sessions.set(sid, { token: next, mintedAt: nowSeconds() });
  log({ msg: 'oauth: token refreshed', sid });
  return next.access_token;
}

// pageFromSearch reads limit/offset from a query into a Page (undefined when
// absent/non-positive so pageParams stays clean).
function pageFromSearch(sp: URLSearchParams): Page {
  const limit = Number(sp.get('limit'));
  const offset = Number(sp.get('offset'));
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    offset: Number.isFinite(offset) && offset > 0 ? offset : undefined,
  };
}

// searchRecord collects report prompt params (everything but the format we force).
function searchRecord(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of sp) if (k !== 'format') out[k] = v;
  return out;
}

// resolveTarget maps a semantic proxy route (segments after /proxy) to the Workday
// request the api layer builds. Returns null for an unknown resource (→ 404). This
// is the single place the browser's resource vocabulary maps onto Workday's URLs,
// keeping the tenant address server-side.
function resolveTarget(scope: Scope, segments: string[], sp: URLSearchParams): PreparedGet | null {
  const [a, b, c] = segments;
  if (a === 'workers') {
    if (!b) return listWorkers(scope, pageFromSearch(sp));
    if (!c) return getWorker(scope, b);
    if (c === 'directReports') return listDirectReports(scope, b, pageFromSearch(sp));
    if (c === 'absenceTypes') return listEligibleAbsenceTypes(scope, b, pageFromSearch(sp));
    return null;
  }
  if (a === 'organizations') {
    if (!b) return listSupervisoryOrganizations(scope, pageFromSearch(sp));
    if (!c) return getSupervisoryOrganization(scope, b);
    return null;
  }
  if (a === 'requisitions') {
    if (!b) return listJobRequisitions(scope, pageFromSearch(sp));
    if (!c) return getJobRequisition(scope, b);
    return null;
  }
  if (a === 'report' && b && c) return timeOffReport(scope, b, c, searchRecord(sp));
  return null;
}

// GET /proxy/* → forward a READ to Workday. The browser sends a resource route
// (/proxy/workers, /proxy/organizations/{id}, /proxy/report/{owner}/{name}, …);
// the server resolves it to a REST/RaaS URL, injects the Bearer token (never
// exposed to the browser), fetches, and returns the upstream JSON verbatim (the
// panel parses it). GET only — v1 is read-only.
async function handleProxy(
  cfg: ServerConfig,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'read-only: v1 proxy supports GET reads only' });
  }
  const sid = sessionIdFromCookie(req);
  const session = sid ? sessions.get(sid) : undefined;
  if (!sid || !session) return json(res, 401, { error: 'not authenticated' });

  let accessToken: string;
  try {
    accessToken = await freshToken(cfg, sid, session);
  } catch (e: any) {
    return json(res, 401, { error: e?.message || 'token refresh failed' });
  }

  const scope: Scope = { host: cfg.workdayHost, tenant: cfg.workdayTenant, accessToken };
  const rest = url.pathname.replace(/^\/proxy/, '');
  const segments = rest.split('/').filter(Boolean).map(decodeURIComponent);
  const target = resolveTarget(scope, segments, url.searchParams);
  if (!target) return json(res, 404, { error: 'unknown resource' });

  try {
    const upstream = await fetch(target.url, { headers: target.headers });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (e: any) {
    log({ msg: 'proxy: upstream error', error: e?.message, url: target.url });
    return json(res, 502, { error: 'upstream request failed' });
  }
}

// createHandler is the request router. Everything is a small handler over the pure
// modules. Exported so a test can drive it with a mock req/res if desired.
export function createHandler(cfg: ServerConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/oauth/install') return handleInstall(cfg, res);
      if (req.method === 'GET' && url.pathname === '/oauth/callback') return await handleOAuthCallback(cfg, url, res);
      if (url.pathname === '/proxy' || url.pathname.startsWith('/proxy/')) return await handleProxy(cfg, req, res, url);
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
      return json(res, 404, { error: 'not found' });
    } catch (e: any) {
      log({ msg: 'unhandled error', error: e?.message });
      return json(res, 500, { error: 'internal error' });
    }
  };
}

// main boots the server when run directly. Import-safe: only the direct entry
// listens, so tests import the handlers without opening a port.
export function main(): void {
  const cfg = readServerConfig(process.env);
  const server = createServer(createHandler(cfg));
  server.listen(cfg.port, () => {
    log({ msg: 'hanzo workday service up', port: cfg.port, env: cfg.workdayEnv, tenant: cfg.workdayTenant });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
