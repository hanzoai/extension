// Shopify config — the api.hanzo.ai model gateway (default model + endpoints),
// the Shopify Admin API version + OAuth scopes, and the server-side secret set
// (Shopify API key/secret + webhook HMAC). Endpoints and the bearer choice
// mirror @hanzo/docusign and @hanzo/notion so the productivity suite stays DRY;
// the commerce-specific pieces (product-context assembly, the AI actions) live
// in hanzo.ts / actions.ts, not here.

// ---- Hanzo model gateway --------------------------------------------------

// Where the Hanzo model gateway lives. `@hanzo/ai` (createAiClient) defaults
// here too. /v1 only, never an /api/ prefix (api.hanzo.ai IS the api host).
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

// Default model. A Zen model (qwen3+). Overridable per-request via the picker;
// the gateway routes it.
export const DEFAULT_MODEL = 'zen5';

// Public IAM origin that mints Hanzo user tokens, and the OAuth client id an
// inbound Hanzo token is audienced to (owner-scoping validation via @hanzo/iam).
export const DEFAULT_IAM_SERVER_URL = 'https://hanzo.id';
export const DEFAULT_IAM_CLIENT_ID = 'hanzo-shopify';

// chatCompletionsURL / modelsURL — the model gateway endpoints. The client
// (createAiClient) builds these itself; these exist for tests + honest docs.
export function chatCompletionsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${HANZO_API_BASE_URL}/v1/models`;
}

// ---- Shopify Admin API ----------------------------------------------------
//
// Shopify Admin API is versioned by calendar quarter (YYYY-MM). We pin ONE
// version and move it forward deliberately — never a speculative future one.
// The GraphQL Admin API is the primary surface (productUpdate, product/order
// reads); REST is legacy. Every call is against the per-shop host
// `https://{shop}/admin/api/{version}/graphql.json`.
export const ADMIN_API_VERSION = '2025-01';

// The OAuth scopes the app requests. read/write products for content write-back,
// read_orders for order insight + support drafting. No scope we do not use.
export const OAUTH_SCOPES = ['read_products', 'write_products', 'read_orders'] as const;

// Product description text budget. A product body_html plus its metafields and
// variants can run long; this caps the characters of product context we attach
// to any one request so it fits comfortably in a model window alongside the
// reply. Honest truncation, never silent drop.
export const PRODUCT_CHAR_BUDGET = 20_000;

// A Shopify shop domain looks like `my-store.myshopify.com`. isShopDomain is the
// boundary guard: OAuth install/callback and webhook handlers validate the shop
// parameter against this before it is ever placed in a URL, so an attacker
// cannot point the OAuth dance or an API call at an arbitrary host. Shopify's
// rule: hostname ending in `.myshopify.com`, only [a-z0-9-] in the store slug.
export function isShopDomain(shop: string | undefined | null): shop is string {
  return typeof shop === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

// adminGraphqlUrl builds the GraphQL Admin API endpoint for a shop. Pure — the
// request wrappers in shopify-api.ts take this string. Callers MUST have passed
// `shop` through isShopDomain first (server.ts does).
export function adminGraphqlUrl(shop: string, version: string = ADMIN_API_VERSION): string {
  return `https://${shop}/admin/api/${version}/graphql.json`;
}

// ---- Server-side configuration (Shopify OAuth + webhook HMAC) --------------
//
// These are read from the environment by src/server/server.ts. They NEVER reach
// the browser bundle: the API key (client id) is public, but the API secret is
// server-only — it signs the OAuth exchange AND is the HMAC key Shopify uses to
// sign both the OAuth callback and every webhook. readServerConfig throws on a
// missing secret so a server that can neither complete OAuth nor verify a
// webhook refuses to start.

export interface ServerConfig {
  /** Shopify API key / OAuth client id (public — appears in the authorize URL). */
  shopifyApiKey: string;
  /**
   * Shopify API secret (SERVER ONLY). Two jobs: the OAuth token-exchange
   * `client_secret`, AND the HMAC-SHA256 key for the OAuth callback signature
   * and every webhook signature. One secret, both trust gates.
   */
  shopifyApiSecret: string;
  /** OAuth redirect registered on the app (e.g. https://shopify.hanzo.ai/oauth/callback). */
  shopifyRedirectUri: string;
  /** The scopes string sent to /admin/oauth/authorize (space is not used — comma). */
  scopes: string;
  /**
   * Hanzo API key the server uses to run AI on behalf of a shop when no user
   * bearer is in the loop (the webhook path). Optional: without it the server
   * still does OAuth + Admin API + verifies webhooks, but the webhook cannot
   * run a model call (it logs and skips), which readServerConfig reports.
   */
  hanzoApiKey: string;
  /** Listen port. */
  port: number;
}

// readServerConfig fails fast (throws) if a required Shopify secret is missing.
// hanzoApiKey is the one optional field (see above). Pure given an env map, so
// it is unit-tested without touching process.env.
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const shopifyApiKey = env.SHOPIFY_API_KEY;
  const shopifyApiSecret = env.SHOPIFY_API_SECRET;
  const shopifyRedirectUri = env.SHOPIFY_REDIRECT_URI;
  const missing: string[] = [];
  if (!shopifyApiKey) missing.push('SHOPIFY_API_KEY');
  if (!shopifyApiSecret) missing.push('SHOPIFY_API_SECRET');
  if (!shopifyRedirectUri) missing.push('SHOPIFY_REDIRECT_URI');
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
  return {
    shopifyApiKey: shopifyApiKey!,
    shopifyApiSecret: shopifyApiSecret!,
    shopifyRedirectUri: shopifyRedirectUri!,
    scopes: env.SHOPIFY_SCOPES || OAUTH_SCOPES.join(','),
    hanzoApiKey: env.HANZO_API_KEY || '',
    port: Number(env.PORT) || 8791,
  };
}
