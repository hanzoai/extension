// Canonical Hanzo endpoints — the SAME gateway + IAM the browser extension
// uses (packages/browser/src/shared/config.ts). llm.hanzo.ai is dead; every
// model call goes through api.hanzo.ai/v1 (OpenAI-compatible, IAM JWT at the
// gateway). Kept as its own tiny module so the task pane, auth, and tests all
// read one source of truth.

export const API_BASE_URL = 'https://api.hanzo.ai';
export const IAM_LOGIN_URL = 'https://hanzo.id';
export const IAM_API_URL = 'https://iam.hanzo.ai';
export const IAM_API_PATH = '/v1/iam';

// hanzo-office is the registered IAM OAuth client for this add-in. Its
// redirectUris must include the add-in's dialog callback (served from the same
// host as the task pane). Mirrors the browser extension's hanzo-browser client.
export const CLIENT_ID = 'hanzo-office';
export const OAUTH_SCOPES = 'openid profile email';

// Default model. Overridable per-request; the gateway routes it.
export const DEFAULT_MODEL = 'zen-1';

// Roaming-settings key the token is stored under (Office.context.roamingSettings
// persists per-user across the user's devices).
export const TOKEN_SETTING_KEY = 'hanzo.accessToken';

// chatCompletionsURL / modelsURL / iamTokenURL / iamAuthorizeURL are the exact
// endpoints the add-in calls. Centralized so a path never drifts between the
// task pane and the tests.
export function chatCompletionsURL(): string {
  return `${API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${API_BASE_URL}/v1/models`;
}
export function iamAuthorizeURL(): string {
  return `${IAM_LOGIN_URL}${IAM_API_PATH}/oauth/authorize`;
}
export function iamTokenURL(): string {
  return `${IAM_API_URL}${IAM_API_PATH}/oauth/token`;
}
