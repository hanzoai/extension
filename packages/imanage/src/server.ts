// The iManage install + Work-API-proxy service. This is the ONLY place the iManage
// client secret and the OAuth tokens exist — the secret is read from the
// environment (never bundled, never sent to the browser); tokens are minted by the
// OAuth flow and kept server-side, refreshed transparently on expiry. It:
//
//   GET  /oauth/install     → redirect the user to iManage's OAuth consent
//   GET  /oauth/callback    → exchange the code for a token, open a session, and
//                             hand the browser a session cookie
//   GET  /config            → the non-secret scoping defaults (customer/library)
//                             for the panel to pre-fill; NO secrets, NO tokens
//   ALL  /proxy/*           → forward a browser request to the iManage Work API
//                             with the session's access token (X-Auth-Token),
//                             refreshing it first if it has expired. The browser
//                             never sees the token or the secret.
//   GET  /healthz           → readiness
//
// CONFIDENTIALITY: this service handles privileged legal documents. It NEVER logs
// request or response BODIES (document content, profiles, search terms) — only
// non-content bookkeeping (a session id, a status code, a target path). Tokens and
// the client secret stay server-side.
//
// It is a dependency-free Node http handler built on the pure modules (config,
// imanage-oauth, imanage-api) so it is deployable behind hanzoai/ingress as a small
// service at imanage.hanzo.ai.
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment (see config.readServerConfig):
//   IMANAGE_CLIENT_ID, IMANAGE_CLIENT_SECRET, IMANAGE_REDIRECT_URI, IMANAGE_HOST
//   IMANAGE_API_HOST (optional; defaults to IMANAGE_HOST)
//   IMANAGE_CUSTOMER_ID, IMANAGE_LIBRARY_ID (optional panel defaults)
//   PORT (default 8793)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { apiBaseUrl, readServerConfig, OAUTH_SCOPES, type ServerConfig } from './config.js';
import { AUTH_HEADER } from './imanage-api.js';
import {
  authorizeUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  isExpired,
  type ImanageTokenSet,
} from './imanage-oauth.js';

// A server-side session: the tokens for one authorized user + when they were
// minted (iManage returns no issued-at, so we track wall-clock at mint to compute
// expiry). In-memory here keyed by an opaque session id carried in an HttpOnly
// cookie; a production deployment persists this to hanzoai/kv (Valkey) so sessions
// survive a restart.
interface Session {
  token: ImanageTokenSet;
  /** Wall-clock epoch seconds when the token was last minted/refreshed. */
  mintedAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_COOKIE = 'imanage_sid';

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

// log emits ONLY non-content bookkeeping fields. Callers must never pass a request
// or response body here — see the confidentiality note at the top of the file.
function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

// sessionIdFromCookie reads the session id from the Cookie header. Minimal parser —
// we only need our one cookie.
function sessionIdFromCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// GET /oauth/install → 302 to iManage's consent screen. `state` is a fresh CSRF
// token re-checked on callback.
function handleInstall(cfg: ServerConfig, res: ServerResponse): void {
  const state = randomUUID();
  pendingStates.add(state);
  const url = authorizeUrl({
    host: cfg.imanageHost,
    clientId: cfg.imanageClientId,
    redirectUri: cfg.imanageRedirectUri,
    scopes: OAUTH_SCOPES,
    state,
  });
  res.writeHead(302, { Location: url });
  res.end();
}

// GET /oauth/callback?code=…&state=… → verify state, exchange the code for a token
// (secret in the server-side body), open a session, and set the cookie.
async function handleOAuthCallback(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return json(res, 400, { error: 'missing code' });
  if (!state || !pendingStates.delete(state)) return json(res, 400, { error: 'invalid state' });

  const exReq = tokenExchange({
    host: cfg.imanageHost,
    clientId: cfg.imanageClientId,
    clientSecret: cfg.imanageClientSecret,
    code,
    redirectUri: cfg.imanageRedirectUri,
  });
  let token: ImanageTokenSet;
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

// GET /config → the non-secret scoping defaults so a single-tenant panel opens
// pre-scoped. Never returns the client secret or any token.
function handleConfig(cfg: ServerConfig, res: ServerResponse): void {
  json(res, 200, { customerId: cfg.customerId, libraryId: cfg.libraryId });
}

// freshToken returns a session's access token, refreshing first if it has expired.
// The refresh may rotate iManage's refresh token, so we store the new set. Throws if
// the refresh fails (the caller returns 401 and the user re-installs).
async function freshToken(cfg: ServerConfig, sid: string, session: Session): Promise<string> {
  if (!isExpired(session.token, session.mintedAt, nowSeconds())) return session.token.access_token;
  const refreshToken = session.token.refresh_token;
  if (!refreshToken) throw new Error('session expired and no refresh token');
  const rReq = refreshExchange({
    host: cfg.imanageHost,
    clientId: cfg.imanageClientId,
    clientSecret: cfg.imanageClientSecret,
    refreshToken,
  });
  const resp = await fetch(rReq.url, { method: 'POST', headers: rReq.headers, body: rReq.body });
  const next = parseTokenResponse(await resp.json().catch(() => ({})));
  // iManage may or may not rotate the refresh token; keep the prior one if absent.
  if (!next.refresh_token) next.refresh_token = refreshToken;
  sessions.set(sid, { token: next, mintedAt: nowSeconds() });
  log({ msg: 'oauth: token refreshed', sid });
  return next.access_token;
}

// ALL /proxy/* → forward to the iManage Work API. The browser sends the Work API
// path (after /proxy), already customer/library-scoped; the server injects the
// access token (X-Auth-Token, never exposed to the browser) and forwards the
// method, query, and body. This is the API proxy that keeps the secret + tokens
// server-side while letting the panel read workspaces/documents/search and PATCH a
// profile. It NEVER logs the forwarded body or the upstream body.
async function handleProxy(
  cfg: ServerConfig,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const sid = sessionIdFromCookie(req);
  const session = sid ? sessions.get(sid) : undefined;
  if (!sid || !session) return json(res, 401, { error: 'not authenticated' });

  let accessToken: string;
  try {
    accessToken = await freshToken(cfg, sid, session);
  } catch (e: any) {
    return json(res, 401, { error: e?.message || 'token refresh failed' });
  }

  // The path after /proxy is the Work API path relative to the version root, e.g.
  // /proxy/customers/1/libraries/ACTIVE_US/workspaces → ${apiBase}/customers/…. We
  // build the target from apiBase so it can only ever reach the iManage host.
  const restPath = url.pathname.replace(/^\/proxy/, '') || '/';
  const target = `${apiBaseUrl(cfg.imanageApiHost ?? cfg.imanageHost)}${restPath}${url.search}`;

  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req);
  try {
    const upstream = await fetch(target, {
      method,
      headers: {
        [AUTH_HEADER]: accessToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    const passthroughType = upstream.headers.get('Content-Type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'Content-Type': passthroughType });
    res.end(buf);
  } catch (e: any) {
    // Log the target path (no query/body) and the error only — never content.
    log({ msg: 'proxy: upstream error', error: e?.message, path: restPath });
    return json(res, 502, { error: 'upstream request failed' });
  }
}

// readRawBody collects the raw request bytes as a utf8 string.
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// createHandler is the request router. Everything is a small handler over the pure
// modules. Exported so a test can drive it with a mock req/res if desired.
export function createHandler(cfg: ServerConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/oauth/install') return handleInstall(cfg, res);
      if (req.method === 'GET' && url.pathname === '/oauth/callback') return await handleOAuthCallback(cfg, url, res);
      if (req.method === 'GET' && url.pathname === '/config') return handleConfig(cfg, res);
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
    log({ msg: 'hanzo imanage service up', port: cfg.port, host: cfg.imanageHost });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
