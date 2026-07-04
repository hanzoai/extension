// Raycast extension config — the api.hanzo.ai model gateway (default model +
// endpoints) and the context character budget. Endpoints and the key guard
// mirror @hanzo/canva / @hanzo/figma / @hanzo/office so the productivity suite
// stays DRY; the action catalog and prompt/parse logic live in actions.ts, the
// thin @hanzo/ai adapter in hanzo.ts, and the Raycast selection/clipboard I/O in
// selection.ts.

// ---- Hanzo model gateway --------------------------------------------------

// Where the Hanzo model gateway lives. `@hanzo/ai` (createAiClient) defaults
// here too. /v1 only, never an /api/ prefix (api.hanzo.ai IS the api host).
export const HANZO_API_BASE_URL = "https://api.hanzo.ai";

// Default model. A Zen model (qwen3+). Overridable via the Raycast preference /
// model-picker; the gateway routes it.
export const DEFAULT_MODEL = "zen5";

// Public IAM origin that mints Hanzo user tokens, and the OAuth client id an
// inbound Hanzo token is audienced to, under the shared <org>-<app> naming
// scheme. The extension itself uses a pasted `hk-` key (a Raycast preference);
// these exist so a Hanzo-hosted backend can validate one via @hanzo/iam.
export const DEFAULT_IAM_SERVER_URL = "https://hanzo.id";
export const DEFAULT_IAM_CLIENT_ID = "hanzo-raycast";

// chatCompletionsURL / modelsURL — the model gateway endpoints. The client
// (createAiClient) builds these itself; these exist for tests + honest docs.
export function chatCompletionsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/models`;
}

// ---- Context budget -------------------------------------------------------
//
// The selected text (or clipboard) a quick action operates on can run long — a
// whole article to summarize, a page of code to explain. This caps the
// characters of context we attach to any one request so it fits comfortably in
// a model window alongside the reply. Honest truncation, never silent drop
// (actions.ts marks `truncated`).
export const CONTEXT_CHAR_BUDGET = 24_000;

// A Hanzo API key is minted by hanzo.id and is always prefixed `hk-`. isHanzoKey
// is the boundary guard: the command validates the pasted preference against
// this before it is ever handed to the client as a bearer, so an obviously-wrong
// paste (an IAM JWT, an OpenAI `sk-` key) is rejected in the UI instead of
// failing opaquely at the gateway. Trim first — users paste with whitespace.
export function isHanzoKey(key: string | undefined | null): key is string {
  return typeof key === "string" && /^hk-[A-Za-z0-9._-]{16,}$/.test(key.trim());
}
