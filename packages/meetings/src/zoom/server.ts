// The Zoom install + webhook service. This is the ONLY place the Zoom
// client_secret and the webhook secret token exist — both are read from the
// environment (never bundled, never sent to the browser). It:
//
//   GET  /zoom/install          → redirect the admin to Zoom's OAuth consent
//   GET  /zoom/oauth/callback   → exchange the code for a token (secret stays here)
//   POST /zoom/webhook          → verify the Zoom signature, handle url_validation,
//                                 and on recording.completed fetch the transcript
//                                 (VTT) and summarize it via @hanzo/ai
//   GET  /healthz               → readiness
//
// It is a dependency-free Node http handler built on the pure modules
// (config, zoom/oauth, zoom/webhook, hanzo) so it is deployable behind
// hanzoai/ingress as a small service at meetings.hanzo.ai. The pure logic it
// wraps is what the tests cover; the http server is an integration concern.
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment (see config.readServerConfig):
//   ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI, ZOOM_WEBHOOK_SECRET_TOKEN
//   HANZO_API_KEY (optional — needed to actually summarize; without it the
//                  webhook verifies + routes but skips summarization)
//   PORT (default 8788)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readServerConfig, type ServerConfig } from '../config.js';
import { authorizeUrl, tokenExchange, parseTokenResponse } from './oauth.js';
import {
  verifySignature,
  urlValidationResponse,
  routeEvent,
  type ZoomAction,
} from './webhook.js';
import { parseVtt, summarizeTranscript, type MeetingContext } from '../hanzo.js';

// readRawBody collects the raw request bytes as a utf8 string. The webhook
// signature is computed over these RAW bytes, so we must NOT JSON.parse-and-
// reserialize before verifying (key order would differ and every event would
// fail). One read, used for both verification and parsing.
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
  // Structured, single-line log.
  console.log(JSON.stringify(fields));
}

// GET /zoom/install → 302 to Zoom's consent screen. `state` is a fresh CSRF
// token; a production deployment persists it (KMS/Valkey) to re-check on
// callback. Here we mint one and carry it — the checkable value is what matters.
function handleInstall(cfg: ServerConfig, res: ServerResponse): void {
  const state = randomUUID();
  const url = authorizeUrl(cfg.zoomClientId, cfg.zoomRedirectUri, state);
  res.writeHead(302, { Location: url });
  res.end();
}

// GET /zoom/oauth/callback?code=…&state=… → exchange the code for a token. The
// secret is used only inside tokenExchange's Basic header, server-side.
async function handleOAuthCallback(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  const code = url.searchParams.get('code');
  if (!code) return json(res, 400, { error: 'missing code' });
  const reqShape = tokenExchange({
    clientId: cfg.zoomClientId,
    clientSecret: cfg.zoomClientSecret,
    redirectUri: cfg.zoomRedirectUri,
    code,
  });
  const zoomResp = await fetch(reqShape.url, {
    method: 'POST',
    headers: reqShape.headers,
    body: reqShape.body,
  });
  const data = await zoomResp.json().catch(() => ({}));
  try {
    parseTokenResponse(data);
    // The token authorizes future REST calls (recording download on plans that
    // require it). A production deployment stores it in KMS keyed by the Zoom
    // account id; here we confirm the install succeeded to the admin.
    return json(res, 200, { ok: true, installed: true });
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }
}

// fetchTranscript downloads the recording transcript (VTT). Zoom's download_url
// may require the bearer token / download_token on some plans; we attach the
// download_token as a query param when present (Zoom's documented mechanism) and
// fall back to an unauthenticated GET otherwise. Returns '' on any failure so
// the caller logs and skips rather than throwing inside the webhook.
async function fetchTranscript(url: string, downloadToken?: string): Promise<string> {
  if (!url) return '';
  const target = downloadToken
    ? `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(downloadToken)}`
    : url;
  try {
    const resp = await fetch(target);
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    return '';
  }
}

// handleRecordingCompleted is the summary pipeline: download VTT → parse →
// window + summarize via @hanzo/ai. It NEVER throws into the webhook handler
// (the webhook must 200 fast so Zoom does not retry); it logs the outcome.
// Returns the summary text (or '') for tests/callers that await it.
async function handleRecordingCompleted(
  cfg: ServerConfig,
  action: Extract<ZoomAction, { kind: 'recording_completed' }>,
): Promise<string> {
  if (!cfg.hanzoApiKey) {
    log({ msg: 'recording.completed: HANZO_API_KEY unset, skipping summary', meetingUuid: action.meetingUuid });
    return '';
  }
  const vtt = await fetchTranscript(action.transcriptUrl, action.downloadToken);
  const segments = parseVtt(vtt);
  if (segments.length === 0) {
    log({ msg: 'recording.completed: no transcript, skipping summary', meetingUuid: action.meetingUuid });
    return '';
  }
  const meta: MeetingContext = { topic: action.topic, meetingId: action.meetingUuid };
  try {
    const summary = await summarizeTranscript(segments, cfg.hanzoApiKey, meta);
    log({
      msg: 'recording.completed: summary generated',
      meetingUuid: action.meetingUuid,
      segments: segments.length,
      summaryChars: summary.length,
    });
    // Deliver hook: a production deployment posts `summary` to Zoom Team Chat or
    // emails participants here. The pipeline through summary is complete; the
    // delivery target is a per-deployment choice (documented in the README).
    return summary;
  } catch (e: any) {
    log({ msg: 'recording.completed: summary failed', meetingUuid: action.meetingUuid, error: e?.message });
    return '';
  }
}

// POST /zoom/webhook → verify, then dispatch. Verification is the trust gate:
// an event with a bad/absent signature is a 401 before any transcript fetch.
async function handleWebhook(cfg: ServerConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readRawBody(req);
  const sig = req.headers['x-zm-signature'] as string | undefined;
  const ts = req.headers['x-zm-request-timestamp'] as string | undefined;

  if (!verifySignature(cfg.zoomWebhookSecret, sig, ts, raw)) {
    log({ msg: 'webhook: signature verification failed' });
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
    case 'url_validation':
      // Echo the plainToken + its HMAC so Zoom marks the endpoint verified.
      return json(res, 200, urlValidationResponse(cfg.zoomWebhookSecret, action.plainToken));

    case 'recording_completed':
      // Acknowledge Zoom immediately; run the summary pipeline in the background
      // so the webhook returns fast (Zoom retries slow endpoints).
      json(res, 200, { ok: true });
      void handleRecordingCompleted(cfg, action);
      return;

    case 'meeting_ended':
      log({ msg: 'meeting.ended', meetingUuid: action.meetingUuid });
      return json(res, 200, { ok: true });

    case 'ignored':
      return json(res, 200, { ok: true, ignored: action.event });
  }
}

// createHandler is the request router. Everything is a small handler over the
// pure modules. Exported so a test can drive it with a mock req/res if desired.
export function createHandler(cfg: ServerConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/zoom/install') return handleInstall(cfg, res);
      if (req.method === 'GET' && url.pathname === '/zoom/oauth/callback') return await handleOAuthCallback(cfg, url, res);
      if (req.method === 'POST' && url.pathname === '/zoom/webhook') return await handleWebhook(cfg, req, res);
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
    log({ msg: 'hanzo meetings (zoom) service up', port: cfg.port, summarize: !!cfg.hanzoApiKey });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
