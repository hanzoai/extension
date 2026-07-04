import { describe, it, expect } from 'vitest';
import { createApi } from '../src/app/api';

const SHOP = 'my-store.myshopify.com';

// A fetch stub recording requests and replaying queued responses. Lets us assert
// the exact URL + body the panel's client shapes, with no network.
function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('createApi request shaping', () => {
  it('getProduct GETs /v1/product with the shop + id query', async () => {
    const s = stubFetch([{ body: { id: 'gid://shopify/Product/1', title: 'Beanie' } }]);
    const api = createApi({ baseUrl: 'https://shopify.hanzo.ai', shop: SHOP, fetch: s.fetch });
    const p = await api.getProduct('gid://shopify/Product/1');
    expect(p.title).toBe('Beanie');
    const url = new URL(s.calls[0].url);
    expect(url.pathname).toBe('/v1/product');
    expect(url.searchParams.get('shop')).toBe(SHOP);
    expect(url.searchParams.get('id')).toBe('gid://shopify/Product/1');
  });

  it('runProductAction POSTs /v1/product/action with shop+id+action+model and returns content', async () => {
    const s = stubFetch([{ body: { content: 'A great description.' } }]);
    const api = createApi({ shop: SHOP, fetch: s.fetch });
    const out = await api.runProductAction('gid://shopify/Product/1', 'writeDescription', 'zen5');
    expect(out).toBe('A great description.');
    expect(s.calls[0].url).toContain('/v1/product/action');
    expect(s.calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(s.calls[0].init?.body))).toEqual({
      shop: SHOP,
      id: 'gid://shopify/Product/1',
      action: 'writeDescription',
      model: 'zen5',
    });
  });

  it('updateProduct POSTs /v1/product/update with only the fields set', async () => {
    const s = stubFetch([{ body: { ok: true, product: { id: 'gid://shopify/Product/1', title: 'Beanie' } } }]);
    const api = createApi({ shop: SHOP, fetch: s.fetch });
    const res = await api.updateProduct('gid://shopify/Product/1', { descriptionHtml: '<p>new</p>' });
    expect(res).toEqual({ id: 'gid://shopify/Product/1', title: 'Beanie' });
    expect(JSON.parse(String(s.calls[0].init?.body))).toEqual({
      shop: SHOP,
      id: 'gid://shopify/Product/1',
      descriptionHtml: '<p>new</p>',
    });
  });

  it('listModels reads { models } from /v1/models', async () => {
    const s = stubFetch([{ body: { models: ['zen5', 'zen5-mini'] } }]);
    const api = createApi({ shop: SHOP, fetch: s.fetch });
    expect(await api.listModels()).toEqual(['zen5', 'zen5-mini']);
  });

  it('throws the server error message on a non-ok response', async () => {
    const s = stubFetch([{ status: 400, body: { error: 'shop not installed' } }]);
    const api = createApi({ shop: SHOP, fetch: s.fetch });
    await expect(api.getProduct('gid://shopify/Product/1')).rejects.toThrow('shop not installed');
  });

  it('same-origin base ("" ) builds a root-relative URL', async () => {
    const s = stubFetch([{ body: { id: 'x', name: '#1', lineItems: [] } }]);
    const api = createApi({ shop: SHOP, fetch: s.fetch });
    await api.getOrder('gid://shopify/Order/1');
    expect(s.calls[0].url.startsWith('/v1/order?')).toBe(true);
  });
});
