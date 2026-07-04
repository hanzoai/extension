// The DocuSign install + Connect webhook service. This is the ONLY place the
// DocuSign secret key and the Connect HMAC key exist — both read from the
// environment (never bundled, never sent to the browser). It:
//
//   GET  /oauth/install     → redirect the user to DocuSign's OAuth consent
//   GET  /oauth/callback    → exchange the code for a token, discover the account
//                             base_uri via /oauth/userinfo, and store the token
//   POST /connect           → verify the DocuSign Connect HMAC signature, then on
//                             an envelope reaching "completed" fetch the combined
//                             PDF, extract text, and summarize it via @hanzo/ai
//   GET  /healthz           → readiness
//
// It is a dependency-free Node http handler built on the pure modules (config,
// docusign-oauth, docusign-api, webhook, envelope, hanzo) so it is deployable
// behind hanzoai/ingress as a small service at docusign.hanzo.ai. The pure logic
// it wraps is what the tests cover; the http server is an integration concern.
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment (see config.readServerConfig):
//   DOCUSIGN_CLIENT_ID, DOCUSIGN_CLIENT_SECRET, DOCUSIGN_REDIRECT_URI,
//   DOCUSIGN_CONNECT_HMAC_KEY
//   DOCUSIGN_ENV (demo | production, default demo)
//   HANZO_API_KEY (optional — needed to actually summarize; without it the
//                  webhook verifies + routes but skips summarization)
//   PORT (default 8789)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { OAUTH_SCOPES, readServerConfig, type ServerConfig } from './config.js';
import {
  authorizeUrl,
  tokenExchange,
  parseTokenResponse,
  userInfoUrl,
  parseUserInfo,
  defaultAccount,
  apiBaseUrl,
} from './docusign-oauth.js';
import {
  signatureHeaders,
  verifySignature,
  routeEvent,
  type ConnectAction,
} from './webhook.js';
import { analyzeEnvelope } from './envelope.js';

// A stored account authorization: the token to call the eSignature API and the
// REST base for that account. In-memory here keyed by accountId; a production
// deployment persists this to KMS/Valkey (keyed by accountId) so the webhook can
// act on any authorized account after a restart. The install flow populates it;
// the webhook reads it.
interface AccountAuth {
  accessToken: string;
  refreshToken?: string;
  apiBase: string;
}
const accounts = new Map<string, AccountAuth>();

// readRawBody collects the raw request bytes as a utf8 string. The Connect HMAC
// signature is computed over these RAW bytes, so we must NOT JSON.parse-and-
// reserialize before verifying (key order/whitespace would differ and every
// event would fail). One read, used for both verification and parsing.
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

// GET /oauth/install → 302 to DocuSign's consent screen. `state` is a fresh CSRF
// token; a production deployment persists it (KMS/Valkey) to re-check on
// callback. Here we mint one and carry it — the checkable value is what matters.
function handleInstall(cfg: ServerConfig, res: ServerResponse): void {
  const state = randomUUID();
  const url = authorizeUrl({
    env: cfg.docusignEnv,
    clientId: cfg.docusignClientId,
    redirectUri: cfg.docusignRedirectUri,
    scopes: OAUTH_SCOPES,
    state,
  });
  res.writeHead(302, { Location: url });
  res.end();
}

// GET /oauth/callback?code=…&state=… → exchange the code for a token (secret in
// the Basic header, server-side), then call /oauth/userinfo to discover the
// account's REST base_uri, and store the authorization for the webhook to use.
async function handleOAuthCallback(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  const code = url.searchParams.get('code');
  if (!code) return json(res, 400, { error: 'missing code' });

  const exReq = tokenExchange({
    env: cfg.docusignEnv,
    clientId: cfg.docusignClientId,
    clientSecret: cfg.docusignClientSecret,
    code,
  });
  let tokenSet;
  try {
    const exResp = await fetch(exReq.url, { method: 'POST', headers: exReq.headers, body: exReq.body });
    tokenSet = parseTokenResponse(await exResp.json().catch(() => ({})));
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }

  try {
    const uiResp = await fetch(userInfoUrl(cfg.docusignEnv), {
      headers: { Authorization: `Bearer ${tokenSet.access_token}` },
    });
    const info = parseUserInfo(await uiResp.json().catch(() => ({})));
    const acct = defaultAccount(info);
    accounts.set(acct.accountId, {
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      apiBase: apiBaseUrl(acct.baseUri),
    });
    log({ msg: 'oauth: account authorized', accountId: acct.accountId, accountName: acct.accountName });
    return json(res, 200, { ok: true, installed: true, accountId: acct.accountId, accountName: acct.accountName });
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'userinfo failed' });
  }
}

// handleEnvelopeCompleted is the auto-summary pipeline: for a completed envelope,
// look up the account's stored token and run analyzeEnvelope (fetch combined PDF
// → extract text → summarize). It NEVER throws into the webhook handler (the
// webhook must 200 fast so DocuSign does not retry); it logs the outcome and
// returns the summary (or '') for tests/callers that await it.
async function handleEnvelopeCompleted(
  cfg: ServerConfig,
  action: Extract<ConnectAction, { kind: 'envelope_completed' }>,
): Promise<string> {
  if (!cfg.hanzoApiKey) {
    log({ msg: 'envelope.completed: HANZO_API_KEY unset, skipping summary', envelopeId: action.envelopeId });
    return '';
  }
  const auth = accounts.get(action.accountId);
  if (!auth) {
    log({ msg: 'envelope.completed: no stored authorization for account, skipping', accountId: action.accountId });
    return '';
  }
  try {
    const out = await analyzeEnvelope({
      apiBase: auth.apiBase,
      accountId: action.accountId,
      envelopeId: action.envelopeId,
      accessToken: auth.accessToken,
      actionId: 'summarize',
      ask: { token: cfg.hanzoApiKey },
    });
    log({
      msg: 'envelope.completed: summary generated',
      envelopeId: action.envelopeId,
      pages: out.includedPages,
      totalPages: out.totalPages,
      truncated: out.truncated,
      summaryChars: out.result.length,
    });
    // Deliver hook: a production deployment stores `out.result` (hanzoai/docdb),
    // posts it back to DocuSign as an envelope custom field, or notifies the
    // sender here. The pipeline through summary is complete; the delivery target
    // is a per-deployment choice (documented in the README).
    return out.result;
  } catch (e: any) {
    log({ msg: 'envelope.completed: summary failed', envelopeId: action.envelopeId, error: e?.message });
    return '';
  }
}

// POST /connect → verify, then dispatch. Verification is the trust gate: an event
// with a bad/absent signature is a 401 before any document fetch. DocuSign
// Connect sends one X-DocuSign-Signature-N header per configured HMAC key; we
// accept a message signed with OUR key.
async function handleWebhook(cfg: ServerConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readRawBody(req);
  const sigs = signatureHeaders(req.headers as Record<string, unknown>);

  if (!verifySignature(cfg.connectHmacKey, sigs, raw)) {
    log({ msg: 'connect: signature verification failed' });
    return json(res, 401, { error: 'invalid signature' });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'invalid json' });
  }

  const action = routeEvent(body);
  switch (action.kind) {
    case 'envelope_completed':
      // Acknowledge DocuSign immediately; run the summary pipeline in the
      // background so the webhook returns fast (Connect retries slow endpoints).
      json(res, 200, { ok: true });
      void handleEnvelopeCompleted(cfg, action);
      return;

    case 'ignored':
      return json(res, 200, { ok: true, ignored: action.status || action.event });
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
      if (req.method === 'POST' && url.pathname === '/connect') return await handleWebhook(cfg, req, res);
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
    log({ msg: 'hanzo docusign service up', port: cfg.port, env: cfg.docusignEnv, summarize: !!cfg.hanzoApiKey });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
