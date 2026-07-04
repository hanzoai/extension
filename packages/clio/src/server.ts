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
import { createHmac, timingSafeEqual } from 'node:crypto';
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

// verifyNonce checks Clio's Custom Action HMAC. Clio signs the deep-link params
// with HMAC-SHA256 keyed by the app's client_secret; the signed string is the
// concatenation Clio documents (user_id + subject_url ...). Constant-time
// compare so the check is not a timing oracle. Exposed for a unit test.
export function verifyNonce(signedPayload: string, nonce: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(nonce);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

// GET /custom-action?…  → verify Clio's nonce, then redirect the browser to the
// SPA landing (index.html) with the matter id, so the button opens the app in
// the right matter context. A bad nonce is rejected (this is the trust edge).
function handleCustomAction(env: Env, url: URL, res: ServerResponse): void {
  const ctx = parseCustomAction(url.searchParams);
  // Clio's signed string is user_id + subject_url per its Custom Actions spec.
  const signed = `${ctx.userId}${ctx.subjectUrl}`;
  if (!ctx.nonce || !verifyNonce(signed, ctx.nonce, env.clientSecret)) {
    return json(res, 403, { error: 'invalid custom action nonce' });
  }
  const dest = `/index.html?matter_id=${ctx.matterId ?? ''}`;
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
        return handleCustomAction(env, url, res);
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
// entry starts listening, so tests can import verifyNonce/readEnv without a port.
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
