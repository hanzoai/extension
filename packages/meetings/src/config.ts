// Meetings config — the api.hanzo.ai model gateway, the default model, the
// pasted-key storage, and the two server-side secret sets (Zoom OAuth + Zoom
// webhook). Endpoints and the bearer choice mirror @hanzo/office-addin and
// @hanzo/pdf so the productivity suite stays DRY; transcript windowing (the
// thing a *meeting* surface adds) lives in hanzo.ts, not here.

export const API_BASE_URL = 'https://api.hanzo.ai';

// Default model. Overridable per-request via the picker; the gateway routes it.
export const DEFAULT_MODEL = 'zen-1';

// localStorage key for the pasted Hanzo API key (`sk-…`). The Zoom App and the
// Meet add-on are static web panels (iframe/webview), not an Office host with
// roamingSettings, so the zero-setup credential lives in localStorage — same as
// @hanzo/pdf. OAuth via hanzo.id (device login) is the documented upgrade; the
// bearer plumbing already tolerates any token, so it slots in additively.
export const APIKEY_STORAGE_KEY = 'hanzo.meetings.apiKey';

// Transcript budget. A one-hour call transcribes to tens of thousands of words;
// the whole thing won't fit a model window and shouldn't be sent. This caps the
// characters of transcript we attach to any one request — chosen conservatively
// so it fits comfortably inside a modern context window alongside the reply, and
// is honest rather than optimal (we truncate visibly, never drop silently).
export const TRANSCRIPT_CHAR_BUDGET = 48_000;

// pickBearer chooses the credential to send: a pasted API key wins over an OAuth
// token (an explicit key is a deliberate override), else the token, else empty
// (anonymous — the gateway still serves public models). Pure — unit-tested.
export function pickBearer(apiKey: string, oauthToken: string): string {
  return (apiKey && apiKey.trim()) || (oauthToken && oauthToken.trim()) || '';
}

// chatCompletionsURL / modelsURL — the model gateway endpoints. /v1 only, never
// an /api/ prefix (api.hanzo.ai IS the api host).
export function chatCompletionsURL(): string {
  return `${API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${API_BASE_URL}/v1/models`;
}

// ---- Server-side configuration (Zoom OAuth + webhook) --------------------
//
// These are read from the environment by src/zoom/server.ts. They NEVER reach
// the browser bundle: the client id is public, but the client secret and the
// webhook secret token are server-only and are validated to be present before
// the server will start (readServerConfig throws on a missing secret).

// The Zoom marketplace app OAuth base + endpoints. Zoom account-level tokens are
// minted at zoom.us/oauth/token; the REST API lives at api.zoom.us/v2.
export const ZOOM_OAUTH_TOKEN_URL = 'https://zoom.us/oauth/token';
export const ZOOM_OAUTH_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
export const ZOOM_API_BASE_URL = 'https://api.zoom.us/v2';

export interface ServerConfig {
  /** Zoom OAuth client id (public — also stamped into the in-client URL). */
  zoomClientId: string;
  /** Zoom OAuth client secret (SERVER ONLY — token exchange). */
  zoomClientSecret: string;
  /** OAuth redirect registered on the Zoom app (e.g. https://meetings.hanzo.ai/zoom/oauth/callback). */
  zoomRedirectUri: string;
  /** Zoom webhook secret token — verifies the HMAC signature on every event. */
  zoomWebhookSecret: string;
  /**
   * Hanzo API key the server uses to summarize a completed recording. The
   * webhook runs with no user in the loop, so it needs its own bearer. Optional:
   * without it, the server verifies + routes events but cannot summarize (it
   * logs and skips), which readServerConfig reports honestly.
   */
  hanzoApiKey: string;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required Zoom secret is missing — a
// server that can neither exchange OAuth codes nor verify webhooks must not
// pretend to start. hanzoApiKey is the one optional field (see above). Pure
// given an env map, so it is unit-tested without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const zoomClientId = env.ZOOM_CLIENT_ID;
  const zoomClientSecret = env.ZOOM_CLIENT_SECRET;
  const zoomRedirectUri = env.ZOOM_REDIRECT_URI;
  const zoomWebhookSecret = env.ZOOM_WEBHOOK_SECRET_TOKEN;
  const missing: string[] = [];
  if (!zoomClientId) missing.push('ZOOM_CLIENT_ID');
  if (!zoomClientSecret) missing.push('ZOOM_CLIENT_SECRET');
  if (!zoomRedirectUri) missing.push('ZOOM_REDIRECT_URI');
  if (!zoomWebhookSecret) missing.push('ZOOM_WEBHOOK_SECRET_TOKEN');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    zoomClientId: zoomClientId!,
    zoomClientSecret: zoomClientSecret!,
    zoomRedirectUri: zoomRedirectUri!,
    zoomWebhookSecret: zoomWebhookSecret!,
    hanzoApiKey: env.HANZO_API_KEY || '',
    port: Number(env.PORT) || 8788,
  };
}
