/**
 * HTTP server — the Bot Framework messaging endpoint.
 *
 * Wires the {@link HanzoTeamsBot} to Teams over a restify server using the
 * modern {@link CloudAdapter} + {@link ConfigurationBotFrameworkAuthentication}
 * (the single-tenant/multi-tenant/MSI-aware auth path). Azure Bot Service posts
 * inbound activities to `POST /api/messages`; the adapter authenticates them
 * with the app id/password and runs the bot.
 *
 * This is the only module that opens a socket. It reads config once at startup
 * and constructs the AI client from the configured key.
 */
import * as restify from 'restify';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConfigurationBotFrameworkAuthenticationOptions,
  type TurnContext,
} from 'botbuilder';
import { loadConfig, type Config } from './config';
import { HanzoTeamsBot } from './bot';
import { makeClient } from './hanzo';

/** The path Azure Bot Service posts activities to; set as the messaging endpoint. */
export const MESSAGES_PATH = '/api/messages';

/** Build the Bot Framework auth from Hanzo config (maps to `Microsoft*` keys). */
export function botAuth(config: Config): ConfigurationBotFrameworkAuthentication {
  const options: ConfigurationBotFrameworkAuthenticationOptions = {
    MicrosoftAppId: config.appId,
    MicrosoftAppPassword: config.appPassword,
    MicrosoftAppType: config.appType,
    MicrosoftAppTenantId: config.appTenantId,
  };
  return new ConfigurationBotFrameworkAuthentication(options);
}

/** Construct the adapter with a graceful onTurnError that surfaces failures. */
export function makeAdapter(config: Config): CloudAdapter {
  const adapter = new CloudAdapter(botAuth(config));
  adapter.onTurnError = async (context: TurnContext, error: Error) => {
    // Log for operators; tell the user without leaking internals.
    console.error('[hanzo-teams] turn error:', error);
    await context.sendActivity('Hanzo hit an error handling that. Please try again.');
  };
  return adapter;
}

/** Build the restify server, mounting the bot at {@link MESSAGES_PATH}. */
export function createServer(config: Config = loadConfig()): restify.Server {
  const ai = makeClient({
    apiKey: config.hanzoApiKey,
    ...(config.hanzoBaseUrl ? { baseUrl: config.hanzoBaseUrl } : {}),
  });
  const bot = new HanzoTeamsBot({ config, ai });
  const adapter = makeAdapter(config);

  const server = restify.createServer({ name: 'hanzo-teams' });
  server.use(restify.plugins.bodyParser());

  // restify takes a two-argument handler only if it is async; a plain one
  // fails the route's registration, so the server never started.
  server.post(MESSAGES_PATH, async (req, res) => {
    await adapter.process(req, res, (context) => bot.run(context));
  });

  server.get('/healthz', (_req, res, next) => {
    res.send(200, { status: 'ok' });
    next();
  });

  return server;
}

/** Start listening. Invoked by `pnpm start`. */
export function start(): void {
  const config = loadConfig();
  const server = createServer(config);
  server.listen(config.port, () => {
    console.log(`[hanzo-teams] listening on ${server.url}${MESSAGES_PATH}`);
  });
}

// Run when executed directly (not when imported by tests).
if (require.main === module) {
  start();
}
