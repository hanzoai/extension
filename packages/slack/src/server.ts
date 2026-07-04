/**
 * HTTP entry point. Builds the Bolt app from the environment and starts it.
 *
 * In HTTP mode the ExpressReceiver serves:
 *  - POST /slack/events        (events + interactivity + slash commands)
 *  - GET  /slack/install       (OAuth start, when in OAuth mode)
 *  - GET  /slack/oauth_redirect (OAuth callback)
 *  - GET  /health              (added below for k8s probes)
 *
 * Fails fast on missing env; logs the bound port; shuts down gracefully.
 */

import { createAppFromEnv } from './app.js';

async function main(): Promise<void> {
  const { app, receiver, config } = createAppFromEnv();

  // Liveness/readiness for ingress + k8s probes.
  receiver.router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  await app.start(config.port);
  // eslint-disable-next-line no-console
  console.log(`@hanzo/slack listening on :${config.port}`);

  const shutdown = async (sig: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`received ${sig}, shutting down`);
    await app.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('failed to start @hanzo/slack:', err instanceof Error ? err.message : err);
  process.exit(1);
});
