import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  computeWebhookHmac,
  constantTimeEqualB64,
  verifyWebhook,
  routeWebhook,
} from '../src/server/webhooks';

const SECRET = 'shpss_app_secret_abc';

// The reference computation Shopify performs for a webhook:
// base64(HMAC-SHA256(secret, rawBody)).
function refB64(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

describe('computeWebhookHmac', () => {
  it('is base64(HMAC-SHA256(secret, rawBody)) — matches the Shopify reference', () => {
    const body = '{"id":12345}';
    expect(computeWebhookHmac(SECRET, body)).toBe(refB64(SECRET, body));
  });
  it('is base64-shaped and deterministic', () => {
    const a = computeWebhookHmac(SECRET, 'x');
    expect(a).toBe(computeWebhookHmac(SECRET, 'x'));
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('constantTimeEqualB64', () => {
  it('true for equal, false for different / different-length without throwing', () => {
    const a = refB64(SECRET, 'x');
    expect(constantTimeEqualB64(a, a)).toBe(true);
    expect(constantTimeEqualB64(a, refB64(SECRET, 'y'))).toBe(false);
    expect(constantTimeEqualB64(a, 'AAAA')).toBe(false);
    expect(constantTimeEqualB64('', a)).toBe(false);
  });
});

describe('verifyWebhook (trust gate)', () => {
  const body = JSON.stringify({ id: 12345, admin_graphql_api_id: 'gid://shopify/Order/12345' });
  const good = refB64(SECRET, body);

  it('accepts a webhook signed with the app secret', () => {
    expect(verifyWebhook(SECRET, good, body)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyWebhook(SECRET, good, body + ' ')).toBe(false);
  });
  it('rejects a wrong secret', () => {
    expect(verifyWebhook('other', good, body)).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(verifyWebhook(SECRET, undefined, body)).toBe(false);
  });
  it('rejects an empty secret', () => {
    expect(verifyWebhook('', good, body)).toBe(false);
  });
});

describe('routeWebhook', () => {
  it('routes orders/create to an actionable event with the GID', () => {
    const action = routeWebhook('orders/create', 'my-store.myshopify.com', {
      id: 12345,
      admin_graphql_api_id: 'gid://shopify/Order/12345',
    });
    expect(action.kind).toBe('order_created');
    if (action.kind === 'order_created') {
      expect(action.shop).toBe('my-store.myshopify.com');
      expect(action.orderId).toBe('gid://shopify/Order/12345');
    }
  });
  it('falls back to the numeric id when no GID is present', () => {
    const action = routeWebhook('orders/create', 's.myshopify.com', { id: 99 });
    if (action.kind === 'order_created') expect(action.orderId).toBe('99');
  });
  it('routes app/uninstalled', () => {
    const action = routeWebhook('app/uninstalled', 's.myshopify.com', {});
    expect(action.kind).toBe('app_uninstalled');
    if (action.kind === 'app_uninstalled') expect(action.shop).toBe('s.myshopify.com');
  });
  it.each(['customers/data_request', 'customers/redact', 'shop/redact'])(
    'routes the GDPR topic %s',
    (topic) => {
      const action = routeWebhook(topic, 's.myshopify.com', {});
      expect(action.kind).toBe('gdpr');
      if (action.kind === 'gdpr') expect(action.topic).toBe(topic);
    },
  );
  it('ignores an unknown topic (still a clean ack)', () => {
    const action = routeWebhook('products/update', 's.myshopify.com', {});
    expect(action.kind).toBe('ignored');
    if (action.kind === 'ignored') expect(action.topic).toBe('products/update');
  });
  it('is case-insensitive on the topic header', () => {
    expect(routeWebhook('ORDERS/CREATE', 's.myshopify.com', { id: 1 }).kind).toBe('order_created');
  });
});
