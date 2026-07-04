import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  authorizeUrl,
  tokenExchange,
  parseTokenResponse,
  callbackMessage,
  computeCallbackHmac,
  constantTimeEqualHex,
  verifyCallbackHmac,
  parseCallback,
} from '../src/server/oauth';

const SECRET = 'shpss_app_secret_abc';

// The reference computation Shopify performs for the OAuth callback:
// hex(HMAC-SHA256(secret, sorted-message)).
function refHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

describe('authorizeUrl', () => {
  it('builds the shop authorize URL with comma-joined scopes and state', () => {
    const url = authorizeUrl({
      shop: 'my-store.myshopify.com',
      apiKey: 'apikey',
      scopes: 'read_products,write_products,read_orders',
      redirectUri: 'https://shopify.hanzo.ai/oauth/callback',
      state: 'nonce-1',
    });
    expect(url.startsWith('https://my-store.myshopify.com/admin/oauth/authorize?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('client_id')).toBe('apikey');
    expect(q.get('scope')).toBe('read_products,write_products,read_orders');
    expect(q.get('redirect_uri')).toBe('https://shopify.hanzo.ai/oauth/callback');
    expect(q.get('state')).toBe('nonce-1');
    // Offline mode is the default — no per-user grant option.
    expect(url).not.toContain('grant_options');
  });
});

describe('tokenExchange', () => {
  it('posts client_id + client_secret + code as JSON to the shop token endpoint', () => {
    const req = tokenExchange({ shop: 'my-store.myshopify.com', apiKey: 'apikey', apiSecret: SECRET, code: 'the-code' });
    expect(req.url).toBe('https://my-store.myshopify.com/admin/oauth/access_token');
    expect(req.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(req.body);
    expect(body).toEqual({ client_id: 'apikey', client_secret: SECRET, code: 'the-code' });
  });
  it('keeps the secret in the body only, never the URL', () => {
    const req = tokenExchange({ shop: 's.myshopify.com', apiKey: 'k', apiSecret: SECRET, code: 'c' });
    expect(req.url).not.toContain(SECRET);
  });
});

describe('parseTokenResponse', () => {
  it('returns access_token + scope', () => {
    expect(parseTokenResponse({ access_token: 'shpat_x', scope: 'read_products' })).toEqual({
      access_token: 'shpat_x',
      scope: 'read_products',
    });
  });
  it('throws on an error payload', () => {
    expect(() => parseTokenResponse({ error: 'invalid_request', error_description: 'bad code' })).toThrow(/bad code/);
  });
  it('throws when access_token is missing', () => {
    expect(() => parseTokenResponse({ scope: 'x' })).toThrow(/access_token/);
    expect(() => parseTokenResponse(null)).toThrow();
  });
});

describe('callbackMessage', () => {
  it('drops hmac + signature, sorts remaining params, joins key=value', () => {
    const msg = callbackMessage({
      code: 'c',
      shop: 'my-store.myshopify.com',
      state: 'nonce',
      timestamp: '1700000000',
      hmac: 'sig-to-drop',
      signature: 'legacy-to-drop',
    });
    expect(msg).toBe('code=c&shop=my-store.myshopify.com&state=nonce&timestamp=1700000000');
    expect(msg).not.toContain('hmac');
    expect(msg).not.toContain('signature');
  });

  it('URL-encodes values to match Shopify canonical form (URLSearchParams.toString)', () => {
    // `host` is base64url with `=` padding and `state` can carry a `/` — both
    // encode. A raw `key=value` join would produce the wrong message and fail to
    // validate a real callback; the encoded form matches Shopify's ProcessedQuery.
    const params = { host: 'abc==', shop: 's.myshopify.com', state: 'a/b c' };
    const msg = callbackMessage(params);
    const expected = new URLSearchParams([
      ['host', 'abc=='],
      ['shop', 's.myshopify.com'],
      ['state', 'a/b c'],
    ]).toString();
    expect(msg).toBe(expected);
    expect(msg).toContain('host=abc%3D%3D');
    expect(msg).toContain('state=a%2Fb+c');
  });
});

describe('computeCallbackHmac + constantTimeEqualHex', () => {
  it('matches the Shopify hex reference', () => {
    const msg = 'code=c&shop=s.myshopify.com&state=n&timestamp=1';
    expect(computeCallbackHmac(SECRET, msg)).toBe(refHex(SECRET, msg));
  });
  it('constant-time hex compare: true for equal, false for different / different length', () => {
    const a = refHex(SECRET, 'x');
    expect(constantTimeEqualHex(a, a)).toBe(true);
    expect(constantTimeEqualHex(a, refHex(SECRET, 'y'))).toBe(false);
    expect(constantTimeEqualHex(a, a.slice(0, -2))).toBe(false);
    expect(constantTimeEqualHex('', a)).toBe(false);
  });
});

describe('verifyCallbackHmac (OAuth trust gate)', () => {
  function signedParams(secret: string, params: Record<string, string>): Record<string, string> {
    const message = callbackMessage(params);
    return { ...params, hmac: refHex(secret, message) };
  }

  const params = { code: 'c', shop: 'my-store.myshopify.com', state: 'nonce', timestamp: '1700000000' };

  it('accepts a correctly signed callback', () => {
    expect(verifyCallbackHmac(SECRET, signedParams(SECRET, params))).toBe(true);
  });
  it('rejects a tampered param (shop swapped after signing)', () => {
    const signed = signedParams(SECRET, params);
    signed.shop = 'attacker.myshopify.com';
    expect(verifyCallbackHmac(SECRET, signed)).toBe(false);
  });
  it('rejects a wrong secret', () => {
    expect(verifyCallbackHmac('other-secret', signedParams(SECRET, params))).toBe(false);
  });
  it('rejects a missing hmac param', () => {
    expect(verifyCallbackHmac(SECRET, params)).toBe(false);
  });
  it('rejects an empty secret', () => {
    expect(verifyCallbackHmac('', signedParams(SECRET, params))).toBe(false);
  });

  it('validates against a Shopify-canonical signature over encodable params', () => {
    // Independently reproduce Shopify's signing: sorted params → URLSearchParams
    // → toString() → hex HMAC. If our callbackMessage matched only itself (raw
    // join) this would fail, because `host`/`state` encode.
    const raw = { code: 'the code', host: 'sub==', shop: 's.myshopify.com', state: 'x/y' };
    const canonical = new URLSearchParams([
      ['code', 'the code'],
      ['host', 'sub=='],
      ['shop', 's.myshopify.com'],
      ['state', 'x/y'],
    ]).toString();
    const signed = { ...raw, hmac: refHex(SECRET, canonical) };
    expect(verifyCallbackHmac(SECRET, signed)).toBe(true);
  });
});

describe('parseCallback', () => {
  it('returns shop/code/state for a valid callback', () => {
    expect(parseCallback({ shop: 'my-store.myshopify.com', code: 'c', state: 'n' })).toEqual({
      shop: 'my-store.myshopify.com',
      code: 'c',
      state: 'n',
    });
  });
  it('throws on an invalid shop domain (defense in depth)', () => {
    expect(() => parseCallback({ shop: 'evil.com', code: 'c' })).toThrow(/shop/);
  });
  it('throws on a missing code', () => {
    expect(() => parseCallback({ shop: 'my-store.myshopify.com' })).toThrow(/code/);
  });
  it('defaults state to empty when absent', () => {
    expect(parseCallback({ shop: 'my-store.myshopify.com', code: 'c' }).state).toBe('');
  });
});
