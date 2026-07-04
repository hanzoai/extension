// iManage Work OAuth 2.0 (Authorization Code Grant) — pure request shaping. The
// client secret is held by the server (server.ts) and never reaches the browser;
// these functions build the exact URL/body of each OAuth call so the wire shape is
// unit-testable without a network round-trip. The token exchange and refresh are
// each one fetch in the server.
//
// iManage's OAuth2 endpoints live on the customer's Control Center host:
//   authorize: https://{host}/auth/oauth2/authorize
//   token:     https://{host}/auth/oauth2/token
// The token endpoint takes application/x-www-form-urlencoded with client_id +
// client_secret IN THE BODY (not HTTP Basic) — the standard OAuth2 web-server
// shape. See the iManage Control Center OAuth2 guide.

import { hosts } from './config.js';

// authorizeUrl is where the install flow sends the user's browser to grant the
// app. `state` is the CSRF token the server generates and re-checks on callback.
// iManage takes response_type=code + client_id + redirect_uri; scope is optional
// (governed by the app registration + the user's Work permissions), so it is only
// appended when non-empty.
export function authorizeUrl(args: {
  host: string;
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
  return `${hosts(args.host).auth}/auth/oauth2/authorize?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a test
// asserts the form body without opening a socket. iManage's token endpoint takes
// application/x-www-form-urlencoded.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// tokenUrl is the OAuth token endpoint for a host.
export function tokenUrl(host: string): string {
  return `${hosts(host).auth}/auth/oauth2/token`;
}

// tokenExchange builds the code→token request against the host's
// /auth/oauth2/token. grant_type=authorization_code with the code, the app's
// credentials, and the SAME redirect_uri that was used on /authorize (iManage
// requires it to match). The secret rides only in this server-side body.
export function tokenExchange(args: {
  host: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): PreparedRequest {
  return {
    url: tokenUrl(args.host),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
    }).toString(),
  };
}

// refreshExchange builds the refresh-token→token request. iManage access tokens
// are short-lived; the refresh may return a new refresh token, so the server
// stores whatever refresh_token comes back after every refresh (defensive against
// rotation).
export function refreshExchange(args: {
  host: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): PreparedRequest {
  return {
    url: tokenUrl(args.host),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }).toString(),
  };
}

// The token response we care about. iManage returns access_token (+ refresh_token,
// expires_in, token_type, scope). parseTokenResponse validates the one field we
// must have and surfaces iManage's own error otherwise.
export interface ImanageTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export function parseTokenResponse(data: any): ImanageTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.error_description || data.message || data.error;
    throw new Error(`iManage OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('iManage OAuth response missing access_token');
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
}

// tokenExpiresAt computes the absolute epoch-seconds expiry from a token set,
// applying a safety skew so a request is never sent with a token about to expire
// mid-flight. iManage does not return an issued-at, so the base is the wall-clock
// `now` at which the token was minted (the caller passes it). Pure — testable.
export function tokenExpiresAt(token: ImanageTokenSet, mintedAt: number, skewSeconds = 60): number {
  const ttl = typeof token.expires_in === 'number' ? token.expires_in : 0;
  return mintedAt + ttl - skewSeconds;
}

// isExpired reports whether a token minted at `mintedAt` is at/past its (skew-
// adjusted) expiry as of `now`. The server checks this before each API call and
// refreshes when true.
export function isExpired(
  token: ImanageTokenSet,
  mintedAt: number,
  now: number,
  skewSeconds = 60,
): boolean {
  return now >= tokenExpiresAt(token, mintedAt, skewSeconds);
}
