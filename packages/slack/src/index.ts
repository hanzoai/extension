/**
 * `@hanzo/slack` — Hanzo AI in Slack.
 *
 * A Bolt app: slash command `/hanzo`, an App Home assistant panel, message
 * shortcut "Ask Hanzo", and interactivity for the `@hanzo/cards` action ids.
 * Built on the shared foundation — `@hanzo/ai` (headless client), `@hanzo/iam`
 * (identity), `@hanzo/cards` (UI). Run it with `server.ts`; embed it via the
 * exports below.
 */

export { createApp, createAppFromEnv, registerHandlers, type AppDeps } from './app.js';
export {
  loadConfig,
  isOAuthMode,
  SLACK_BOT_SCOPES,
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  type SlackConfig,
  type SlackCredentials,
  type HanzoConfig,
} from './config.js';
export {
  createAiClient,
  chatRequestBody,
  extractContent,
  parseModels,
  type AiClient,
  type ChatMessage,
  type ChatCompletion,
  type ModelInfo,
} from './client.js';
export {
  complete,
  buildMessages,
  quickActionPrompt,
  isQuickActionId,
  validateHanzoToken,
  QUICK_ACTIONS,
  type QuickActionId,
} from './hanzo.js';
export {
  threadToText,
  truncateMessage,
  isContentMessage,
  renderMessage,
  type SlackMessage,
} from './thread.js';
export {
  assistantPanelSpec,
  assistantBlocks,
  resultPanelSpec,
  resultBlocks,
  homeView,
  quickActionChips,
  toModelOptions,
  type PanelInput,
} from './panels.js';
export { parseActionId, quickActionIdFrom, QUICK_ACTION_RE, type ActionIntent } from './actions.js';
export {
  HanzoFileInstallationStore,
  resolveBearer,
  installKey,
  type HanzoInstallationStore,
  type HanzoWorkspaceToken,
} from './install.js';
