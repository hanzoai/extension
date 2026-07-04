// Clio OAuth2 (authorization code grant). PURE request shaping only — the
// authorize URL a browser is redirected to, and the token-exchange / refresh
// request shape (URL + form body). The client_secret is a caller-supplied
// value that ONLY server.ts holds (from the environment); this module never
// sources it, so it stays trivially unit-testable and free of secrets.
//
// Clio's endpoints: authorize `${base}/oauth/authorize`, token `${base}/oauth/token`.
// Token exchange and refresh are both application/x-www-form-urlencoded POSTs.

import { clioAuthorizeURL, clioTokenURL, CLIO_SCOPES } from './config.js';

export interface AuthorizeParams {
  base: string; // regional Clio origin (from clioBase)
  clientId: string;
  redirectUri: string;
  // CSRF state the caller mints and later verifies on the callback.
  state: string;
  // Override the default scopes if a firm's app is scoped narrower.
  scope?: string;
  // Clio supports offline access to get a refresh_token. Default on so the
  // long-lived integration can refresh without re-consent.
  offlineAccess?: boolean;
}

// oauthAuthorizeUrl builds the exact URL to redirect the user's browser to.
// Clio's authorization endpoint takes response_type=code, client_id,
// redirect_uri, state, and (for a refresh token) access_type=offline.
export function oauthAuthorizeUrl(p: AuthorizeParams): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    scope: p.scope ?? CLIO_SCOPES,
  });
  // Clio issues a refresh_token only when access_type=offline is requested.
  if (p.offlineAccess !== false) params.set('access_type', 'offline');
  return `${clioAuthorizeURL(p.base)}?${params.toString()}`;
}

// The shape of a request server.ts will POST — separated from fetch so a test
// asserts the URL, headers, and form body without a network call.
export interface TokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string; // urlencoded form
}

export interface ExchangeParams {
  base: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string; // the authorization code from the callback
}

// tokenExchange shapes the code→token POST. Clio: grant_type=authorization_code,
// with client_id, client_secret, code, redirect_uri as a urlencoded body.
export function tokenExchange(p: ExchangeParams): TokenRequest {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
  });
  return {
    url: clioTokenURL(p.base),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  };
}

export interface RefreshParams {
  base: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// tokenRefresh shapes the refresh POST. Clio: grant_type=refresh_token with the
// stored refresh_token. Same endpoint, same content type as exchange.
export function tokenRefresh(p: RefreshParams): TokenRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  return {
    url: clioTokenURL(p.base),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  };
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  // Absolute expiry (epoch ms) computed from Clio's expires_in at parse time,
  // so callers compare against Date.now() without re-deriving.
  expiresAt: number;
}

// parseTokenResponse turns Clio's JSON token payload into a TokenSet, computing
// the absolute expiry. `now` is injectable so the derivation is unit-testable.
// Throws on an OAuth error payload so the caller surfaces Clio's real reason.
export function parseTokenResponse(data: any, now: number = Date.now()): TokenSet {
  if (data && data.error) {
    const desc = data.error_description || data.error;
    throw new Error(`Clio OAuth error: ${desc}`);
  }
  const accessToken = data?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Clio OAuth: no access_token in response');
  }
  const expiresIn = Number(data?.expires_in ?? 0);
  return {
    accessToken,
    refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : '',
    tokenType: typeof data?.token_type === 'string' ? data.token_type : 'bearer',
    expiresAt: now + expiresIn * 1000,
  };
}

// isExpired reports whether a token set is at/near expiry. A skew (default 60s)
// refreshes slightly early so an in-flight request never races the boundary.
export function isExpired(tokens: TokenSet, now: number = Date.now(), skewMs = 60_000): boolean {
  return now >= tokens.expiresAt - skewMs;
}
