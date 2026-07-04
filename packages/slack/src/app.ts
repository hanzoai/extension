/**
 * Bolt wiring: commands, actions, events, App Home, and the message shortcut.
 *
 * This is the ONLY module that touches the Slack SDK. It composes the pure
 * pieces — `panels` (UI), `thread` (context), `hanzo` (completion), `actions`
 * (id routing), `install` (per-workspace credentials) — into handlers. Each
 * handler is thin: gather context, run ONE `complete`, post the card.
 */

import { App, ExpressReceiver, webApi, type Installation } from '@slack/bolt';

type WebClient = webApi.WebClient;
import { ActionId } from '@hanzo/cards';
import { loadConfig, isOAuthMode, SLACK_BOT_SCOPES, type SlackConfig } from './config.js';
import {
  complete,
  quickActionPrompt,
  isQuickActionId,
  QUICK_ACTIONS,
} from './hanzo.js';
import { createAiClient, type ModelInfo } from './client.js';
import { threadToText, truncateMessage, type SlackMessage } from './thread.js';
import { QUICK_ACTION_RE, quickActionIdFrom } from './actions.js';
import { homeView, resultBlocks } from './panels.js';
import {
  HanzoFileInstallationStore,
  resolveBearer,
  type HanzoInstallationStore,
} from './install.js';

/** Per-user model selection, in-memory (rebuilds cheaply; not a secret). */
const modelByUser = new Map<string, string>();

/** Remember the workspace bot token resolution + Hanzo token per team. */
export interface AppDeps {
  config: SlackConfig;
  store: HanzoInstallationStore;
}

/** Resolve the Hanzo gateway bearer for the team behind a request. */
async function bearerForTeam(deps: AppDeps, teamId: string | undefined): Promise<string> {
  const ws = teamId ? await deps.store.getHanzoToken(teamId) : undefined;
  return resolveBearer(ws, deps.config.hanzo.apiKey);
}

/** List gateway models for the workspace bearer; empty on failure (panel copes). */
async function listModels(deps: AppDeps, bearer: string): Promise<ModelInfo[]> {
  try {
    const ai = createAiClient({ token: bearer, baseURL: deps.config.hanzo.baseURL });
    return await ai.models.list();
  } catch {
    return [];
  }
}

/** The user's selected model, defaulting to the app default. */
function modelFor(deps: AppDeps, userId: string): string {
  return modelByUser.get(userId) ?? deps.config.defaultModel;
}

/**
 * Pull the conversation context a quick action / shortcut operates on. When
 * `threadTs` is set we fetch the whole thread via `conversations.replies`;
 * otherwise we use the single message text. Returns model-ready text.
 */
async function contextFor(
  client: WebClient,
  channel: string,
  opts: { threadTs?: string; messageText?: string; messageTs?: string },
): Promise<string> {
  if (opts.threadTs) {
    const res = await client.conversations.replies({
      channel,
      ts: opts.threadTs,
      limit: 200,
    });
    const messages = (res.messages ?? []) as SlackMessage[];
    return threadToText(messages);
  }
  if (opts.messageTs) {
    // A shortcut on a standalone message: fetch just that message.
    const res = await client.conversations.history({
      channel,
      latest: opts.messageTs,
      inclusive: true,
      limit: 1,
    });
    const messages = (res.messages ?? []) as SlackMessage[];
    return threadToText(messages);
  }
  return opts.messageText ? truncateMessage(opts.messageText) : '';
}

/** Run one completion for a team's bearer + selected model. Throws on failure. */
async function run(
  deps: AppDeps,
  bearer: string,
  model: string,
  prompt: string,
  context: string,
): Promise<string> {
  return complete({
    prompt,
    context,
    model,
    token: bearer,
    baseURL: deps.config.hanzo.baseURL,
  });
}

/**
 * Build a configured Bolt {@link App} plus its receiver. Registers every handler.
 * Exposed for tests (inject a store) and for `server.ts` to `.start()`.
 */
export function createApp(deps: AppDeps): { app: App; receiver: ExpressReceiver } {
  const { config } = deps;
  const oauth = isOAuthMode(config.slack);

  const receiver = new ExpressReceiver({
    signingSecret: config.slack.signingSecret,
    ...(oauth
      ? {
          clientId: config.slack.clientId!,
          clientSecret: config.slack.clientSecret!,
          stateSecret: config.slack.stateSecret!,
          scopes: [...SLACK_BOT_SCOPES],
          installationStore: deps.store,
          installerOptions: {
            installPath: '/slack/install',
            redirectUriPath: '/slack/oauth_redirect',
            directInstall: true,
          },
        }
      : {}),
  });

  const app = new App({
    receiver,
    ...(oauth ? {} : { token: config.slack.botToken! }),
  });

  registerHandlers(app, deps);
  return { app, receiver };
}

/** Register commands, actions, events, and the shortcut. */
export function registerHandlers(app: App, deps: AppDeps): void {
  // Slash command /hanzo <prompt>
  app.command('/hanzo', async ({ command, ack, respond }) => {
    await ack();
    const prompt = command.text.trim();
    const bearer = await bearerForTeam(deps, command.team_id);
    const model = modelFor(deps, command.user_id);
    if (!prompt) {
      const models = await listModels(deps, bearer);
      await respond({
        response_type: 'ephemeral',
        blocks: resultBlocks('Type a prompt after `/hanzo` to get started.', model, models),
      });
      return;
    }
    try {
      const output = await run(deps, bearer, model, prompt, '');
      await respond({ response_type: 'in_channel', blocks: resultBlocks(output, model) });
    } catch (err) {
      await respond({ response_type: 'ephemeral', text: errText(err) });
    }
  });

  // App Home tab
  app.event('app_home_opened', async ({ event, client }) => {
    const bearer = await bearerForTeam(deps, teamIdFromContext(client));
    const models = await listModels(deps, bearer);
    const model = modelFor(deps, event.user);
    await client.views.publish({
      user_id: event.user,
      view: homeView({ models, selectedModel: model, signedIn: bearer !== '' }),
    });
  });

  // Model select
  app.action(ActionId.ModelSelect, async ({ ack, action, body, client }) => {
    await ack();
    const selected =
      (action as { selected_option?: { value?: string } }).selected_option?.value;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (selected && userId) {
      modelByUser.set(userId, selected);
      await republishHome(deps, client, userId);
    }
  });

  // Prompt submit (button or on-enter dispatch on the input)
  app.action(ActionId.PromptSubmit, async ({ ack, body, client }) => {
    await ack();
    await handlePromptSubmit(deps, body, client);
  });
  app.action('hanzo_prompt', async ({ ack, body, client }) => {
    await ack();
    await handlePromptSubmit(deps, body, client);
  });

  // Quick actions — one regex handler for hanzo_quick_action:<id>
  app.action(QUICK_ACTION_RE, async ({ ack, action, body, client }) => {
    await ack();
    const actionId = (action as { action_id?: string }).action_id ?? '';
    const id = quickActionIdFrom(actionId);
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!id || !isQuickActionId(id) || !userId) return;
    const bearer = await bearerForTeam(deps, teamIdFromContext(client));
    const model = modelFor(deps, userId);
    // From App Home there is no message context, so the quick action runs its
    // template with no thread and the result is shown back in the Home panel.
    // On a message/thread, use the "Ask Hanzo" shortcut, which supplies context.
    try {
      const output = await run(deps, bearer, model, quickActionPrompt(id), '');
      await republishHome(deps, client, userId, output);
    } catch {
      await republishHome(deps, client, userId);
    }
  });

  // Sign in
  app.action(ActionId.SignIn, async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: 'ephemeral',
      text:
        'Connect Hanzo: install with a workspace Hanzo API key, or set ' +
        '`HANZO_API_KEY` for the app. See the @hanzo/slack README.',
    });
  });

  // "Ask Hanzo" message shortcut — summarize/draft on the target message/thread
  app.shortcut('hanzo_ask', async ({ shortcut, ack, client }) => {
    await ack();
    const s = shortcut as {
      channel?: { id?: string };
      message?: { text?: string; ts?: string; thread_ts?: string };
      message_ts?: string;
      team?: { id?: string };
      user?: { id?: string };
    };
    const channel = s.channel?.id;
    const userId = s.user?.id;
    if (!channel || !userId) return;
    const bearer = await bearerForTeam(deps, s.team?.id);
    const model = modelFor(deps, userId);
    const threadTs = s.message?.thread_ts;
    const messageTs = s.message?.ts ?? s.message_ts;
    const context = await contextFor(client, channel, {
      threadTs,
      messageTs,
      messageText: s.message?.text,
    });
    try {
      const output = await run(deps, bearer, model, QUICK_ACTIONS.summarize.prompt, context);
      await client.chat.postEphemeral({
        channel,
        user: userId,
        blocks: resultBlocks(output, model),
        text: output,
      });
    } catch (err) {
      await client.chat.postEphemeral({ channel, user: userId, text: errText(err) });
    }
  });

  // App mention — reply in-thread with a completion over the thread context
  app.event('app_mention', async ({ event, client }) => {
    const e = event as {
      channel: string;
      text: string;
      ts: string;
      thread_ts?: string;
      user?: string;
      team?: string;
    };
    const bearer = await bearerForTeam(deps, e.team);
    const model = e.user ? modelFor(deps, e.user) : deps.config.defaultModel;
    const prompt = stripMention(e.text) || QUICK_ACTIONS.summarize.prompt;
    const threadTs = e.thread_ts ?? e.ts;
    const context = await contextFor(client, e.channel, { threadTs });
    try {
      const output = await run(deps, bearer, model, prompt, context);
      await client.chat.postMessage({
        channel: e.channel,
        thread_ts: threadTs,
        blocks: resultBlocks(output, model),
        text: output,
      });
    } catch (err) {
      await client.chat.postMessage({
        channel: e.channel,
        thread_ts: threadTs,
        text: errText(err),
      });
    }
  });
}

/** Handle a freeform prompt submit from the App Home input. */
async function handlePromptSubmit(
  deps: AppDeps,
  body: unknown,
  client: WebClient,
): Promise<void> {
  const b = body as {
    user?: { id?: string };
    view?: { state?: { values?: Record<string, Record<string, { value?: string }>> } };
  };
  const userId = b.user?.id;
  if (!userId) return;
  const prompt = extractPromptValue(b.view?.state?.values);
  if (!prompt) return;
  const bearer = await bearerForTeam(deps, teamIdFromContext(client));
  const model = modelFor(deps, userId);
  try {
    const output = await run(deps, bearer, model, prompt, '');
    await republishHome(deps, client, userId, output);
  } catch {
    await republishHome(deps, client, userId);
  }
}

/** Pull the `hanzo_prompt` field value out of a view submission state. Pure-ish. */
export function extractPromptValue(
  values: Record<string, Record<string, { value?: string }>> | undefined,
): string {
  if (!values) return '';
  for (const block of Object.values(values)) {
    const field = block['hanzo_prompt'];
    if (field && typeof field.value === 'string') return field.value.trim();
  }
  return '';
}

/** Republish the App Home with fresh models/selection and optional output. */
async function republishHome(
  deps: AppDeps,
  client: WebClient,
  userId: string,
  output?: string,
): Promise<void> {
  const bearer = await bearerForTeam(deps, teamIdFromContext(client));
  const models = await listModels(deps, bearer);
  await client.views
    .publish({
      user_id: userId,
      view: homeView({
        models,
        selectedModel: modelFor(deps, userId),
        signedIn: bearer !== '',
        output,
      }),
    })
    // Home publish is best-effort; a race with another open is non-fatal.
    .catch(() => {});
}

/** Strip a leading `<@Uxxx>` bot mention from app_mention text. Pure. */
export function stripMention(text: string): string {
  return text.replace(/^\s*<@[^>]+>\s*/, '').trim();
}

/** Best-effort team id from the client's auth context. */
function teamIdFromContext(client: WebClient): string | undefined {
  return (client as unknown as { teamId?: string }).teamId;
}

function errText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return `:warning: ${m}`;
}

/** Convenience: build the app straight from `process.env`. */
export function createAppFromEnv(env: NodeJS.ProcessEnv = process.env): {
  app: App;
  receiver: ExpressReceiver;
  config: SlackConfig;
} {
  const config = loadConfig(env);
  const storePath = env.HANZO_INSTALL_STORE ?? './.data/installations.json';
  const store = new HanzoFileInstallationStore(storePath);
  const { app, receiver } = createApp({ config, store });
  return { app, receiver, config };
}

// Re-export the Installation type for consumers that provide a custom store.
export type { Installation };
