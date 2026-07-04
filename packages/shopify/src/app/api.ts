// The admin panel's backend client — pure request shaping over the server proxy.
// The frontend NEVER holds the Shopify secret or the Hanzo key: it calls the
// server's /v1/* endpoints with its shop domain, and the server holds the token
// and talks to Shopify + api.hanzo.ai. This module is pure over an injected
// `fetch` (App Bridge's authenticated fetch in the app; a mock in tests), so the
// request shaping is unit-testable without a browser.
//
// Every method returns typed data or throws with the server's error message, so
// the React panel has ONE way to handle failure: try/catch on await.

// A product as the panel consumes it (the server's parseProduct output).
export interface Product {
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
}

// An order as the panel consumes it (the server's parseOrder output).
export interface Order {
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

// The fields a product write-back may carry. Only what is set is sent.
export interface ProductWriteback {
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface ApiOptions {
  /** Backend base (the server behind hanzoai/ingress). '' means same-origin. */
  baseUrl?: string;
  /** The shop domain (from App Bridge host/shop). Sent on every call. */
  shop: string;
  /**
   * The fetch to use. In the app this is App Bridge's authenticated fetch (adds
   * the session-token Authorization header so the server can trust the shop).
   * In tests, a mock. Defaults to global fetch.
   */
  fetch?: typeof fetch;
}

// asError turns a non-ok response body into a thrown Error carrying the server's
// message. One place decodes the { error } envelope so every call fails the same
// way.
async function asError(resp: Response): Promise<never> {
  let msg = `HTTP ${resp.status}`;
  try {
    const data: any = await resp.json();
    if (data?.error) msg = String(data.error);
  } catch {
    /* non-JSON body — keep the status */
  }
  throw new Error(msg);
}

// createApi builds the panel's typed client bound to a shop + fetch. Every method
// is a single request to the server proxy.
export function createApi(opts: ApiOptions) {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const shop = opts.shop;

  async function getJson(path: string, query: Record<string, string>): Promise<any> {
    const q = new URLSearchParams({ shop, ...query }).toString();
    const resp = await doFetch(`${base}${path}?${q}`);
    if (!resp.ok) return asError(resp);
    return resp.json();
  }

  async function postJson(path: string, body: Record<string, unknown>): Promise<any> {
    const resp = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, ...body }),
    });
    if (!resp.ok) return asError(resp);
    return resp.json();
  }

  return {
    getProduct(id: string): Promise<Product> {
      return getJson('/v1/product', { id });
    },
    getOrder(id: string): Promise<Order> {
      return getJson('/v1/order', { id });
    },
    async listModels(): Promise<string[]> {
      const data = await getJson('/v1/models', {});
      return Array.isArray(data?.models) ? data.models : [];
    },
    async runProductAction(id: string, action: string, model?: string): Promise<string> {
      const data = await postJson('/v1/product/action', { id, action, model });
      return String(data?.content ?? '');
    },
    async runOrderAction(id: string, action: string, model?: string): Promise<string> {
      const data = await postJson('/v1/order/action', { id, action, model });
      return String(data?.content ?? '');
    },
    async updateProduct(id: string, w: ProductWriteback): Promise<{ id: string; title: string }> {
      const data = await postJson('/v1/product/update', { id, ...w });
      return data?.product ?? { id, title: '' };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
