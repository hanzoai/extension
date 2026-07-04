// Canva app config — the api.hanzo.ai model gateway (default model + endpoints)
// and the design-context character budget. Endpoints and the bearer choice
// mirror @hanzo/shopify / @hanzo/figma so the productivity suite stays DRY; the
// design-specific pieces (context assembly, the AI actions, response parsing)
// live in design-core.ts, and the two thin adapters — @hanzo/ai in hanzo.ts and
// @canva/design in canva.ts — carry the I/O.

// ---- Hanzo model gateway --------------------------------------------------

// Where the Hanzo model gateway lives. `@hanzo/ai` (createAiClient) defaults
// here too. /v1 only, never an /api/ prefix (api.hanzo.ai IS the api host).
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

// Default model. A Zen model (qwen3+). Overridable per-request via the picker;
// the gateway routes it.
export const DEFAULT_MODEL = 'zen5';

// Public IAM origin that mints Hanzo user tokens, and the OAuth client id an
// inbound Hanzo token is audienced to (owner-scoping validation via @hanzo/iam).
// The Canva app itself pastes an `hk-` key; these exist so a Hanzo-hosted
// backend can validate one under the shared <org>-<app> naming scheme.
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-canva';

// chatCompletionsURL / modelsURL — the model gateway endpoints. The client
// (createAiClient) builds these itself; these exist for tests + honest docs.
export function chatCompletionsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/models`;
}

// ---- Design context budget ------------------------------------------------
//
// A Canva design's on-page text (the selection plus the surrounding page text
// we assemble as context) can run long — a poster's body copy, a slide's notes.
// This caps the characters of design context we attach to any one request so it
// fits comfortably in a model window alongside the reply. Honest truncation,
// never silent drop (design-core marks `truncated`).
export const DESIGN_CHAR_BUDGET = 12_000;

// A Hanzo API key is minted by hanzo.id and is always prefixed `hk-`. isHanzoKey
// is the boundary guard: the panel validates a pasted key against this before it
// is ever handed to the client as a bearer, so an obviously-wrong paste (an IAM
// JWT, an OpenAI `sk-` key) is rejected in the UI instead of failing opaquely at
// the gateway. Trim first — users paste with trailing whitespace.
export function isHanzoKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && /^hk-[A-Za-z0-9._-]{16,}$/.test(key.trim());
}
