// Zendesk app config — the api.hanzo.ai model gateway base, the default model,
// and the pure context budget that keeps a long ticket thread from being fired
// at the model wholesale. No secrets here: the Hanzo API key is a Zendesk
// SECURE installation setting, read at runtime from `client.metadata().settings`
// (see zaf.ts), never committed.

/** Where the Hanzo model gateway lives. `@hanzo/ai`'s `createAiClient` defaults
 *  here too; we pass it explicitly so the value is visible and testable. */
export const API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when the installer has not picked one. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/** Name of the secure installation parameter that holds the Hanzo `sk-…` key.
 *  Must match the `parameters[].name` in manifest.json and the settings key
 *  Zendesk exposes via `client.metadata()`. */
export const APIKEY_SETTING = 'hanzo_api_key';

/** Optional installation parameter overriding {@link DEFAULT_MODEL}. */
export const MODEL_SETTING = 'default_model';

/** Context budget. A busy ticket can have dozens of long comments; the whole
 *  thread won't fit a model window and shouldn't be sent. This caps the
 *  characters of ticket text attached to any one request — chosen conservatively
 *  so it fits comfortably inside a modern context window alongside the reply,
 *  and is honest rather than optimal (we truncate visibly, oldest-first, rather
 *  than silently drop). */
export const CONTEXT_CHAR_BUDGET = 48_000;

/** True when a string looks like a Hanzo API key. Boundary guard only — the
 *  authoritative check is a real `/v1/models` call (see hanzo.validateKey). */
export function looksLikeApiKey(key: string): boolean {
  return /^sk-/.test(key.trim());
}
