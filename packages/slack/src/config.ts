/**
 * Slack app configuration — ONLY environment boundary reading and defaults.
 *
 * Every secret comes from the environment; nothing is committed. This module is
 * the single place env is read, so the rest of the app takes a typed
 * {@link SlackConfig} and never touches `process.env`.
 *
 * Two credential surfaces:
 *  - Slack: signing secret + (single-workspace bot token) OR (OAuth client
 *    id/secret + state secret) for multi-workspace install. Presence of
 *    SLACK_CLIENT_ID selects OAuth mode.
 *  - Hanzo: an `sk-…` API key (or IAM bearer) used as the gateway bearer, plus
 *    the IAM origin + OAuth client id used to VALIDATE an inbound Hanzo user
 *    token (owner-scoping).
 */

/** Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when a workspace has not picked one. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/** Public IAM origin that mints Hanzo user tokens. */
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';

/** OAuth client id inbound Hanzo tokens are audienced to (validation). */
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-slack';

/** Slack OAuth scopes the bot requests. Kept in sync with the manifest. */
export const SLACK_BOT_SCOPES = [
  'commands',
  'chat:write',
  'app_mentions:read',
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
] as const;

/** Hanzo-side identity + gateway credential. */
export interface HanzoConfig {
  /** Gateway base URL. */
  baseURL: string;
  /**
   * Default Hanzo API key / bearer used against the gateway when a workspace
   * has no stored token of its own. `sk-…` key or IAM bearer. May be empty:
   * the gateway serves anonymous/limited models.
   */
  apiKey: string;
  /** Public IAM origin (token issuer) for validating inbound Hanzo tokens. */
  iamServerUrl: string;
  /** OAuth client id inbound tokens are audienced to. */
  iamClientId: string;
}

/** Slack-side credentials. */
export interface SlackCredentials {
  /** Request-signature verification secret (always required). */
  signingSecret: string;
  /** Single-workspace bot token (`xoxb-…`). Set OR use OAuth. */
  botToken?: string;
  /** OAuth app id (multi-workspace install). Presence selects OAuth mode. */
  clientId?: string;
  /** OAuth app secret. */
  clientSecret?: string;
  /** OAuth state-signing secret. */
  stateSecret?: string;
  /** App-level token (`xapp-…`) for Socket Mode. Optional. */
  appToken?: string;
}

/** Fully resolved config the app runs on. */
export interface SlackConfig {
  slack: SlackCredentials;
  hanzo: HanzoConfig;
  /** HTTP port for the Bolt receiver. */
  port: number;
  /** Default model id offered in panels. */
  defaultModel: string;
  /** When true, run Bolt in Socket Mode (needs appToken). */
  socketMode: boolean;
}

/** True when the app is configured for multi-workspace OAuth install. */
export function isOAuthMode(slack: SlackCredentials): boolean {
  return Boolean(slack.clientId && slack.clientSecret);
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env ${key}`);
  }
  return v.trim();
}

function opt(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Build {@link SlackConfig} from the environment, validating at this boundary.
 *
 * Required: SLACK_SIGNING_SECRET, and EITHER SLACK_BOT_TOKEN (single workspace)
 * OR SLACK_CLIENT_ID + SLACK_CLIENT_SECRET + SLACK_STATE_SECRET (OAuth). Throws
 * a precise error when a required combination is absent — fail fast at start,
 * not on first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SlackConfig {
  const signingSecret = req(env, 'SLACK_SIGNING_SECRET');
  const botToken = opt(env, 'SLACK_BOT_TOKEN');
  const clientId = opt(env, 'SLACK_CLIENT_ID');
  const clientSecret = opt(env, 'SLACK_CLIENT_SECRET');
  const stateSecret = opt(env, 'SLACK_STATE_SECRET');
  const appToken = opt(env, 'SLACK_APP_TOKEN');

  const oauth = Boolean(clientId && clientSecret);
  if (!botToken && !oauth) {
    throw new Error(
      'Provide SLACK_BOT_TOKEN (single workspace) or SLACK_CLIENT_ID + ' +
        'SLACK_CLIENT_SECRET (+ SLACK_STATE_SECRET) for OAuth install.',
    );
  }
  if (oauth && !stateSecret) {
    throw new Error('OAuth mode requires SLACK_STATE_SECRET.');
  }

  const portRaw = opt(env, 'PORT');
  const port = portRaw ? Number.parseInt(portRaw, 10) : 3000;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    slack: { signingSecret, botToken, clientId, clientSecret, stateSecret, appToken },
    hanzo: {
      baseURL: opt(env, 'HANZO_API_BASE_URL') ?? HANZO_API_BASE_URL,
      apiKey: opt(env, 'HANZO_API_KEY') ?? '',
      iamServerUrl: opt(env, 'HANZO_IAM_SERVER_URL') ?? DEFAULT_IAM_SERVER_URL,
      iamClientId: opt(env, 'HANZO_IAM_CLIENT_ID') ?? DEFAULT_IAM_CLIENT_ID,
    },
    port,
    defaultModel: opt(env, 'HANZO_DEFAULT_MODEL') ?? DEFAULT_MODEL,
    socketMode: opt(env, 'SLACK_SOCKET_MODE') === 'true',
  };
}
