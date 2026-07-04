import { describe, it, expect } from 'vitest';
import { toGid, parseLaunchContext } from '../src/app/context';

describe('toGid', () => {
  it('wraps a bare numeric id into a GID for the kind', () => {
    expect(toGid('Product', '123')).toBe('gid://shopify/Product/123');
    expect(toGid('Order', '9')).toBe('gid://shopify/Order/9');
  });
  it('leaves an existing GID unchanged', () => {
    expect(toGid('Product', 'gid://shopify/Product/123')).toBe('gid://shopify/Product/123');
  });
  it('returns empty for empty input', () => {
    expect(toGid('Product', '')).toBe('');
    expect(toGid('Product', '   ')).toBe('');
  });
});

describe('parseLaunchContext', () => {
  it('reads shop + host', () => {
    const ctx = parseLaunchContext('?shop=my-store.myshopify.com&host=abc123');
    expect(ctx.shop).toBe('my-store.myshopify.com');
    expect(ctx.host).toBe('abc123');
    expect(ctx.resource).toBe('');
    expect(ctx.resourceId).toBe('');
  });
  it('normalizes a bare product id to a GID', () => {
    const ctx = parseLaunchContext('?shop=s.myshopify.com&resource=product&id=555');
    expect(ctx.resource).toBe('product');
    expect(ctx.resourceId).toBe('gid://shopify/Product/555');
  });
  it('normalizes a bare order id to a GID', () => {
    const ctx = parseLaunchContext('?resource=order&id=777');
    expect(ctx.resource).toBe('order');
    expect(ctx.resourceId).toBe('gid://shopify/Order/777');
  });
  it('preserves a GID that is already passed', () => {
    const ctx = parseLaunchContext('?resource=product&id=gid://shopify/Product/1');
    expect(ctx.resourceId).toBe('gid://shopify/Product/1');
  });
  it('ignores an unknown resource type', () => {
    const ctx = parseLaunchContext('?resource=collection&id=1');
    expect(ctx.resource).toBe('');
    expect(ctx.resourceId).toBe('1');
  });
});
