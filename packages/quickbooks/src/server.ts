// The QuickBooks install + API-proxy service. This is the ONLY place the Intuit
// client secret and the OAuth tokens exist — the secret is read from the
// environment (never bundled, never sent to the browser); the tokens are minted
// here at callback and held server-side, keyed by realmId (company id). It:
//
//   GET  /oauth/install       → redirect the user to Intuit's OAuth consent
//   GET  /oauth/callback      → exchange the code for tokens, capture the realmId,
//                               and store the authorization for the company
//   GET  /healthz             → readiness
//   GET  /v1/companies        → the company ids currently authorized (no tokens)
//   POST /v1/analyze          → run an AI action/question over a report or an
//                               entity query for a company — Intuit token +
//                               Hanzo key stay server-side (the panel proxy path)
//
// It is a dependency-free Node http handler built on the pure modules (config,
// qbo-oauth, qbo-api, qbo-analysis, hanzo, actions) so it is deployable behind
// hanzoai/ingress at quickbooks.hanzo.ai. The pure logic it wraps is what the
// tests cover; the http server is an integration concern.
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment (see config.readServerConfig):
//   INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET, INTUIT_REDIRECT_URI
//   QBO_ENV (sandbox | production, default sandbox)
//   HANZO_API_KEY (optional — needed for the proxy to run models; without it
//                  /v1/analyze returns 503 and the panel uses its own pasted key)
//   PORT (default 8790)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { OAUTH_SCOPES, readServerConfig, type ServerConfig } from './config.js';
import {
  authorizeUrl,
  tokenExchange,
  refreshExchange,
  parseTokenResponse,
  parseCallback,
  type QboTokenSet,
} from './qbo-oauth.js';
import { analyzeReport, analyzeQuery } from './qbo-analysis.js';
import { isActionId } from './actions.js';
import { REPORTS, type ReportName } from './qbo-api.js';

// A stored company authorization: the tokens to call the Accounting API. In
// memory here keyed by realmId; a production deployment persists this to
// KMS/Valkey (keyed by realmId) so the proxy can act on any authorized company
// after a restart. The install flow populates it; the proxy reads it.
interface CompanyAuth {
  accessToken: string;
  refreshToken: string;
}
const companies = new Map<string, CompanyAuth>();

// Pending OAuth states: the CSRF token minted at /oauth/install, checked at
// callback. A production deployment persists these (KMS/Valkey) so a callback
// survives a restart; in-memory is correct for a single instance.
const pendingStates = new Set<string>();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

// readJsonBody collects and parses a JSON request body. Returns {} for an empty
// body; throws on malformed JSON so the handler can 400.
async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

// exchangeToken POSTs a prepared OAuth request and parses the token set. One
// fetch path for both code-exchange and refresh.
async function exchangeToken(prepared: { url: string; headers: Record<string, string>; body: string }): Promise<QboTokenSet> {
  const resp = await fetch(prepared.url, { method: 'POST', headers: prepared.headers, body: prepared.body });
  return parseTokenResponse(await resp.json().catch(() => ({})));
}

// GET /oauth/install → 302 to Intuit's consent screen. `state` is a fresh CSRF
// token remembered until callback.
function handleInstall(cfg: ServerConfig, res: ServerResponse): void {
  const state = randomUUID();
  pendingStates.add(state);
  const url = authorizeUrl({
    clientId: cfg.intuitClientId,
    redirectUri: cfg.intuitRedirectUri,
    scopes: OAUTH_SCOPES,
    state,
  });
  res.writeHead(302, { Location: url });
  res.end();
}

// GET /oauth/callback?code=…&state=…&realmId=… → validate state, exchange the
// code for tokens (secret in the Basic header, server-side), and store the
// authorization keyed by realmId (the company id Intuit returns on the redirect).
async function handleOAuthCallback(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  let cb;
  try {
    cb = parseCallback(url.searchParams);
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'invalid callback' });
  }
  if (!pendingStates.delete(cb.state)) {
    return json(res, 400, { error: 'invalid or expired state' });
  }

  try {
    const tokens = await exchangeToken(
      tokenExchange({
        clientId: cfg.intuitClientId,
        clientSecret: cfg.intuitClientSecret,
        code: cb.code,
        redirectUri: cfg.intuitRedirectUri,
      }),
    );
    companies.set(cb.realmId, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    log({ msg: 'oauth: company authorized', realmId: cb.realmId });
    return json(res, 200, { ok: true, installed: true, realmId: cb.realmId });
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }
}

// withFreshToken runs `call` with the company's access token, transparently
// refreshing once on a 401 (expired access token) and retrying. This is the ONE
// place token refresh happens, so every proxied read gets it for free.
async function withFreshToken<T>(
  cfg: ServerConfig,
  realmId: string,
  call: (accessToken: string) => Promise<T>,
): Promise<T> {
  const auth = companies.get(realmId);
  if (!auth) throw new Error(`company ${realmId} is not authorized`);
  try {
    return await call(auth.accessToken);
  } catch (e: any) {
    if (!/\b401\b/.test(String(e?.message))) throw e;
    const tokens = await exchangeToken(
      refreshExchange({
        clientId: cfg.intuitClientId,
        clientSecret: cfg.intuitClientSecret,
        refreshToken: auth.refreshToken,
      }),
    );
    companies.set(realmId, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    log({ msg: 'oauth: token refreshed', realmId });
    return call(tokens.accessToken);
  }
}

// resolveReportName narrows an inbound report name to a known REPORTS value,
// throwing on anything else (boundary guard) so the proxy never forwards an
// arbitrary path segment.
function resolveReportName(name: unknown): ReportName {
  const values = Object.values(REPORTS) as string[];
  if (typeof name === 'string' && values.includes(name)) return name as ReportName;
  throw new Error(`unknown report: ${String(name)}`);
}

// POST /v1/analyze → the panel's server-side path. Body:
//   { realmId, kind: "report", name, params?, actionId? | task? }
//   { realmId, kind: "query", statement, entity, actionId? | task? }
// The Intuit token and the Hanzo key both stay server-side. Requires
// HANZO_API_KEY (else 503 — the panel falls back to its own pasted-key path).
async function handleAnalyze(cfg: ServerConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cfg.hanzoApiKey) {
    return json(res, 503, { error: 'proxy AI disabled: HANZO_API_KEY unset' });
  }
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'invalid json' });
  }

  const realmId = String(body?.realmId ?? '');
  if (!realmId) return json(res, 400, { error: 'missing realmId' });
  if (body?.actionId && !isActionId(body.actionId)) {
    return json(res, 400, { error: `unknown action: ${body.actionId}` });
  }
  const askOpts = { token: cfg.hanzoApiKey, model: typeof body?.model === 'string' ? body.model : undefined };

  try {
    if (body?.kind === 'report') {
      const name = resolveReportName(body?.name);
      const out = await withFreshToken(cfg, realmId, (accessToken) =>
        analyzeReport({
          env: cfg.qboEnv,
          realmId,
          accessToken,
          name,
          params: typeof body?.params === 'object' && body.params ? body.params : undefined,
          actionId: body?.actionId,
          task: body?.task,
          ask: askOpts,
        }),
      );
      return json(res, 200, out);
    }
    if (body?.kind === 'query') {
      const statement = String(body?.statement ?? '');
      const entity = String(body?.entity ?? '');
      if (!statement || !entity) return json(res, 400, { error: 'query needs statement and entity' });
      const out = await withFreshToken(cfg, realmId, (accessToken) =>
        analyzeQuery({
          env: cfg.qboEnv,
          realmId,
          accessToken,
          statement,
          entity,
          actionId: body?.actionId,
          task: body?.task,
          ask: askOpts,
        }),
      );
      return json(res, 200, out);
    }
    return json(res, 400, { error: 'kind must be "report" or "query"' });
  } catch (e: any) {
    log({ msg: 'analyze failed', realmId, error: e?.message });
    return json(res, 400, { error: e?.message || 'analyze failed' });
  }
}

// createHandler is the request router. Everything is a small handler over the
// pure modules. Exported so a test can drive it with a mock req/res if desired.
export function createHandler(cfg: ServerConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/oauth/install') return handleInstall(cfg, res);
      if (req.method === 'GET' && url.pathname === '/oauth/callback') return await handleOAuthCallback(cfg, url, res);
      if (req.method === 'POST' && url.pathname === '/v1/analyze') return await handleAnalyze(cfg, req, res);
      if (req.method === 'GET' && url.pathname === '/v1/companies') {
        return json(res, 200, { companies: Array.from(companies.keys()) });
      }
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
    log({ msg: 'hanzo quickbooks service up', port: cfg.port, env: cfg.qboEnv, proxyAi: !!cfg.hanzoApiKey });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
