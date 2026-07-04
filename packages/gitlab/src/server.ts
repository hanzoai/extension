/**
 * Webhook HTTP server — the process entrypoint. Standard-library `http` only;
 * GitLab has no signing middleware (the security gate is a shared secret token,
 * not a body HMAC), so the server reads the raw body, verifies `X-Gitlab-Token`
 * in constant time, parses the JSON, routes on `X-Gitlab-Event`, and dispatches.
 *
 * GitLab retries a delivery that does not get a prompt response, so we ACK 200
 * immediately after verification and run the model work off the response path.
 * The webhook mount is `/v1/gitlab/webhook` — Hanzo convention is `/v1/...`,
 * never an `/api/` prefix.
 *
 * Adds a `/health` readiness probe and graceful shutdown for k8s (hanzoai/ingress).
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { loadConfig, type Config } from './config.js';
import { createService, dispatch, type Service } from './app.js';
import { verifyToken, TOKEN_HEADER, EVENT_HEADER, type RoutablePayload } from './webhook.js';

/** Webhook mount path. */
export const WEBHOOK_PATH = '/v1/gitlab/webhook';

/** Read the full request body as a UTF-8 string, bounded so a flood can't OOM. */
function readBody(req: IncomingMessage, limit = 25 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Handle one webhook request against a {@link Service}. Exposed for tests so the
 * verify→route→dispatch path can be exercised without binding a socket. Returns
 * once the response has been sent; model work is dispatched in the background
 * (GitLab expects a fast ACK and retries otherwise).
 */
export async function handleRequest(service: Service, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === '/health' || req.url === '/healthz') {
    return send(res, 200, { status: 'ok', model: service.config.model });
  }
  if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) {
    return send(res, 404, { error: 'not found' });
  }

  const token = header(req, TOKEN_HEADER);
  if (!verifyToken(token, service.config.gitlab.webhookSecret)) {
    return send(res, 401, { error: 'invalid token' });
  }

  const event = header(req, EVENT_HEADER) ?? '';
  let payload: RoutablePayload & Record<string, unknown>;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'invalid body' });
  }

  // ACK before the model call — GitLab retries slow deliveries.
  send(res, 202, { status: 'accepted' });

  try {
    await dispatch(event, payload, service.client, service.config, service.run);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'dispatch failed', event, error: String(err) }));
  }
}

/** Read a single header value as a string (Node lowercases header names). */
function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Build the HTTP server around a {@link Service}. Exposed for tests/embedding. */
export function createWebhookServer(service: Service): Server {
  return createServer((req, res) => {
    handleRequest(service, req, res).catch((err) => {
      console.error(JSON.stringify({ msg: 'request failed', error: String(err) }));
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });
}

/** Boot from the environment and listen. Wires graceful shutdown. */
export function start(config: Config = loadConfig()): Server {
  const service = createService(config);
  const server = createWebhookServer(service);

  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        msg: 'hanzo-gitlab listening',
        port: config.port,
        path: WEBHOOK_PATH,
        model: config.model,
      }),
    );
  });

  const shutdown = (signal: string) => {
    console.log(JSON.stringify({ msg: 'shutting down', signal }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Run when invoked directly (`node dist/server.js`), not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
