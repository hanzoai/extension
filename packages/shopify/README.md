# Hanzo AI for Shopify

AI for your Shopify store, where the store is the system of record. An embedded
admin app (Polaris + App Bridge) over a small Node backend:

- **Product content** — generate or rewrite product **descriptions**, and write
  **SEO titles / meta descriptions**, from the product's own attributes, then
  **write the result back** to the product (`productUpdate`).
- **Orders & support** — summarize an order, draft a customer reply, and extract
  issues from an order's note.
- **Ask** — a freeform question about a product or an order, grounded in its data.

Every model call goes through the **published `@hanzo/ai`** headless client to the
Hanzo gateway (`https://api.hanzo.ai/v1`, a Zen model by default). Shopify data
goes through the **Admin GraphQL API**. The backend holds the Shopify API secret
and the Hanzo key; the React frontend never sees a secret.

## Architecture

```
Shopify Admin ──(iframe, App Bridge)──►  Polaris React app  (src/app/)
                                              │  session-token fetch
                                              ▼
                                   Node backend  (src/server/)
                          ┌───────────────┼────────────────────┐
                          │               │                    │
                   Shopify OAuth   Admin GraphQL API      @hanzo/ai  ──► api.hanzo.ai/v1
                   + webhook HMAC  (product / order /     (createAiClient)
                   verification    productUpdate)
```

- `src/server/oauth.ts` — OAuth request shaping + **OAuth-callback HMAC** verify
  (hex over sorted query params) + state (CSRF) check.
- `src/server/shopify-api.ts` — Admin GraphQL wrappers: `getProduct`, `getOrder`,
  `updateProduct` (the `productUpdate` mutation) — pure request shaping + parsing.
- `src/server/hanzo.ts` — thin over **`@hanzo/ai`** (`createAiClient`); owns
  product/order context assembly + prompt building. Never reimplements transport.
- `src/server/actions.ts` — the AI action catalog (product content + order/support),
  one prompt each over the single ask primitive.
- `src/server/webhooks.ts` — **webhook HMAC** verify (base64 over the RAW body) +
  topic routing (`orders/create`, `app/uninstalled`, the three GDPR topics).
- `src/server/server.ts` — the HTTP service; the ONLY place the secret + Hanzo key
  live. OAuth, the `/v1/*` proxy the frontend calls, and `/webhooks`.
- `src/app/` — the Polaris + App Bridge admin panel (`api.ts`, `context.ts`,
  `session-fetch.ts`, `App.tsx`, `Assistant.tsx`, `main.tsx`).

All logic-heavy code is **pure and unit-tested**; the HTTP server and the React
DOM glue are thin over it.

## Create the Shopify app (Partner Dashboard)

1. **Partners → Apps → Create app → Create app manually.** Note the **API key**
   (public — the OAuth `client_id`) and the **API secret key** (server-only — it
   signs the OAuth exchange AND is the HMAC key for the callback and every
   webhook).
2. **App setup → App URL:** `https://shopify.hanzo.ai/` (where the embedded app
   is served — see Deploy).
3. **App setup → Allowed redirection URL(s):** add
   `https://shopify.hanzo.ai/oauth/callback` (the exact `SHOPIFY_REDIRECT_URI`).
4. **Embedded app:** leave "Embed app in Shopify admin" **on** (`embedded = true`).

Or manage it all from `shopify.app.toml`:

```bash
npm i -g @shopify/cli
shopify app config link      # bind shopify.app.toml to your Partner app
shopify app deploy           # push scopes, URLs, webhooks, and the admin-link extension
```

Put your Partner **API key** into `shopify.app.toml`'s `client_id` (it is public).
The **secret** never goes in the toml — only in the server environment.

### OAuth scopes

`read_products, write_products, read_orders` — declared in `shopify.app.toml`
(`[access_scopes]`) and in `config.ts` (`OAUTH_SCOPES`). Read/write products for
content write-back; read orders for support + order insight. Nothing else.

## OAuth flow + HMAC (the trust gates)

1. **Install:** `GET /oauth/install?shop=<store>.myshopify.com` → the server
   validates the shop domain (`isShopDomain`), mints a `state` nonce, and 302s to
   `https://{shop}/admin/oauth/authorize?client_id&scope&redirect_uri&state`
   (offline access — a long-lived token the webhook can use).
2. **Callback:** Shopify redirects to `/oauth/callback?code&hmac&shop&state&…`.
   The server, **in order**:
   - **verifies the `hmac`** — `hex(HMAC-SHA256(apiSecret, sortedParams))`,
     constant-time compare (`verifyCallbackHmac`). A bad signature is a `401`
     before anything else.
   - checks `state` against the nonce it issued (CSRF).
   - exchanges the `code` at `POST https://{shop}/admin/oauth/access_token`
     (secret in the JSON body, over TLS) for the **offline access token**, stored
     server-side keyed by shop.
3. **Webhooks:** `POST /webhooks` — the server **verifies the
   `X-Shopify-Hmac-Sha256` header** — `base64(HMAC-SHA256(apiSecret, RAW_BODY))`,
   computed over the raw bytes, constant-time compare (`verifyWebhook`). A bad
   signature is a `401` before any action. Then it routes on `X-Shopify-Topic`.

> The OAuth callback HMAC (hex, sorted query params) and the webhook HMAC (base64,
> raw body) are **different** signatures — both keyed by the same API secret. Both
> are implemented and tested here.

## Product write-back flow

1. The panel loads a product: `GET /v1/product?shop=&id=` → Admin GraphQL
   `product(id:)`.
2. The merchant clicks e.g. **Rewrite description**:
   `POST /v1/product/action {shop,id,action,model}` → the server reads the product,
   assembles a grounded prompt (the product's attributes, fenced as data), runs
   `@hanzo/ai`, and returns the generated content.
3. The panel previews the content in an editable box. On **Save to product**:
   `POST /v1/product/update {shop,id,descriptionHtml | seoTitle | seoDescription}`
   → the server sends the **`productUpdate`** mutation with **only the changed
   field** (a description rewrite never clobbers the SEO title), surfacing any
   `userErrors` as a real failure.

## Run it

```bash
pnpm install
pnpm build          # → dist/index.html + dist/app.js + dist/app.css (app), dist/server.js (service)
pnpm test           # vitest — the pure modules
pnpm typecheck      # tsc --noEmit

# The service (holds the secret + Hanzo key):
SHOPIFY_API_KEY=...          # public client id
SHOPIFY_API_SECRET=...       # SERVER ONLY — OAuth + all HMAC
SHOPIFY_REDIRECT_URI=https://shopify.hanzo.ai/oauth/callback
HANZO_API_KEY=sk-...         # optional — lets the webhook run a model call
PORT=8791
node dist/server.js
```

The app bundle is built with the **public** API key stamped into its
`shopify-api-key` meta tag (App Bridge needs it); the **secret is never bundled**
— `SHOPIFY_API_SECRET` is read from the server's environment only.

```bash
SHOPIFY_API_KEY=<public-key> HANZO_SHOPIFY_BASE=https://shopify.hanzo.ai pnpm build
```

## Deploy (embedded app + App Store path)

- **App** (`dist/index.html` + `app.js` + `app.css`) is served as static assets
  over `hanzoai/static` behind `hanzoai/ingress` at the **App URL**
  (`https://shopify.hanzo.ai/`). Shopify loads it in the admin iframe; App Bridge
  (loaded from Shopify's CDN) provides the session token the frontend sends to the
  service.
- **Service** (`dist/server.js`) runs behind the same ingress: `/oauth/*`,
  `/v1/*`, `/webhooks`, `/healthz`. In production, persist the per-shop offline
  token and the OAuth `state` nonces to KMS/Valkey (the in-memory maps in
  `server.ts` are single-instance).
- **Extension:** `extensions/product-assistant` is an admin **link** that adds
  "Hanzo AI" to the product and order detail pages and deep-links the embedded app
  with the resource in context. `shopify app deploy` ships it.
- **App Store:** an embedded app that (a) uses **session-token auth** (App Bridge),
  (b) verifies **OAuth + webhook HMAC**, and (c) subscribes to the three
  **GDPR/privacy webhooks** (`customers/data_request`, `customers/redact`,
  `shop/redact` — all routed and acknowledged here) meets the core App Store
  review requirements. Submit from the Partner Dashboard after `shopify app deploy`.

## Security notes

- The Shopify **API secret** and the **Hanzo key** live only in the server
  environment — never in the app bundle, never in `shopify.app.toml`.
- Every OAuth callback and every webhook is **HMAC-verified** (constant-time)
  before it is trusted.
- The `shop` parameter is validated against `*.myshopify.com` (`isShopDomain`)
  before it is ever placed in a URL — no request can be pointed at an arbitrary
  host.
- Model calls use `@hanzo/ai` against `api.hanzo.ai/v1` — no `/api/` prefix, one
  gateway, the same wire shape as every other Hanzo surface.
