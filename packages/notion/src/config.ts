// Hanzo-for-Notion config — the two backends this app talks to and nothing
// else. Hanzo (the model gateway, api.hanzo.ai/v1) and Notion (OAuth + REST,
// api.notion.com/v1). No `/api/` prefix on Hanzo (it is api.hanzo.ai already);
// Notion uses its literal `/v1/...` paths with a pinned Notion-Version header.
//
// Rule: secrets never live here. The Notion client_secret is read from the
// environment by server.ts, never bundled into the browser SPA.

// ── Hanzo model gateway ───────────────────────────────────────────────────

/** Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when a workspace has not picked one. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/** Public IAM origin that mints Hanzo user tokens (owner-scoping). */
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';

/** OAuth client id inbound Hanzo tokens are audienced to (validation). */
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-notion';

// ── Notion API ─────────────────────────────────────────────────────────────

/** Notion's single global API origin (no regional fan-out). */
export const NOTION_API_BASE_URL = 'https://api.notion.com';

/**
 * The Notion API version pin, sent as the `Notion-Version` header on EVERY
 * request (REST and OAuth token exchange). Notion serves a stable response
 * shape for this version regardless of what it rolls forward to. Bumping this
 * is a deliberate, tested change — never silent.
 */
export const NOTION_VERSION = '2022-06-28';

/** The Notion REST API root — `${base}/v1`. */
export function notionApiRoot(base: string = NOTION_API_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/v1`;
}

/** The Notion OAuth authorize page a browser is redirected to (user consent). */
export function notionAuthorizeURL(base: string = NOTION_API_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/v1/oauth/authorize`;
}

/** The Notion OAuth token endpoint (code→token, server-side only). */
export function notionTokenURL(base: string = NOTION_API_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/v1/oauth/token`;
}
