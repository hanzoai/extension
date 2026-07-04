// Shopify Admin GraphQL API — pure request shaping + response parsing. Every
// function returns a PreparedGraphql (url + headers + JSON body) or parses a
// response body; none opens a socket, so the whole API surface is unit-testable
// without a network. server.ts is the thin glue that fetches these shapes with a
// shop's offline access token.
//
// The endpoint is `https://{shop}/admin/api/{version}/graphql.json` (see
// config.adminGraphqlUrl). Authorization is the per-shop token in the
// X-Shopify-Access-Token header (NOT a Bearer). Docs:
// shopify.dev/docs/api/admin-graphql

import { adminGraphqlUrl } from '../config.js';

// A prepared GraphQL POST: the pieces a single fetch needs. The access token
// rides in the X-Shopify-Access-Token header, per Shopify's Admin API.
export interface PreparedGraphql {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// graphql builds a PreparedGraphql from a query + variables against a shop.
// One place assembles the token header + JSON body so every call is identical.
export function graphql(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): PreparedGraphql {
  return {
    url: adminGraphqlUrl(shop),
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  };
}

// ---- Queries / mutations --------------------------------------------------

// PRODUCT_QUERY reads the fields the AI needs to write content: title, current
// description (as body HTML + plain text), product type, vendor, tags, the SEO
// title/description, and the first handful of variants for price/option context.
// We ask for exactly what the prompt uses — no over-fetching.
export const PRODUCT_QUERY = /* GraphQL */ `
  query ProductForAI($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      description
      productType
      vendor
      tags
      status
      seo { title description }
      options { name values }
      variants(first: 10) {
        nodes { title sku price }
      }
    }
  }
`;

// getProduct — fetch one product by its GID (gid://shopify/Product/123).
export function getProduct(shop: string, accessToken: string, id: string): PreparedGraphql {
  return graphql(shop, accessToken, PRODUCT_QUERY, { id });
}

// PRODUCT_UPDATE_MUTATION writes AI-generated content back: the description HTML
// and/or the SEO title/description. `input` is Shopify's ProductInput; we only
// ever send the fields we changed. userErrors is requested so a validation
// failure surfaces as data, not a thrown 200.
export const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation UpdateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title descriptionHtml seo { title description } }
      userErrors { field message }
    }
  }
`;

// The write-back fields the AI produces. Any subset may be present — we send
// only what is set, so a "rewrite description" never clobbers the SEO title.
export interface ProductWriteback {
  id: string;
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
}

// buildProductInput turns a ProductWriteback into Shopify's ProductInput shape,
// including `seo` only when a title or description is set. Pure so the exact
// mutation variables are asserted in a test. Throws on a missing id (the mutation
// cannot target a product without it) — a boundary error surfaced to the caller.
export function buildProductInput(w: ProductWriteback): Record<string, unknown> {
  if (!w.id) throw new Error('productUpdate requires a product id');
  const input: Record<string, unknown> = { id: w.id };
  if (w.descriptionHtml !== undefined) input.descriptionHtml = w.descriptionHtml;
  if (w.seoTitle !== undefined || w.seoDescription !== undefined) {
    const seo: Record<string, unknown> = {};
    if (w.seoTitle !== undefined) seo.title = w.seoTitle;
    if (w.seoDescription !== undefined) seo.description = w.seoDescription;
    input.seo = seo;
  }
  return input;
}

// updateProduct — the productUpdate mutation with the built input.
export function updateProduct(shop: string, accessToken: string, w: ProductWriteback): PreparedGraphql {
  return graphql(shop, accessToken, PRODUCT_UPDATE_MUTATION, { input: buildProductInput(w) });
}

// ORDER_QUERY reads the fields the AI needs to summarize an order and draft a
// customer reply: name/number, financial + fulfillment status, totals, the
// customer, line items, the shipping address, and the internal note. Enough to
// answer "what is this order" and "draft a reply" without a second round trip.
export const ORDER_QUERY = /* GraphQL */ `
  query OrderForAI($id: ID!) {
    order(id: $id) {
      id
      name
      note
      email
      displayFinancialStatus
      displayFulfillmentStatus
      createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { firstName lastName email }
      shippingAddress { city province country }
      lineItems(first: 50) {
        nodes { title quantity sku }
      }
    }
  }
`;

// getOrder — fetch one order by its GID (gid://shopify/Order/123).
export function getOrder(shop: string, accessToken: string, id: string): PreparedGraphql {
  return graphql(shop, accessToken, ORDER_QUERY, { id });
}

// ---- Response parsing -----------------------------------------------------

// The normalized product our prompt assembly consumes. Snake/camel from the wire
// is normalized here so nothing downstream touches the GraphQL shape.
export interface ProductInfo {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  seoTitle: string;
  seoDescription: string;
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{ title: string; sku: string; price: string }>;
}

// graphqlErrors extracts the top-level `errors` array a GraphQL endpoint returns
// on a bad query (distinct from userErrors on a mutation). Returns the joined
// messages, or '' when there are none. Pure.
export function graphqlErrors(data: any): string {
  const errs = data?.errors;
  if (!Array.isArray(errs) || errs.length === 0) return '';
  return errs.map((e: any) => String(e?.message ?? e)).join('; ');
}

// parseProduct reads a getProduct response into a ProductInfo. Throws on a
// GraphQL error or a null product (a bad id) so the caller learns immediately.
export function parseProduct(data: any): ProductInfo {
  const err = graphqlErrors(data);
  if (err) throw new Error(`Shopify GraphQL error: ${err}`);
  const p = data?.data?.product;
  if (!p) throw new Error('product not found');
  return {
    id: String(p.id ?? ''),
    title: String(p.title ?? ''),
    handle: String(p.handle ?? ''),
    descriptionHtml: String(p.descriptionHtml ?? ''),
    description: String(p.description ?? ''),
    productType: String(p.productType ?? ''),
    vendor: String(p.vendor ?? ''),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    status: String(p.status ?? ''),
    seoTitle: String(p.seo?.title ?? ''),
    seoDescription: String(p.seo?.description ?? ''),
    options: Array.isArray(p.options)
      ? p.options.map((o: any) => ({
          name: String(o?.name ?? ''),
          values: Array.isArray(o?.values) ? o.values.map(String) : [],
        }))
      : [],
    variants: Array.isArray(p.variants?.nodes)
      ? p.variants.nodes.map((v: any) => ({
          title: String(v?.title ?? ''),
          sku: String(v?.sku ?? ''),
          price: String(v?.price ?? ''),
        }))
      : [],
  };
}

// The normalized order our prompt assembly + summary consume.
export interface OrderInfo {
  id: string;
  name: string;
  note: string;
  email: string;
  financialStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
  totalAmount: string;
  currency: string;
  customerName: string;
  shipTo: string;
  lineItems: Array<{ title: string; quantity: number; sku: string }>;
}

// parseOrder reads a getOrder response into an OrderInfo. Throws on a GraphQL
// error or a null order.
export function parseOrder(data: any): OrderInfo {
  const err = graphqlErrors(data);
  if (err) throw new Error(`Shopify GraphQL error: ${err}`);
  const o = data?.data?.order;
  if (!o) throw new Error('order not found');
  const money = o.totalPriceSet?.shopMoney ?? {};
  const cust = o.customer ?? {};
  const addr = o.shippingAddress ?? {};
  const customerName = [cust.firstName, cust.lastName].filter(Boolean).map(String).join(' ').trim();
  const shipTo = [addr.city, addr.province, addr.country].filter(Boolean).map(String).join(', ');
  return {
    id: String(o.id ?? ''),
    name: String(o.name ?? ''),
    note: String(o.note ?? ''),
    email: String(o.email ?? cust.email ?? ''),
    financialStatus: String(o.displayFinancialStatus ?? ''),
    fulfillmentStatus: String(o.displayFulfillmentStatus ?? ''),
    createdAt: String(o.createdAt ?? ''),
    totalAmount: String(money.amount ?? ''),
    currency: String(money.currencyCode ?? ''),
    customerName,
    shipTo,
    lineItems: Array.isArray(o.lineItems?.nodes)
      ? o.lineItems.nodes.map((li: any) => ({
          title: String(li?.title ?? ''),
          quantity: Number(li?.quantity ?? 0) || 0,
          sku: String(li?.sku ?? ''),
        }))
      : [],
  };
}

// parseProductUpdate reads a productUpdate response, surfacing userErrors (a
// validation failure Shopify returns inside a 200) as a thrown error so the
// write-back path has ONE way to fail: reject. Returns the updated product's id
// + title on success. Pure.
export function parseProductUpdate(data: any): { id: string; title: string } {
  const err = graphqlErrors(data);
  if (err) throw new Error(`Shopify GraphQL error: ${err}`);
  const result = data?.data?.productUpdate;
  if (!result) throw new Error('productUpdate returned no result');
  const userErrors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (userErrors.length > 0) {
    const msg = userErrors
      .map((e: any) => `${Array.isArray(e?.field) ? e.field.join('.') : e?.field ?? ''}: ${e?.message ?? ''}`.trim())
      .join('; ');
    throw new Error(`productUpdate failed: ${msg}`);
  }
  const product = result.product;
  if (!product?.id) throw new Error('productUpdate returned no product');
  return { id: String(product.id), title: String(product.title ?? '') };
}
