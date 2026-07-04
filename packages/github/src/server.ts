/**
 * Webhook HTTP server — the process entrypoint. Standard-library `http` plus
 * Octokit's node middleware, which verifies the `X-Hub-Signature-256` HMAC and
 * dispatches into the handlers registered by `app.ts`. Adds a `/health`
 * readiness probe and graceful shutdown for k8s (hanzoai/ingress).
 *
 * Webhook path is `/v1/github/webhooks` — Hanzo convention is `/v1/...`, never
 * an `/api/` prefix (api.* is the host).
 */

import { createServer, type Server } from 'node:http';
import { App, createNodeMiddleware } from '@octokit/app';
import { loadConfig, type Config } from './config.js';
import { createApp } from './app.js';

/** Webhook mount path. `createNodeMiddleware` serves `<prefix>/webhooks`. */
export const WEBHOOK_PATH_PREFIX = '/v1/github';

/** Build the HTTP server around an Octokit App. Exposed for tests/embedding. */
export function createWebhookServer(app: App, config: Config): Server {
  const middleware = createNodeMiddleware(app, { pathPrefix: WEBHOOK_PATH_PREFIX });
  return createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', model: config.model }));
      return;
    }
    // Octokit middleware returns true when it handled the request (webhook path).
    if (await middleware(req, res)) return;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

/** Boot from the environment and listen. Wires graceful shutdown. */
export function start(config: Config = loadConfig()): Server {
  const app = createApp(config);
  const server = createWebhookServer(app, config);

  server.listen(config.port, () => {
    // Structured, single-line startup log.
    console.log(
      JSON.stringify({
        msg: 'hanzo-github listening',
        port: config.port,
        path: `${WEBHOOK_PATH_PREFIX}/webhooks`,
        model: config.model,
      }),
    );
  });

  const shutdown = (signal: string) => {
    console.log(JSON.stringify({ msg: 'shutting down', signal }));
    server.close(() => process.exit(0));
    // Force-exit if connections do not drain promptly.
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
