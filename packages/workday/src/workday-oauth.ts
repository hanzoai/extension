// Workday OAuth 2.0 (Authorization Code Grant) — pure request shaping. The client
// secret is held by the server (server.ts) and never reaches the browser; these
// functions build the exact URL/body/headers of each OAuth call so the wire shape
// is unit-testable without a network round-trip. The token exchange and refresh
// are each one fetch in the server.
//
// Workday differs from Procore in two ways that matter, and both are modelled
// here rather than glossed over:
//   1. The token endpoint authenticates the client with HTTP Basic
//      (Authorization: Basic base64(client_id:client_secret)) — the secret rides
//      in the header, NOT the form body. developer.workday.com's OAuth guide.
//   2. Workday does NOT rotate the refresh token on refresh and the refresh
//      response usually omits refresh_token — so the caller carries the prior one
//      forward (carryRefreshToken).
//
// Endpoints hang off the tenant OAuth root `${host}/ccx/oauth2/{tenant}`:
//   authorize → …/authorize    token → …/token

import { oauthBaseUrl } from './config.js';

// basicAuthHeader builds the `Authorization: Basic …` value Workday's token
// endpoint requires for client authentication. Server-side only (it encodes the
// secret). Pure — unit-tested. Uses Node's Buffer where available (the server and
// tests), falling back to btoa for completeness.
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  const b64 =
    typeof Buffer !== 'undefined' ? Buffer.from(raw, 'utf8').toString('base64') : btoa(raw);
  return `Basic ${b64}`;
}

// authorizeUrl is where the install flow sends the user's browser to grant the
// API Client. `state` is the CSRF token the server generates and re-checks on
// callback. `scope` is only appended when non-empty (a standard client is scoped
// by its registered functional areas in the tenant).
export function authorizeUrl(args: {
  host: string;
  tenant: string;
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
  state: string;
}): string {
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
  };
  if (args.scopes && args.scopes.length > 0) params.scope = args.scopes.join(' ');
  const q = new URLSearchParams(params);
  return `${oauthBaseUrl(args.host, args.tenant)}/authorize?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a test
// asserts the header + body without opening a socket. Workday's token endpoint
// takes application/x-www-form-urlencoded with Basic client auth.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// tokenUrl is the OAuth token endpoint for a tenant.
export function tokenUrl(host: string, tenant: string): string {
  return `${oauthBaseUrl(host, tenant)}/token`;
}

// tokenExchange builds the code→token request against the tenant's /token. The
// grant params (code + the SAME redirect_uri used on /authorize, which Workday
// requires to match) ride in the form body; the client credentials ride in the
// Basic Authorization header, so the secret never appears in the body.
export function tokenExchange(args: {
  host: string;
  tenant: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): PreparedRequest {
  return {
    url: tokenUrl(args.host, args.tenant),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(args.clientId, args.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
    }).toString(),
  };
}

// refreshExchange builds the refresh-token→token request. Workday access tokens
// are short-lived (~1h) and the refresh token is long-lived and non-rotating, so
// the response usually returns only a new access_token (see carryRefreshToken).
export function refreshExchange(args: {
  host: string;
  tenant: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): PreparedRequest {
  return {
    url: tokenUrl(args.host, args.tenant),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(args.clientId, args.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    }).toString(),
  };
}

// The token response we care about. Workday returns access_token (+ refresh_token
// on the initial exchange, expires_in, token_type). No created_at — the caller
// records the mint time. parseTokenResponse validates the one required field and
// surfaces Workday's own error otherwise.
export interface WorkdayTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export function parseTokenResponse(data: any): WorkdayTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.error_description || data.message || data.error;
    throw new Error(`Workday OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Workday OAuth response missing access_token');
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
  };
}

// carryRefreshToken keeps the prior refresh token when a refresh response omits
// one (Workday does not rotate it). Returns `next` unchanged when it already
// carries a refresh token. Pure — the ONE place refresh-token continuity lives.
export function carryRefreshToken(prev: WorkdayTokenSet, next: WorkdayTokenSet): WorkdayTokenSet {
  return next.refresh_token ? next : { ...next, refresh_token: prev.refresh_token };
}

// tokenExpiresAt computes the absolute epoch-seconds expiry from a token set and
// the epoch-seconds mint time, applying a safety skew so a request is never sent
// with a token about to expire mid-flight. Workday tokens carry no created_at, so
// the caller (server) supplies mintedAt. Pure.
export function tokenExpiresAt(token: WorkdayTokenSet, mintedAt: number, skewSeconds = 60): number {
  const ttl = typeof token.expires_in === 'number' ? token.expires_in : 0;
  return mintedAt + ttl - skewSeconds;
}

// isExpired reports whether a token set is at/past its (skew-adjusted) expiry as
// of `now`, given when it was minted. The server checks this before each API call
// and refreshes when true. Pure.
export function isExpired(
  token: WorkdayTokenSet,
  mintedAt: number,
  now: number,
  skewSeconds = 60,
): boolean {
  return now >= tokenExpiresAt(token, mintedAt, skewSeconds);
}
