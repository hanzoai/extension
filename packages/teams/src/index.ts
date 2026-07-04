/**
 * `@hanzo/teams` — Hanzo AI for Microsoft Teams.
 *
 * A Bot Framework (botbuilder) app that brings the Hanzo assistant into Teams:
 * 1:1 & channel chat, message extensions ("Ask Hanzo" / compose a draft), and
 * Adaptive Card actions (model picker, quick actions, prompt) — all rendered
 * from the shared `@hanzo/cards` panel spec and answered via `@hanzo/ai`.
 *
 * Composition: pure logic modules (`dispatch`, `panels`, `context`, `hanzo`,
 * `identity`, `config`) that the bot wires together and the server hosts.
 */
export { HanzoTeamsBot, COMMAND, type BotDeps } from './bot';
export {
  createServer,
  makeAdapter,
  botAuth,
  start,
  MESSAGES_PATH,
} from './server';
export { loadConfig, DEFAULT_MODELS, type Config, type Env } from './config';
export {
  complete,
  listModels,
  makeClient,
  type AiClient,
  type ChatMessage,
  type CompletionRequest,
} from './hanzo';
export {
  dispatch,
  selectedModel,
  promptText,
  type CardIntent,
  type SubmitData,
  type PromptIntent,
  type QuickActionIntent,
  type ModelSelectIntent,
  type SignInIntent,
  type UnknownIntent,
} from './dispatch';
export {
  welcomePanel,
  resultPanel,
  signedOutPanel,
  renderCard,
  systemPromptFor,
  QUICK_ACTIONS,
  QuickActionId,
  type PanelOptions,
} from './panels';
export {
  promptFromActivity,
  textFromMessagePayload,
  htmlToText,
  truncate,
  normalizeWhitespace,
  MAX_CONTEXT_CHARS,
  type ActivityLike,
  type MessagePayloadLike,
} from './context';
export {
  parseSub,
  identityFromClaims,
  resolveFromToken,
  tenantIdentity,
  anonymous,
  type HanzoIdentity,
  type TokenConfig,
} from './identity';
