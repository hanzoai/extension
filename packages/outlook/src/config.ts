// Office add-in config — ONLY what is office-specific. IAM endpoints, the OAuth
// client, PKCE, and scopes now live in @hanzo/auth (the one auth core); this
// module keeps the api.hanzo.ai model gateway + the roaming-settings keys.

export const API_BASE_URL = 'https://api.hanzo.ai';

// Default model. Overridable per-request; the gateway routes it.
export const DEFAULT_MODEL = 'zen-1';

// Roaming-settings keys (Office.context.roamingSettings persists per-user across
// the user's devices). Two auth paths: the IAM OAuth token set (managed by
// @hanzo/auth) and a pasted Hanzo API key (`hk-…`) for zero-setup use — the key
// needs no registered OAuth client, which is why the Windows test kit uses it.
export const TOKEN_SETTING_KEY = 'hanzo.tokens';
export const APIKEY_SETTING_KEY = 'hanzo.apiKey';

// pickBearer chooses the credential to send: a pasted API key wins over the
// OAuth token (an explicit key is a deliberate override), else the OAuth token,
// else empty (anonymous). Pure — unit-tested.
export function pickBearer(apiKey: string, oauthToken: string): string {
  return (apiKey && apiKey.trim()) || (oauthToken && oauthToken.trim()) || '';
}

// chatCompletionsURL / modelsURL — the model gateway endpoints the add-in calls.
export function chatCompletionsURL(): string {
  return `${API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${API_BASE_URL}/v1/models`;
}
