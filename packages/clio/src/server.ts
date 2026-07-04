// The token-exchange + Clio-proxy service. This is the ONLY place the Clio
// client_secret exists — it is read from the environment (never bundled, never
// sent to the browser). The client app (app.ts) talks to THIS service for the
// OAuth code→token exchange, token refresh, the Custom Action nonce check, and
// (optionally) as a proxy for Clio API calls so a Clio token never has to be
// handed to the browser either.
//
// It is a dependency-free Node http handler built on the pure modules
// (clio-oauth, clio-api, custom-action) so it is deployable behind
// hanzoai/ingress as a small service at clio.hanzo.ai. Documented here; the
// pure logic it wraps is what the tests cover (an http server is an integration
// concern, not a unit).
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment:
//   CLIO_CLIENT_ID       — the Developer App's key
//   CLIO_CLIENT_SECRET   — the Developer App's secret  (SERVER ONLY)
//   CLIO_REDIRECT_URI    — e.g. https://clio.hanzo.ai/oauth/callback
//   CLIO_REGION          — us | eu | au | ca            (default us)
//   PORT                 — listen port                  (default 8787)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { clioBase, type ClioRegion } from './config.js';
import { tokenExchange, tokenRefresh, parseTokenResponse } from './clio-oauth.js';
import { parseCustomAction } from './custom-action.js';

interface Env {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  region: ClioRegion;
  port: number;
}

// readEnv fails fast (throws) if a required secret is missing — a server that
// can't exchange tokens must not pretend to start. No default for the secret.
export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const clientId = env.CLIO_CLIENT_ID;
  const clientSecret = env.CLIO_CLIENT_SECRET;
  const redirectUri = env.CLIO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('CLIO_CLIENT_ID, CLIO_CLIENT_SECRET and CLIO_REDIRECT_URI are required');
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    region: (env.CLIO_REGION as ClioRegion) || 'us',
    port: Number(env.PORT) || 8787,
  };
}

// customActionRedirect builds the SPA landing URL for a verified Custom Action
// deep-link. Clio's nonce is NOT locally verifiable — it is a single-use code
// the SPA must replay to the Clio API (Clio validates server-side, 403 on a bad
// one). So the server just parses the deep-link and forwards the matter id AND
// the nonce into the SPA, which carries the nonce on its first authenticated
// Clio call. Pure (given the query), so it is unit-tested. Returns '' when the
// deep-link is not a matter action (nothing to open).
export function customActionRedirect(search: URLSearchParams): string {
  const ctx = parseCustomAction(search);
  if (!ctx.matterId) return '';
  const q = new URLSearchParams({ matter_id: String(ctx.matterId) });
  if (ctx.nonce) q.set('custom_action_nonce', ctx.nonce);
  return `/index.html?${q.toString()}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

// POST /oauth/callback  { code } → exchanges for tokens (secret stays here) and
// returns the TokenSet to the app. The app never sees the client_secret.
async function handleCallback(env: Env, base: string, res: ServerResponse, body: string): Promise<void> {
  const { code } = JSON.parse(body || '{}');
  if (!code) return json(res, 400, { error: 'missing code' });
  const reqShape = tokenExchange({
    base,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    code,
  });
  const clioResp = await fetch(reqShape.url, { method: 'POST', headers: reqShape.headers, body: reqShape.body });
  const data = await clioResp.json().catch(() => ({}));
  try {
    return json(res, 200, parseTokenResponse(data));
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }
}

// POST /oauth/refresh  { refresh_token } → refreshes; same secret-side pattern.
async function handleRefresh(env: Env, base: string, res: ServerResponse, body: string): Promise<void> {
  const { refresh_token } = JSON.parse(body || '{}');
  if (!refresh_token) return json(res, 400, { error: 'missing refresh_token' });
  const reqShape = tokenRefresh({
    base,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: refresh_token,
  });
  const clioResp = await fetch(reqShape.url, { method: 'POST', headers: reqShape.headers, body: reqShape.body });
  const data = await clioResp.json().catch(() => ({}));
  try {
    return json(res, 200, parseTokenResponse(data));
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'refresh failed' });
  }
}

// GET /custom-action?…  → redirect the browser to the SPA landing (index.html)
// with the matter id + the single-use nonce, so the app opens on the right
// matter and replays the nonce to Clio for server-side validation. A non-matter
// (or malformed) deep-link falls back to the SPA root.
function handleCustomAction(url: URL, res: ServerResponse): void {
  const dest = customActionRedirect(url.searchParams) || '/index.html';
  res.writeHead(302, { Location: dest });
  res.end();
}

// The request router. Everything is a small handler over the pure modules.
export function createHandler(env: Env) {
  const base = clioBase(env.region);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${env.port}`);
    try {
      if (req.method === 'POST' && url.pathname === '/oauth/callback') {
        return await handleCallback(env, base, res, await readBody(req));
      }
      if (req.method === 'POST' && url.pathname === '/oauth/refresh') {
        return await handleRefresh(env, base, res, await readBody(req));
      }
      if (req.method === 'GET' && url.pathname === '/custom-action') {
        return handleCustomAction(url, res);
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e: any) {
      return json(res, 500, { error: e?.message || 'internal error' });
    }
  };
}

// main boots the http server when run directly. Import-safe: only the direct
// entry starts listening, so tests can import readEnv/customActionRedirect
// without opening a port.
export function main(): void {
  const env = readEnv();
  const server = createServer(createHandler(env));
  server.listen(env.port, () => {
    // Structured, single-line startup log.
    console.log(JSON.stringify({ msg: 'clio token-exchange service up', port: env.port, region: env.region }));
  });
}

// ESM entry check: run main() only when this file is the process entry.
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
