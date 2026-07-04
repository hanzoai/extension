// Reading the embedded-app launch context — pure, browser-string-in / values-out,
// so it is unit-testable without an iframe. Shopify launches the embedded admin
// app inside an iframe with `shop`, `host`, and (from an admin block/action
// extension on a product/order page) the resource `id` in the URL query. The
// React panel reads this once at mount.

// The launch context the panel needs. `shop` scopes every backend call; `host`
// is App Bridge's base64 host param; `resource` + `resourceId` are set when the
// app opened from a product or order page (an admin link/action), so the panel
// can jump straight to that subject.
export interface LaunchContext {
  shop: string;
  host: string;
  resource: 'product' | 'order' | '';
  resourceId: string;
}

// Shopify sometimes passes a bare numeric id and sometimes a GID
// (gid://shopify/Product/123). toGid normalizes a value to a GID for a resource
// kind — the Admin GraphQL API takes GIDs. A value already in gid:// form is
// returned unchanged; a bare number is wrapped. Pure.
export function toGid(kind: 'Product' | 'Order', id: string): string {
  const v = id.trim();
  if (!v) return '';
  if (v.startsWith('gid://')) return v;
  return `gid://shopify/${kind}/${v}`;
}

// resourceKind maps a `resource` query value to the GID kind, defaulting to ''
// (no resource). Only 'product' and 'order' are surfaces this app acts on.
function resourceOf(v: string | null): 'product' | 'order' | '' {
  return v === 'product' || v === 'order' ? v : '';
}

// parseLaunchContext reads the iframe URL's query string into a LaunchContext.
// A GID passed for the resource id is preserved; a bare id is normalized to a GID
// for the named resource. Pure.
export function parseLaunchContext(search: string): LaunchContext {
  const q = new URLSearchParams(search);
  const resource = resourceOf(q.get('resource'));
  const rawId = q.get('id') ?? '';
  const resourceId =
    resource === 'product'
      ? toGid('Product', rawId)
      : resource === 'order'
        ? toGid('Order', rawId)
        : rawId;
  return {
    shop: q.get('shop') ?? '',
    host: q.get('host') ?? '',
    resource,
    resourceId,
  };
}
