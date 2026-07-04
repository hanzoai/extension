// Shopify webhooks: HMAC signature verification and topic routing — all pure
// over their inputs so they are unit-testable without an http server. server.ts
// is the thin http glue that reads the raw body + headers and calls these.
// Crypto is Node's stdlib (node:crypto), never a dependency.
//
// Shopify signs every webhook with the app's API secret. Unlike the OAuth
// callback (hex over sorted query params), a webhook signature is:
//   X-Shopify-Hmac-Sha256: base64(HMAC-SHA256(apiSecret, RAW_REQUEST_BODY))
// computed over the RAW body bytes. We must NOT JSON.parse-and-reserialize
// before verifying (key order/whitespace would differ and every webhook would
// fail). This is the whole trust boundary: a webhook that fails here is
// discarded before it is acted on. The shop + topic ride in headers
// (X-Shopify-Shop-Domain, X-Shopify-Topic). Docs:
// shopify.dev/docs/apps/build/webhooks/subscribe/verify-webhooks

import { createHmac, timingSafeEqual } from 'node:crypto';

// computeWebhookHmac is base64(HMAC-SHA256(apiSecret, rawBody)) — the value
// Shopify puts in X-Shopify-Hmac-Sha256. Both verification and any test fixture
// are built from it, so the value we compare is produced exactly as Shopify
// produces it.
export function computeWebhookHmac(apiSecret: string, rawBody: string): string {
  return createHmac('sha256', apiSecret).update(rawBody, 'utf8').digest('base64');
}

// constantTimeEqualB64 compares two base64 digests without leaking
// length/position via timing. Different-length inputs are unequal and
// short-circuit safely (never feeding mismatched buffers to timingSafeEqual,
// which would throw).
export function constantTimeEqualB64(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'base64');
  const bb = Buffer.from(b, 'base64');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// verifyWebhook is the trust gate: recompute base64(HMAC-SHA256(apiSecret,
// rawBody)) and constant-time compare against the X-Shopify-Hmac-Sha256 header.
// Returns false on any missing input rather than throwing, so a malformed
// request is a clean reject.
export function verifyWebhook(apiSecret: string, headerHmac: string | undefined, rawBody: string): boolean {
  if (!apiSecret || !headerHmac) return false;
  return constantTimeEqualB64(headerHmac, computeWebhookHmac(apiSecret, rawBody));
}

// ---- Topic routing --------------------------------------------------------
//
// After a webhook is verified, we route on the X-Shopify-Topic header into a
// discriminated action so the server can dispatch. We act on order creation
// (auto-draft a support summary), app uninstall (drop the stored token), and
// the three GDPR "mandatory" topics every public app MUST handle to pass App
// Store review. Everything unknown is acknowledged and ignored — a clean 200.

export type WebhookAction =
  | { kind: 'order_created'; shop: string; orderId: string }
  | { kind: 'app_uninstalled'; shop: string }
  | { kind: 'gdpr'; topic: string; shop: string }
  | { kind: 'ignored'; topic: string; shop: string };

// The three GDPR/privacy topics Shopify requires a public app to subscribe to
// and respond to. shopify.dev/docs/apps/build/privacy-law-compliance
const GDPR_TOPICS = new Set([
  'customers/data_request',
  'customers/redact',
  'shop/redact',
]);

// gid://shopify/Order/12345 → "gid://shopify/Order/12345". We keep the full GID
// (the GraphQL Admin API takes GIDs); the numeric REST `id` is a fallback. Pure.
function orderIdOf(body: any): string {
  return String(body?.admin_graphql_api_id ?? body?.id ?? '');
}

// routeWebhook turns a topic + PARSED, ALREADY-VERIFIED body into a
// WebhookAction. Verification is the caller's job (verifyWebhook) — this is pure
// dispatch, unit-testable with plain objects. `shop` is the
// X-Shopify-Shop-Domain header value.
export function routeWebhook(topic: string, shop: string, body: any): WebhookAction {
  const t = topic.toLowerCase();
  if (t === 'orders/create') {
    return { kind: 'order_created', shop, orderId: orderIdOf(body) };
  }
  if (t === 'app/uninstalled') {
    return { kind: 'app_uninstalled', shop };
  }
  if (GDPR_TOPICS.has(t)) {
    return { kind: 'gdpr', topic: t, shop };
  }
  return { kind: 'ignored', topic: t, shop };
}
