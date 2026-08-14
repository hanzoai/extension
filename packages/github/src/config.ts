/**
 * GitHub App configuration — the ONLY environment boundary.
 *
 * Every secret comes from the environment; nothing is committed. This module is
 * the single place `process.env` is read, so the rest of the app takes a typed
 * {@link Config} and never touches the environment again.
 *
 * Two credential surfaces:
 *  - GitHub App: numeric app id, PEM private key, and the webhook secret used to
 *    verify inbound `X-Hub-Signature-256` HMACs. Octokit mints a per-installation
 *    token from the app JWT for every repo it operates on.
 *  - Hanzo: an `sk-…` API key (or IAM bearer) used as the gateway bearer for
 *    `@hanzo/ai`, plus the IAM origin + client id used to validate an inbound
 *    Hanzo user token when a request is owner-scoped.
 */

/** Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default model for reviews and triage. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/** Public IAM origin that mints Hanzo user tokens. */
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';

/** OAuth client id inbound Hanzo tokens are audienced to (validation). */
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-github';

/**
 * Max diff characters fed to the model per review. Larger diffs are windowed
 * with an honest truncation note (see `review.windowDiff`). ~120k chars keeps a
 * big PR inside a single completion without silently dropping context.
 */
export const DEFAULT_MAX_DIFF_CHARS = 120_000;

/** GitHub App permissions this app requests. Kept in sync with the README. */
export const GITHUB_APP_PERMISSIONS = {
  pull_requests: 'write',
  issues: 'write',
  contents: 'read',
  metadata: 'read',
} as const;

/** Webhook events this app subscribes to. Kept in sync with the README. */
export const GITHUB_APP_EVENTS = ['pull_request', 'issues', 'issue_comment'] as const;

/** GitHub App credentials. */
export interface GitHubConfig {
  /** Numeric GitHub App id. */
  appId: string;
  /** PEM-encoded RSA private key for the app (JWT signing). */
  privateKey: string;
  /** Webhook shared secret — verifies `X-Hub-Signature-256`. */
  webhookSecret: string;
}

/** Hanzo-side identity + gateway credential. */
export interface HanzoConfig {
  /** Gateway base URL. */
  baseURL: string;
  /**
   * Default Hanzo API key / bearer used against the gateway. `sk-…` key or IAM
   * bearer. May be empty: the gateway serves anonymous/limited models.
   */
  apiKey: string;
  /** Public IAM origin (token issuer) for validating inbound Hanzo tokens. */
  iamServerUrl: string;
  /** OAuth client id inbound tokens are audienced to. */
  iamClientId: string;
}

/** Fully resolved config the app runs on. */
export interface Config {
  github: GitHubConfig;
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

/**
 * Normalize a PEM private key from the environment. GitHub gives a multi-line
 * PEM; env vars often carry it with literal `\n` escapes (e.g. from a `.env`
 * one-liner or a secret manager). Restore real newlines so `@octokit/auth-app`
 * can parse it. Idempotent for already-multiline keys.
 */
export function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
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
 * Required: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET. Throws a
 * precise error when one is absent — fail fast at start, not on first webhook.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    github: {
      appId: req(env, 'GITHUB_APP_ID'),
      privateKey: normalizePrivateKey(req(env, 'GITHUB_PRIVATE_KEY')),
      webhookSecret: req(env, 'GITHUB_WEBHOOK_SECRET'),
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
