/**
 * GitLab service configuration — the ONLY environment boundary.
 *
 * Every secret comes from the environment; nothing is committed. This module is
 * the single place `process.env` is read, so the rest of the app takes a typed
 * {@link Config} and never touches the environment again.
 *
 * Two credential surfaces:
 *  - GitLab: the instance base URL, an access token with `api` scope (Personal,
 *    Project, or Group — or a GitLab App OAuth token), and the webhook secret
 *    token used to verify inbound `X-Gitlab-Token` headers in constant time.
 *  - Hanzo: an `hk-…` API key (or IAM bearer) used as the gateway bearer for
 *    `@hanzo/ai`, plus the IAM origin + client id used to validate an inbound
 *    Hanzo user token when a request is owner-scoped.
 */

/** Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default GitLab instance. Works for gitlab.com; override for self-managed. */
export const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com';

/** Default model for reviews and triage. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/** Public IAM origin that mints Hanzo user tokens. */
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';

/** OAuth client id inbound Hanzo tokens are audienced to (validation). */
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-gitlab';

/**
 * Max diff characters fed to the model per review. Larger diffs are windowed
 * with an honest truncation note (see `review.windowDiff`). ~120k chars keeps a
 * big MR inside a single completion without silently dropping context.
 */
export const DEFAULT_MAX_DIFF_CHARS = 120_000;

/** Access-token scope this service requires. Kept in sync with the README. */
export const GITLAB_TOKEN_SCOPES = ['api'] as const;

/** Webhook triggers this service subscribes to. Kept in sync with the README. */
export const GITLAB_WEBHOOK_TRIGGERS = ['merge_requests_events', 'issues_events', 'note_events'] as const;

/** GitLab credentials + endpoint. */
export interface GitLabConfig {
  /** Instance base URL, e.g. `https://gitlab.com` or a self-managed host. */
  baseURL: string;
  /** Access token with `api` scope (Personal/Project/Group or App OAuth). */
  token: string;
  /** Webhook secret token — verifies `X-Gitlab-Token` (constant time). */
  webhookSecret: string;
}

/** Hanzo-side identity + gateway credential. */
export interface HanzoConfig {
  /** Gateway base URL. */
  baseURL: string;
  /**
   * Default Hanzo API key / bearer used against the gateway. `hk-…` key or IAM
   * bearer. May be empty: the gateway serves anonymous/limited models.
   */
  apiKey: string;
  /** Public IAM origin (token issuer) for validating inbound Hanzo tokens. */
  iamServerUrl: string;
  /** OAuth client id inbound tokens are audienced to. */
  iamClientId: string;
}

/** Fully resolved config the service runs on. */
export interface Config {
  gitlab: GitLabConfig;
  hanzo: HanzoConfig;
  /** HTTP port for the webhook server. */
  port: number;
  /** Model id used for reviews and triage. */
  model: string;
  /** Max diff characters fed to the model before windowing. */
  maxDiffChars: number;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || !v.trim()) throw new Error(`Missing required env ${key}`);
  return v.trim();
}

function opt(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v && v.trim() ? v.trim() : undefined;
}

function parsePort(raw: string | undefined): number {
  const port = raw ? Number.parseInt(raw, 10) : 3000;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${raw}`);
  return port;
}

function parseMaxDiff(raw: string | undefined): number {
  if (!raw) return DEFAULT_MAX_DIFF_CHARS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid HANZO_MAX_DIFF_CHARS: ${raw}`);
  return n;
}

/**
 * Build {@link Config} from the environment, validating at this boundary.
 *
 * Required: GITLAB_TOKEN, GITLAB_WEBHOOK_SECRET. Throws a precise error when one
 * is absent — fail fast at start, not on first webhook. GITLAB_BASE_URL defaults
 * to gitlab.com for the hosted case.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    gitlab: {
      baseURL: opt(env, 'GITLAB_BASE_URL') ?? DEFAULT_GITLAB_BASE_URL,
      token: req(env, 'GITLAB_TOKEN'),
      webhookSecret: req(env, 'GITLAB_WEBHOOK_SECRET'),
    },
    hanzo: {
      baseURL: opt(env, 'HANZO_API_BASE_URL') ?? HANZO_API_BASE_URL,
      apiKey: opt(env, 'HANZO_API_KEY') ?? '',
      iamServerUrl: opt(env, 'HANZO_IAM_SERVER_URL') ?? DEFAULT_IAM_SERVER_URL,
      iamClientId: opt(env, 'HANZO_IAM_CLIENT_ID') ?? DEFAULT_IAM_CLIENT_ID,
    },
    port: parsePort(opt(env, 'PORT')),
    model: opt(env, 'HANZO_MODEL') ?? DEFAULT_MODEL,
    maxDiffChars: parseMaxDiff(opt(env, 'HANZO_MAX_DIFF_CHARS')),
  };
}
