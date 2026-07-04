// App Bridge session-token fetch — pure and injectable so it is unit-testable
// without App Bridge or a browser. Shopify's embedded-app auth model: App Bridge
// (window.shopify) mints a short-lived session token (a signed JWT) via
// `shopify.idToken()`; the frontend attaches it as `Authorization: Bearer <jwt>`
// on every backend call, and the server verifies it (the shop identity is in the
// token, so the server does not trust the shop query param blindly). This wraps a
// base fetch to add that header, refreshing the token per request (tokens expire
// in ~1 minute, so we never cache one).
//
// getIdToken is injected: in the app it is `() => window.shopify.idToken()`; in
// tests it is a stub. That keeps this module free of any global and fully pure.

export type IdTokenSource = () => Promise<string>;

// authenticatedFetch returns a fetch that, before each request, fetches a fresh
// session token and adds it as a Bearer header. It merges (does not clobber) any
// caller headers. If token retrieval fails, the request still goes out without
// the header — the server will reject it — so a token outage surfaces as a clean
// 401 from the server rather than a thrown fetch here.
export function authenticatedFetch(baseFetch: typeof fetch, getIdToken: IdTokenSource): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    try {
      const token = await getIdToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch {
      /* no token — let the server 401 */
    }
    return baseFetch(input, { ...init, headers });
  };
}
