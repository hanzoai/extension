// Shopify OAuth (Authorization Code Grant) — pure request shaping + the OAuth
// callback HMAC verification. The API secret is held by the server (server.ts)
// and never reaches the browser; these functions build the exact URL/body of
// each OAuth call and verify Shopify's signature on the redirect, so the wire
// shape and the trust gate are unit-testable without a network round-trip.
//
// Shopify's flow (shopify.dev/docs/apps/auth/oauth):
//   1. redirect the merchant to https://{shop}/admin/oauth/authorize?…
//   2. Shopify redirects back to our redirect_uri with ?code&hmac&shop&state&…
//      — we VERIFY the `hmac` (HMAC-SHA256 over the sorted remaining params,
//      hex) before trusting anything, then check `state` (CSRF).
//   3. POST https://{shop}/admin/oauth/access_token with the code + secret to
//      get the offline access token, stored server-side per shop.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isShopDomain } from '../config.js';

// authorizeUrl is where the install flow sends the merchant's browser to grant
// the app. `scope` is comma-joined (Shopify's convention, NOT space), `state`
// is the CSRF nonce the server generates and re-checks on callback. Offline
// access mode is the default (no `grant_options[]=per-user`), which is what a
// background webhook needs — a long-lived token, not a per-user online one.
export function authorizeUrl(args: {
  shop: string;
  apiKey: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: args.apiKey,
    scope: args.scopes,
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `https://${args.shop}/admin/oauth/authorize?${q.toString()}`;
}

// A prepared token-exchange request: the pieces a single fetch needs. Pure
// output so a test asserts the URL + JSON body without opening a socket. The
// secret rides ONLY in the body, over TLS to Shopify's own host.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// tokenExchange builds the code→token request against the shop's
// /admin/oauth/access_token. Shopify takes a JSON body of client_id +
// client_secret + code and returns { access_token, scope }.
export function tokenExchange(args: {
  shop: string;
  apiKey: string;
  apiSecret: string;
  code: string;
}): PreparedRequest {
  return {
    url: `https://${args.shop}/admin/oauth/access_token`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: args.apiKey,
      client_secret: args.apiSecret,
      code: args.code,
    }),
  };
}

// The token response we care about. Shopify returns access_token (the offline
// token) + the granted scope. parseTokenResponse validates the one field we
// must have and surfaces Shopify's own error otherwise.
export interface ShopifyTokenSet {
  access_token: string;
  scope: string;
}

export function parseTokenResponse(data: any): ShopifyTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error || data.errors) {
    const reason = data.error_description || data.error || JSON.stringify(data.errors);
    throw new Error(`Shopify OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Shopify OAuth response missing access_token');
  }
  return { access_token: data.access_token, scope: String(data.scope ?? '') };
}

// ---- OAuth callback HMAC verification (the trust gate) --------------------
//
// Shopify signs the OAuth redirect: the `hmac` query param is
// hex(HMAC-SHA256(apiSecret, message)), where `message` is the OTHER query
// params (everything except `hmac` and the legacy `signature`) sorted by key
// and joined `key=value&key=value` — with the ORIGINAL, still-URL-encoded
// values. We must reconstruct that exact string. A callback that fails here is
// discarded before any token exchange. Docs:
// shopify.dev/docs/apps/auth/oauth/getting-started#step-4-confirm-installation

// callbackMessage builds the signed message from a param map: drop hmac +
// signature, sort the rest by key, then re-encode as an
// application/x-www-form-urlencoded query string. This EXACTLY matches Shopify's
// canonical form (stringifyQueryForAdmin → ProcessedQuery.stringify, which is a
// URLSearchParams.toString()): keys/values are percent-encoded, spaces become
// `+`. Building the raw `key=value` join instead would fail to validate any
// callback whose values contain encodable characters (e.g. `host`, `state`), so
// we mirror URLSearchParams here. `params` are the decoded values (as
// URLSearchParams.forEach yields them); URLSearchParams re-encodes them the same
// way Shopify did when it signed. Pure.
export function callbackMessage(params: Record<string, string>): string {
  const sorted = new URLSearchParams();
  for (const key of Object.keys(params).filter((k) => k !== 'hmac' && k !== 'signature').sort()) {
    sorted.append(key, params[key]);
  }
  return sorted.toString();
}

// computeCallbackHmac is hex(HMAC-SHA256(apiSecret, message)). Both verification
// and any test fixture are built from it, so the value we compare is produced
// exactly as Shopify produces it.
export function computeCallbackHmac(apiSecret: string, message: string): string {
  return createHmac('sha256', apiSecret).update(message, 'utf8').digest('hex');
}

// constantTimeEqualHex compares two hex digests without leaking length/position
// via timing. Different-length inputs are unequal and short-circuit safely (we
// never feed mismatched buffers to timingSafeEqual, which would throw).
export function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// verifyCallbackHmac is the OAuth trust gate: reconstruct the signed message
// from the callback params, recompute the hex HMAC with the app secret, and
// constant-time compare against the provided `hmac` param. Returns false on any
// missing input rather than throwing, so a malformed callback is a clean reject.
export function verifyCallbackHmac(
  apiSecret: string,
  params: Record<string, string>,
): boolean {
  const provided = params.hmac;
  if (!apiSecret || !provided) return false;
  const expected = computeCallbackHmac(apiSecret, callbackMessage(params));
  return constantTimeEqualHex(provided, expected);
}

// ---- Callback parameter validation ----------------------------------------

// A validated OAuth callback: the shop, the code to exchange, and the state to
// re-check. parseCallback pulls these from the query map AFTER the HMAC passed;
// it re-validates the shop domain (defense in depth — never build a URL against
// an unverified host) and throws on a missing code.
export interface OAuthCallback {
  shop: string;
  code: string;
  state: string;
}

export function parseCallback(params: Record<string, string>): OAuthCallback {
  const shop = params.shop;
  if (!isShopDomain(shop)) throw new Error('invalid or missing shop domain');
  const code = params.code;
  if (!code) throw new Error('missing code');
  return { shop, code, state: params.state ?? '' };
}
