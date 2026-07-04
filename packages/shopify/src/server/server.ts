// The Hanzo AI for Shopify service. This is the ONLY place the Shopify API secret
// and the Hanzo API key exist — both read from the environment (never bundled,
// never sent to the browser). It does OAuth, proxies the Admin GraphQL API + the
// @hanzo/ai model gateway, and verifies every Shopify HMAC. The embedded Polaris
// frontend calls the /v1/* proxy endpoints with its shop domain; the offline
// access token stays here.
//
//   GET  /oauth/install?shop=…       → redirect the merchant to Shopify consent
//   GET  /oauth/callback?…           → verify HMAC + state, exchange code, store
//                                      the offline token per shop
//   GET  /v1/product?shop=&id=       → read a product (Admin GraphQL)
//   GET  /v1/order?shop=&id=         → read an order (Admin GraphQL)
//   GET  /v1/models?shop=            → list model ids the shop may route to
//   POST /v1/product/action          → run an AI product action, return content
//   POST /v1/order/action            → run an AI order action, return content
//   POST /v1/product/update          → write AI content back (productUpdate)
//   POST /webhooks                   → verify the Shopify webhook HMAC, route
//   GET  /healthz                    → readiness
//
// Dependency-free Node http handler over the pure modules (config, oauth,
// shopify-api, webhooks, hanzo, actions) so it is deployable behind
// hanzoai/ingress as a small service at shopify.hanzo.ai.
//
//   node dist/server.js    (after build.js bundles it)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isShopDomain, readServerConfig, type ServerConfig } from '../config.js';
import {
  authorizeUrl,
  tokenExchange,
  parseTokenResponse,
  verifyCallbackHmac,
  parseCallback,
} from './oauth.js';
import {
  getProduct,
  getOrder,
  updateProduct,
  parseProduct,
  parseOrder,
  parseProductUpdate,
  type PreparedGraphql,
  type ProductWriteback,
} from './shopify-api.js';
import { verifyWebhook, routeWebhook, type WebhookAction } from './webhooks.js';
import { runProductAction, runOrderAction, isProductActionId, isOrderActionId } from './actions.js';
import { listModels, type AskOptions } from './hanzo.js';

// A stored per-shop authorization: the offline access token to call the Admin
// API. In-memory here keyed by shop domain; a production deployment persists
// this to KMS/Valkey (keyed by shop) so the webhook and the panel can act after
// a restart. The install flow populates it; every other endpoint reads it.
const shops = new Map<string, { accessToken: string; scope: string }>();

// Fresh OAuth `state` nonces awaiting their callback. A production deployment
// persists these (Valkey, TTL) so state survives a restart and cannot be
// replayed; in-process is enough for a single instance and keeps the trust gate
// real (an unknown state is rejected).
const pendingStates = new Set<string>();

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

// send performs a PreparedGraphql request and returns the parsed JSON. The token
// header + body are already shaped by shopify-api; this is the one fetch.
async function send(req: PreparedGraphql): Promise<any> {
  const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Shopify Admin API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

// requireShopAuth resolves the shop from a query/body value and its stored token,
// or throws a boundary error (turned into a 400/401 by the caller). Every proxy
// endpoint runs input through this before touching Shopify — a request for an
// unknown or un-installed shop never reaches the Admin API.
function requireShopAuth(shop: string | undefined): { shop: string; accessToken: string } {
  if (!isShopDomain(shop)) throw new Error('invalid or missing shop');
  const auth = shops.get(shop);
  if (!auth) throw new Error('shop not installed');
  return { shop, accessToken: auth.accessToken };
}

// GET /oauth/install?shop=… → 302 to Shopify's consent screen. The shop is
// validated (never build the authorize URL against an unverified host); `state`
// is a fresh CSRF nonce we remember for the callback.
function handleInstall(cfg: ServerConfig, url: URL, res: ServerResponse): void {
  const shop = url.searchParams.get('shop') ?? undefined;
  if (!isShopDomain(shop)) return json(res, 400, { error: 'invalid or missing shop' });
  const state = randomUUID();
  pendingStates.add(state);
  const dest = authorizeUrl({
    shop,
    apiKey: cfg.shopifyApiKey,
    scopes: cfg.scopes,
    redirectUri: cfg.shopifyRedirectUri,
    state,
  });
  res.writeHead(302, { Location: dest });
  res.end();
}

// GET /oauth/callback → the trust gate + token exchange. Order matters:
//   1. verify the HMAC signature (authenticity) BEFORE trusting any param
//   2. check state (CSRF) against what we issued
//   3. exchange the code for the offline token (secret stays in the body)
async function handleOAuthCallback(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));

  if (!verifyCallbackHmac(cfg.shopifyApiSecret, params)) {
    log({ msg: 'oauth callback: HMAC verification failed' });
    return json(res, 401, { error: 'invalid hmac' });
  }

  let cb;
  try {
    cb = parseCallback(params);
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'invalid callback' });
  }

  if (!pendingStates.delete(cb.state)) {
    log({ msg: 'oauth callback: unknown state (possible CSRF)', shop: cb.shop });
    return json(res, 401, { error: 'invalid state' });
  }

  const ex = tokenExchange({
    shop: cb.shop,
    apiKey: cfg.shopifyApiKey,
    apiSecret: cfg.shopifyApiSecret,
    code: cb.code,
  });
  try {
    const resp = await fetch(ex.url, { method: 'POST', headers: ex.headers, body: ex.body });
    const tokenSet = parseTokenResponse(await resp.json().catch(() => ({})));
    shops.set(cb.shop, { accessToken: tokenSet.access_token, scope: tokenSet.scope });
    log({ msg: 'oauth: shop installed', shop: cb.shop, scope: tokenSet.scope });
    return json(res, 200, { ok: true, installed: true, shop: cb.shop });
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }
}

// GET /v1/product?shop=&id= → read a product for the panel.
async function handleGetProduct(url: URL, res: ServerResponse): Promise<void> {
  const { shop, accessToken } = requireShopAuth(url.searchParams.get('shop') ?? undefined);
  const id = url.searchParams.get('id');
  if (!id) return json(res, 400, { error: 'missing product id' });
  const data = await send(getProduct(shop, accessToken, id));
  return json(res, 200, parseProduct(data));
}

// GET /v1/order?shop=&id= → read an order for the panel.
async function handleGetOrder(url: URL, res: ServerResponse): Promise<void> {
  const { shop, accessToken } = requireShopAuth(url.searchParams.get('shop') ?? undefined);
  const id = url.searchParams.get('id');
  if (!id) return json(res, 400, { error: 'missing order id' });
  const data = await send(getOrder(shop, accessToken, id));
  return json(res, 200, parseOrder(data));
}

// GET /v1/models?shop= → the model ids this shop may route to. Uses the server's
// Hanzo key (the shop's org context) so the picker matches what a run will use.
async function handleModels(cfg: ServerConfig, url: URL, res: ServerResponse): Promise<void> {
  requireShopAuth(url.searchParams.get('shop') ?? undefined);
  const models = await listModels({ token: cfg.hanzoApiKey });
  return json(res, 200, { models });
}

// askOpts builds the @hanzo/ai options for a proxied run: the server's Hanzo key
// is the bearer (the merchant authenticates to Shopify via App Bridge, not to
// Hanzo directly), and the request may name a model.
function askOpts(cfg: ServerConfig, model: unknown): AskOptions {
  return { token: cfg.hanzoApiKey, model: typeof model === 'string' && model ? model : undefined };
}

// POST /v1/product/action { shop, id, action, model? } → read the product, run
// the AI action, return the generated content. The panel then previews it and,
// on confirm, calls /v1/product/update.
async function handleProductAction(cfg: ServerConfig, body: any, res: ServerResponse): Promise<void> {
  const { shop, accessToken } = requireShopAuth(body?.shop);
  if (!isProductActionId(String(body?.action))) return json(res, 400, { error: 'unknown product action' });
  if (!body?.id) return json(res, 400, { error: 'missing product id' });
  const product = parseProduct(await send(getProduct(shop, accessToken, String(body.id))));
  const content = await runProductAction(String(body.action), product, askOpts(cfg, body?.model));
  return json(res, 200, { content });
}

// POST /v1/order/action { shop, id, action, model? } → read the order, run the
// AI order/support action, return the content.
async function handleOrderAction(cfg: ServerConfig, body: any, res: ServerResponse): Promise<void> {
  const { shop, accessToken } = requireShopAuth(body?.shop);
  if (!isOrderActionId(String(body?.action))) return json(res, 400, { error: 'unknown order action' });
  if (!body?.id) return json(res, 400, { error: 'missing order id' });
  const order = parseOrder(await send(getOrder(shop, accessToken, String(body.id))));
  const content = await runOrderAction(String(body.action), order, askOpts(cfg, body?.model));
  return json(res, 200, { content });
}

// POST /v1/product/update { shop, id, descriptionHtml?, seoTitle?, seoDescription? }
// → write AI content back via productUpdate. This is the write-back flow: the
// panel generated + previewed content, the merchant confirmed, and only the
// fields present in the body are written (a description rewrite never clobbers
// the SEO title). userErrors surface as a thrown 400.
async function handleProductUpdate(body: any, res: ServerResponse): Promise<void> {
  const { shop, accessToken } = requireShopAuth(body?.shop);
  if (!body?.id) return json(res, 400, { error: 'missing product id' });
  const w: ProductWriteback = {
    id: String(body.id),
    descriptionHtml: typeof body.descriptionHtml === 'string' ? body.descriptionHtml : undefined,
    seoTitle: typeof body.seoTitle === 'string' ? body.seoTitle : undefined,
    seoDescription: typeof body.seoDescription === 'string' ? body.seoDescription : undefined,
  };
  const updated = parseProductUpdate(await send(updateProduct(shop, accessToken, w)));
  log({ msg: 'product updated', shop, productId: updated.id });
  return json(res, 200, { ok: true, product: updated });
}

// handleWebhookAction dispatches a verified webhook. Order creation could
// auto-draft a support summary (needs the shop's token + Hanzo key); app
// uninstall drops the stored token; GDPR topics are acknowledged (a real
// deployment fulfills the data request/redaction against its own store here).
// Never throws into the http handler — logs and returns.
async function handleWebhookAction(cfg: ServerConfig, action: WebhookAction): Promise<void> {
  switch (action.kind) {
    case 'order_created':
      log({ msg: 'webhook: order created', shop: action.shop, orderId: action.orderId, canDraft: !!cfg.hanzoApiKey });
      // A deployment that wants an auto-drafted summary reads the order via the
      // shop's stored token and runs runOrderAction('summarize', …), then stores
      // the result (hanzoai/docdb) or notifies the merchant. Delivery target is a
      // per-deployment choice (documented in the README).
      return;
    case 'app_uninstalled':
      shops.delete(action.shop);
      log({ msg: 'webhook: app uninstalled, token dropped', shop: action.shop });
      return;
    case 'gdpr':
      log({ msg: 'webhook: gdpr topic acknowledged', topic: action.topic, shop: action.shop });
      return;
    case 'ignored':
      log({ msg: 'webhook: ignored', topic: action.topic, shop: action.shop });
      return;
  }
}

// POST /webhooks → verify, then dispatch. Verification is the trust gate: a
// webhook with a bad/absent HMAC is a 401 before any action. Shopify sends the
// signature in X-Shopify-Hmac-Sha256, the shop in X-Shopify-Shop-Domain, and the
// topic in X-Shopify-Topic.
async function handleWebhook(cfg: ServerConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readRawBody(req);
  const headerHmac = req.headers['x-shopify-hmac-sha256'];
  const hmac = Array.isArray(headerHmac) ? headerHmac[0] : headerHmac;

  if (!verifyWebhook(cfg.shopifyApiSecret, hmac, raw)) {
    log({ msg: 'webhook: signature verification failed' });
    return json(res, 401, { error: 'invalid signature' });
  }

  const topic = String(req.headers['x-shopify-topic'] ?? '');
  const shop = String(req.headers['x-shopify-shop-domain'] ?? '');
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'invalid json' });
  }

  // Acknowledge immediately; do the work after (Shopify retries slow endpoints).
  json(res, 200, { ok: true });
  void handleWebhookAction(cfg, routeWebhook(topic, shop, body));
}

// createHandler is the request router. Every route is a small handler over the
// pure modules. Exported so a test can drive it with a mock req/res if desired.
export function createHandler(cfg: ServerConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${cfg.port}`);
    try {
      if (req.method === 'GET' && url.pathname === '/oauth/install') return handleInstall(cfg, url, res);
      if (req.method === 'GET' && url.pathname === '/oauth/callback') return await handleOAuthCallback(cfg, url, res);
      if (req.method === 'GET' && url.pathname === '/v1/product') return await handleGetProduct(url, res);
      if (req.method === 'GET' && url.pathname === '/v1/order') return await handleGetOrder(url, res);
      if (req.method === 'GET' && url.pathname === '/v1/models') return await handleModels(cfg, url, res);
      if (req.method === 'POST' && url.pathname === '/webhooks') return await handleWebhook(cfg, req, res);
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });

      if (req.method === 'POST') {
        const raw = await readRawBody(req);
        let body: any = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            return json(res, 400, { error: 'invalid json' });
          }
        }
        if (url.pathname === '/v1/product/action') return await handleProductAction(cfg, body, res);
        if (url.pathname === '/v1/order/action') return await handleOrderAction(cfg, body, res);
        if (url.pathname === '/v1/product/update') return await handleProductUpdate(body, res);
      }

      return json(res, 404, { error: 'not found' });
    } catch (e: any) {
      const msg = e?.message || 'error';
      // Boundary errors (bad input, un-installed shop) are 400; the rest 500.
      const status = /invalid|missing|not installed|unknown|not found/i.test(msg) ? 400 : 500;
      log({ msg: 'request error', path: url.pathname, error: msg, status });
      return json(res, status, { error: msg });
    }
  };
}

// main boots the server when run directly. Import-safe: only the direct entry
// listens, so tests import the handlers without opening a port.
export function main(): void {
  const cfg = readServerConfig(process.env);
  const server = createServer(createHandler(cfg));
  server.listen(cfg.port, () => {
    log({ msg: 'hanzo shopify service up', port: cfg.port, ai: !!cfg.hanzoApiKey });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main();
}
