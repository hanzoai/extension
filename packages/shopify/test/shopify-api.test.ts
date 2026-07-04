import { describe, it, expect } from 'vitest';
import {
  graphql,
  getProduct,
  getOrder,
  updateProduct,
  buildProductInput,
  parseProduct,
  parseOrder,
  parseProductUpdate,
  graphqlErrors,
  PRODUCT_QUERY,
  ORDER_QUERY,
  PRODUCT_UPDATE_MUTATION,
} from '../src/server/shopify-api';
import { ADMIN_API_VERSION } from '../src/config';

const SHOP = 'my-store.myshopify.com';
const TOKEN = 'shpat_offline_token';

describe('graphql request shaping', () => {
  it('posts to the versioned graphql endpoint with the access-token header (not Bearer)', () => {
    const req = graphql(SHOP, TOKEN, 'query { x }', { a: 1 });
    expect(req.url).toBe(`https://${SHOP}/admin/api/${ADMIN_API_VERSION}/graphql.json`);
    expect(req.headers['X-Shopify-Access-Token']).toBe(TOKEN);
    expect(req.headers.Authorization).toBeUndefined();
    expect(JSON.parse(req.body)).toEqual({ query: 'query { x }', variables: { a: 1 } });
  });
});

describe('getProduct / getOrder', () => {
  it('getProduct sends the product query with the GID variable', () => {
    const req = getProduct(SHOP, TOKEN, 'gid://shopify/Product/1');
    const b = JSON.parse(req.body);
    expect(b.query).toBe(PRODUCT_QUERY);
    expect(b.variables).toEqual({ id: 'gid://shopify/Product/1' });
  });
  it('getOrder sends the order query with the GID variable', () => {
    const req = getOrder(SHOP, TOKEN, 'gid://shopify/Order/2');
    const b = JSON.parse(req.body);
    expect(b.query).toBe(ORDER_QUERY);
    expect(b.variables).toEqual({ id: 'gid://shopify/Order/2' });
  });
});

describe('buildProductInput (write-back)', () => {
  it('includes only the fields that are set', () => {
    expect(buildProductInput({ id: 'gid://shopify/Product/1', descriptionHtml: '<p>hi</p>' })).toEqual({
      id: 'gid://shopify/Product/1',
      descriptionHtml: '<p>hi</p>',
    });
  });
  it('nests seo only when a title or description is present', () => {
    expect(buildProductInput({ id: 'p1', seoTitle: 'T' })).toEqual({ id: 'p1', seo: { title: 'T' } });
    expect(buildProductInput({ id: 'p1', seoDescription: 'D' })).toEqual({ id: 'p1', seo: { description: 'D' } });
    expect(buildProductInput({ id: 'p1', seoTitle: 'T', seoDescription: 'D' })).toEqual({
      id: 'p1',
      seo: { title: 'T', description: 'D' },
    });
  });
  it('a description-only write does not clobber seo, and vice versa', () => {
    const descOnly = buildProductInput({ id: 'p1', descriptionHtml: '<p>x</p>' });
    expect(descOnly.seo).toBeUndefined();
    const seoOnly = buildProductInput({ id: 'p1', seoTitle: 'T' });
    expect(seoOnly.descriptionHtml).toBeUndefined();
  });
  it('throws without an id', () => {
    expect(() => buildProductInput({ id: '' })).toThrow(/id/);
  });
});

describe('updateProduct mutation', () => {
  it('sends the productUpdate mutation with the built input', () => {
    const req = updateProduct(SHOP, TOKEN, { id: 'gid://shopify/Product/1', descriptionHtml: '<p>new</p>' });
    const b = JSON.parse(req.body);
    expect(b.query).toBe(PRODUCT_UPDATE_MUTATION);
    expect(b.query).toContain('productUpdate');
    expect(b.query).toContain('userErrors');
    expect(b.variables).toEqual({ input: { id: 'gid://shopify/Product/1', descriptionHtml: '<p>new</p>' } });
  });
});

describe('graphqlErrors', () => {
  it('joins top-level error messages, or returns empty', () => {
    expect(graphqlErrors({ errors: [{ message: 'boom' }, { message: 'bad' }] })).toBe('boom; bad');
    expect(graphqlErrors({ data: {} })).toBe('');
  });
});

describe('parseProduct', () => {
  const ok = {
    data: {
      product: {
        id: 'gid://shopify/Product/1',
        title: 'Wool Beanie',
        handle: 'wool-beanie',
        descriptionHtml: '<p>Warm.</p>',
        description: 'Warm.',
        productType: 'Hats',
        vendor: 'Acme',
        tags: ['winter', 'wool'],
        status: 'ACTIVE',
        seo: { title: 'Wool Beanie', description: 'A warm wool beanie' },
        options: [{ name: 'Color', values: ['Black', 'Grey'] }],
        variants: { nodes: [{ title: 'Black', sku: 'WB-BLK', price: '24.00' }] },
      },
    },
  };

  it('normalizes the product fields', () => {
    const p = parseProduct(ok);
    expect(p.title).toBe('Wool Beanie');
    expect(p.tags).toEqual(['winter', 'wool']);
    expect(p.seoTitle).toBe('Wool Beanie');
    expect(p.options[0]).toEqual({ name: 'Color', values: ['Black', 'Grey'] });
    expect(p.variants[0]).toEqual({ title: 'Black', sku: 'WB-BLK', price: '24.00' });
  });
  it('throws on a graphql error', () => {
    expect(() => parseProduct({ errors: [{ message: 'nope' }] })).toThrow(/nope/);
  });
  it('throws on a null product (bad id)', () => {
    expect(() => parseProduct({ data: { product: null } })).toThrow(/not found/);
  });
});

describe('parseOrder', () => {
  const ok = {
    data: {
      order: {
        id: 'gid://shopify/Order/2',
        name: '#1002',
        note: 'Customer asked to expedite.',
        email: 'buyer@example.com',
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'UNFULFILLED',
        createdAt: '2026-01-02T10:00:00Z',
        totalPriceSet: { shopMoney: { amount: '48.00', currencyCode: 'USD' } },
        customer: { firstName: 'Sam', lastName: 'Lee', email: 'buyer@example.com' },
        shippingAddress: { city: 'Austin', province: 'Texas', country: 'United States' },
        lineItems: { nodes: [{ title: 'Wool Beanie', quantity: 2, sku: 'WB-BLK' }] },
      },
    },
  };

  it('normalizes the order, joining customer name + ship-to', () => {
    const o = parseOrder(ok);
    expect(o.name).toBe('#1002');
    expect(o.financialStatus).toBe('PAID');
    expect(o.customerName).toBe('Sam Lee');
    expect(o.shipTo).toBe('Austin, Texas, United States');
    expect(o.totalAmount).toBe('48.00');
    expect(o.currency).toBe('USD');
    expect(o.lineItems[0]).toEqual({ title: 'Wool Beanie', quantity: 2, sku: 'WB-BLK' });
  });
  it('throws on a null order', () => {
    expect(() => parseOrder({ data: { order: null } })).toThrow(/not found/);
  });
});

describe('parseProductUpdate', () => {
  it('returns the updated product on success', () => {
    const res = parseProductUpdate({
      data: { productUpdate: { product: { id: 'gid://shopify/Product/1', title: 'Wool Beanie' }, userErrors: [] } },
    });
    expect(res).toEqual({ id: 'gid://shopify/Product/1', title: 'Wool Beanie' });
  });
  it('throws userErrors (a validation failure Shopify returns inside a 200)', () => {
    expect(() =>
      parseProductUpdate({
        data: { productUpdate: { product: null, userErrors: [{ field: ['descriptionHtml'], message: 'too long' }] } },
      }),
    ).toThrow(/descriptionHtml: too long/);
  });
  it('throws on a top-level graphql error', () => {
    expect(() => parseProductUpdate({ errors: [{ message: 'denied' }] })).toThrow(/denied/);
  });
});
