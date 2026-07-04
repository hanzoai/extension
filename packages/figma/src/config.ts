// Figma plugin config — the api.hanzo.ai model gateway base, the default model,
// the clientStorage key for the pasted key, and the pure context budget that
// keeps a large frame's worth of layers from being fired at the model wholesale.
// The base URL and bearer choice mirror @hanzo/zendesk and @hanzo/pdf so every
// Hanzo surface speaks to the gateway the same way; only the persona and the
// selection→context assembly are what a *design* surface adds on top.

/** Where the Hanzo model gateway lives. `@hanzo/ai`'s `createAiClient` defaults
 *  here too; we pass it explicitly so the value is visible and testable. `/v1`
 *  only, never an `/api/` prefix (api.hanzo.ai IS the api host). */
export const API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when the picker has not been touched. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/** figma.clientStorage key for the pasted Hanzo API key (`hk-…`). clientStorage
 *  is the plugin-scoped persistent store; unlike a static web app's
 *  localStorage, only the main thread can reach it, so the iframe asks code.ts
 *  to load/save it over the messaging protocol. */
export const APIKEY_STORAGE_KEY = 'hanzo.figma.apiKey';

/** figma.clientStorage key for the last-used model id, so the picker restores
 *  the designer's choice across sessions. */
export const MODEL_STORAGE_KEY = 'hanzo.figma.model';

/** Context budget. A frame can hold hundreds of nodes with long text; the whole
 *  serialized selection won't fit a model window and shouldn't be sent. This
 *  caps the characters of selection context attached to any one request — chosen
 *  conservatively so it fits comfortably inside a modern context window
 *  alongside the reply, and is honest rather than optimal (we truncate visibly,
 *  with a note, rather than silently drop). */
export const CONTEXT_CHAR_BUDGET = 24_000;

/** True when a string looks like a Hanzo API key. Boundary guard only — the
 *  authoritative check is a real `/v1/models` call (see design-core.validateKey). */
export function looksLikeApiKey(key: string): boolean {
  return /^hk-/.test(key.trim());
}
