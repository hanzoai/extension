// The SMART OAuth token-exchange + FHIR-proxy service. This is the ONLY place
// the confidential-app client_secret exists — it is read from the environment
// (never bundled, never sent to the browser). It is also where the PHI-bearing
// FHIR access token lives: the browser NEVER receives the FHIR token, so a PHI
// token can never leak into localStorage, a screenshot, or a browser log. The
// SPA holds only an opaque server session id; every FHIR read goes through the
// proxy here, which attaches the token server-side.
//
// A dependency-free Node http handler built on the pure modules (config,
// smart-oauth, fhir-client) so it deploys behind hanzoai/ingress as a small
// service at epic.hanzo.ai. Documented here; the PURE logic it wraps is what the
// tests cover (an http server is an integration concern, not a unit).
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment:
//   SMART_CLIENT_ID       — the SMART app's client id (public; also stamped into the SPA)
//   SMART_REDIRECT_URI    — e.g. https://epic.hanzo.ai/oauth/callback
//   PORT                  — listen port                         (default 8791)
// Optional:
//   SMART_CLIENT_SECRET   — the confidential-app secret (SERVER ONLY). Omit for a
//                           public app (PKCE-only). Never bundled.
//   SESSION_TTL_SECONDS   — how long a server session lives     (default 3600)
//
// PHI: this service NEVER logs a FHIR response body, an access token, a patient
// id, or any resource. It logs only non-PHI operational facts (a session id, a
// resource type, a status code).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { normalizeBase, smartConfigUrl } from './config.js';
import {
  parseSmartConfiguration,
  tokenExchange,
  tokenRefresh,
  parseTokenResponse,
  isExpired,
  type SmartContext,
  type SmartConfiguration,
} from './smart-oauth.js';

// ── Environment ────────────────────────────────────────────────────────────

export interface ServerConfig {
  /** SMART app client id (public). */
  clientId: string;
  /** Confidential-app secret (SERVER ONLY). Empty → public app (PKCE-only). */
  clientSecret: string;
  /** OAuth redirect registered on the app. */
  redirectUri: string;
  /** Server-session lifetime (ms). */
  sessionTtlMs: number;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required value is missing — a server
// that cannot exchange codes must not pretend to start. The client_secret is the
// one OPTIONAL field (a public app has none). Pure given an env map, so it is
// unit-tested without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const clientId = env.SMART_CLIENT_ID;
  const redirectUri = env.SMART_REDIRECT_URI;
  const missing: string[] = [];
  if (!clientId) missing.push('SMART_CLIENT_ID');
  if (!redirectUri) missing.push('SMART_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    clientId: clientId!,
    clientSecret: env.SMART_CLIENT_SECRET || '',
    redirectUri: redirectUri!,
    sessionTtlMs: (Number(env.SESSION_TTL_SECONDS) || 3600) * 1000,
    port: Number(env.PORT) || 8791,
  };
}

// ── Server sessions (PHI lives here, never in the browser) ────────────────
//
// A session binds the browser to a SMART context server-side. The browser holds
// ONLY the opaque `sid`; the FHIR access token + patient id stay in this map.
// In-memory is correct for a single-instance service; a multi-instance
// deployment swaps this for hanzoai/kv (Valkey) with the SAME interface, no call
// site changes. Kept behind a tiny interface so that swap is one file.

// A pending auth: the PKCE verifier + discovered token endpoint + FHIR base,
// stashed under `state` between the authorize redirect and the callback.
interface PendingAuth {
  state: string;
  codeVerifier: string;
  tokenEndpoint: string;
  fhirBase: string;
}

export interface SessionStore {
  putPending(p: PendingAuth): void;
  takePending(state: string): PendingAuth | undefined;
  putSession(sid: string, ctx: SmartContext, fhirBase: string, tokenEndpoint: string): void;
  getSession(sid: string): ServerSession | undefined;
  updateSession(sid: string, ctx: SmartContext): void;
}

export interface ServerSession {
  ctx: SmartContext;
  fhirBase: string;
  tokenEndpoint: string;
}

// memoryStore is the default in-memory SessionStore. One place; swap for Valkey
// in production by implementing the same interface.
export function memoryStore(): SessionStore {
  const pending = new Map<string, PendingAuth>();
  const sessions = new Map<string, ServerSession>();
  return {
    putPending: (p) => void pending.set(p.state, p),
    takePending: (state) => {
      const p = pending.get(state);
      if (p) pending.delete(state);
      return p;
    },
    putSession: (sid, ctx, fhirBase, tokenEndpoint) =>
      void sessions.set(sid, { ctx, fhirBase, tokenEndpoint }),
    getSession: (sid) => sessions.get(sid),
    updateSession: (sid, ctx) => {
      const s = sessions.get(sid);
      if (s) sessions.set(sid, { ...s, ctx });
    },
  };
}

// ── Discovery + token exchange (server-side) ──────────────────────────────

// discoverSmart fetches and parses `<iss>/.well-known/smart-configuration`.
// `doFetch` is injectable for tests. The FHIR base is validated to be an http(s)
// URL before we ever talk to it (SSRF boundary guard — a hostile `iss` cannot
// point us at an internal host over a non-http scheme).
export async function discoverSmart(iss: string, doFetch: typeof fetch = fetch): Promise<SmartConfiguration> {
  assertHttpUrl(iss, 'iss');
  const resp = await doFetch(smartConfigUrl(iss), { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`SMART discovery ${resp.status}`);
  return parseSmartConfiguration(await resp.json());
}

// assertHttpUrl throws unless `u` is an absolute http(s) URL. Guards the two
// externally-influenced URLs (the launch `iss` and a FHIR request path) against
// scheme-based SSRF. Boundary guard.
function assertHttpUrl(u: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} must be http(s)`);
  }
}

// exchangeCode runs the server-side code→token exchange with the confidential
// secret and the PKCE verifier, returning the parsed SmartContext. `doFetch` is
// injectable. NEVER logs the code, the tokens, or the patient id.
export async function exchangeCode(
  cfg: ServerConfig,
  pending: PendingAuth,
  code: string,
  doFetch: typeof fetch = fetch,
): Promise<SmartContext> {
  const shape = tokenExchange({
    tokenEndpoint: pending.tokenEndpoint,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    code,
    codeVerifier: pending.codeVerifier,
    clientSecret: cfg.clientSecret || undefined,
  });
  const resp = await doFetch(shape.url, { method: 'POST', headers: shape.headers, body: shape.body });
  const data = await resp.json().catch(() => ({}));
  return parseTokenResponse(data);
}

// ensureFreshToken refreshes a session's access token when it is at/near expiry
// and a refresh_token is available, persisting the new context. Returns the live
// access token. Never logs it.
export async function ensureFreshToken(
  cfg: ServerConfig,
  store: SessionStore,
  sid: string,
  session: ServerSession,
  doFetch: typeof fetch = fetch,
): Promise<string> {
  if (!isExpired(session.ctx) || !session.ctx.refreshToken) return session.ctx.accessToken;
  const shape = tokenRefresh({
    tokenEndpoint: session.tokenEndpoint,
    clientId: cfg.clientId,
    refreshToken: session.ctx.refreshToken,
    clientSecret: cfg.clientSecret || undefined,
  });
  const resp = await doFetch(shape.url, { method: 'POST', headers: shape.headers, body: shape.body });
  const data = await resp.json().catch(() => ({}));
  const refreshed = parseTokenResponse(data);
  // A refresh may omit a new refresh_token — keep the old one.
  const merged: SmartContext = {
    ...refreshed,
    refreshToken: refreshed.refreshToken || session.ctx.refreshToken,
    patient: refreshed.patient || session.ctx.patient,
  };
  store.updateSession(sid, merged);
  return merged.accessToken;
}

// ── FHIR proxy path guard (pure) ──────────────────────────────────────────

// The resource types the proxy will forward — exactly the read scopes this app
// holds. A request for anything else is refused BEFORE a token is attached, so
// the proxy can never be turned into a general-purpose FHIR gateway.
const PROXY_ALLOWED = new Set([
  'Patient',
  'Condition',
  'MedicationRequest',
  'Observation',
  'AllergyIntolerance',
  'DocumentReference',
]);

// resolveProxyTarget validates a proxied FHIR path and returns the absolute URL
// to call, or throws. The SPA sends a RELATIVE FHIR path (e.g.
// `Condition?patient=123&_count=50`) OR a full same-origin `next` page URL; both
// must resolve under the session's FHIR base and hit an allowed resource type.
// This is the defence that a session can only ever read its own patient's
// allowed resources. Pure.
export function resolveProxyTarget(fhirBase: string, requestedPath: string): string {
  const base = normalizeBase(fhirBase);
  // Absolute URL (a pagination `next` link) must be under the same FHIR base.
  const absolute = /^https?:\/\//i.test(requestedPath);
  const url = absolute ? requestedPath : `${base}/${requestedPath.replace(/^\/+/, '')}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid FHIR path');
  }
  if (!url.startsWith(base)) throw new Error('FHIR path escapes the session base');
  const segment = parsed.pathname.slice(base.length ? new URL(base).pathname.length : 0);
  const resourceType = segment.replace(/^\/+/, '').split(/[/?]/)[0];
  if (!PROXY_ALLOWED.has(resourceType)) {
    throw new Error(`resource ${resourceType || '(none)'} not permitted`);
  }
  return url;
}

// ── HTTP glue ──────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// sessionCookie / readSid — the browser holds ONLY the opaque session id, in an
// HttpOnly, Secure, SameSite=Lax cookie so client JS (and any injected script)
// cannot read it and it is not exposed to localStorage.
function sessionCookie(sid: string, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `epic_sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export function readSid(cookieHeader: string | undefined): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.split('=');
    if (k?.trim() === 'epic_sid') return (v ?? '').trim();
  }
  return '';
}

// The request router. Each handler is a thin wrapper over the pure modules; the
// service state is the session store. NO PHI is ever logged.
export function createHandler(cfg: ServerConfig, store: SessionStore = memoryStore()) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
    try {
      // POST /oauth/prepare { iss, state, codeVerifier } → discover endpoints,
      // stash the pending auth, return { authorizationEndpoint, tokenEndpoint }.
      if (req.method === 'POST' && url.pathname === '/oauth/prepare') {
        const { iss, state, codeVerifier } = JSON.parse((await readBody(req)) || '{}');
        if (!iss || !state || !codeVerifier) return json(res, 400, { error: 'missing iss/state/codeVerifier' });
        const smart = await discoverSmart(iss);
        store.putPending({ state, codeVerifier, tokenEndpoint: smart.tokenEndpoint, fhirBase: normalizeBase(iss) });
        return json(res, 200, { authorizationEndpoint: smart.authorizationEndpoint, tokenEndpoint: smart.tokenEndpoint });
      }

      // POST /oauth/callback { code, state } → exchange (secret + PKCE server-
      // side), mint a server session, set the opaque cookie. The browser gets
      // back ONLY the non-PHI context it needs to render (patient id + scope),
      // never the FHIR token.
      if (req.method === 'POST' && url.pathname === '/oauth/callback') {
        const { code, state } = JSON.parse((await readBody(req)) || '{}');
        if (!code || !state) return json(res, 400, { error: 'missing code/state' });
        const pending = store.takePending(state);
        if (!pending) return json(res, 400, { error: 'unknown or replayed state' });
        const ctx = await exchangeCode(cfg, pending, code);
        const sid = randomUUID();
        const fhirBase = ctx.fhirBase || pending.fhirBase;
        store.putSession(sid, ctx, fhirBase, pending.tokenEndpoint);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(sid, cfg.sessionTtlMs) });
        res.end(JSON.stringify({ patient: ctx.patient, scope: ctx.scope }));
        return;
      }

      // GET /fhir?path=<relative-or-next-url> → the PHI proxy. Reads the session
      // from the cookie, refreshes the token if needed, attaches it server-side,
      // and streams the FHIR JSON back. The token never touches the browser.
      if (req.method === 'GET' && url.pathname === '/fhir') {
        const sid = readSid(req.headers.cookie);
        const session = sid ? store.getSession(sid) : undefined;
        if (!session) return json(res, 401, { error: 'no session' });
        const path = url.searchParams.get('path') || '';
        let target: string;
        try {
          target = resolveProxyTarget(session.fhirBase, path);
        } catch (e: unknown) {
          return json(res, 400, { error: (e as Error).message });
        }
        const token = await ensureFreshToken(cfg, store, sid, session);
        const upstream = await fetch(target, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json' },
        });
        const text = await upstream.text();
        // Pass through the FHIR JSON verbatim; do NOT log it (PHI).
        res.writeHead(upstream.status, { 'Content-Type': 'application/fhir+json' });
        res.end(text);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
      return json(res, 404, { error: 'not found' });
    } catch (e: unknown) {
      // Operational error only — never include a response body (may be PHI).
      return json(res, 500, { error: (e as Error)?.message || 'internal error' });
    }
  };
}

// main boots the http server when run directly. Import-safe: only the direct
// entry starts listening, so tests import the pure handlers without a port.
export function main(): void {
  const cfg = readServerConfig(process.env);
  const server = createServer(createHandler(cfg));
  server.listen(cfg.port, () => {
    console.log(
      JSON.stringify({
        msg: 'epic smart-on-fhir service up',
        port: cfg.port,
        confidential: !!cfg.clientSecret,
      }),
    );
  });
}

// ESM entry check: run main() only when this file is the process entry.
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
