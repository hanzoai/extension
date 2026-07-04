// Intuit OAuth2 (Authorization Code Grant) — pure request shaping. The client
// secret is held by the server (server.ts) and never reaches the browser; these
// functions build the exact URL/headers/body of each OAuth call so the wire
// shape is unit-testable without a network round-trip. The token exchange and
// refresh are each one fetch in the server.
//
// Intuit uses HTTP Basic auth (base64 client_id:client_secret) on the token
// endpoint and form-encoded bodies — the OAuth2 confidential-client shape,
// documented at developer.intuit.com/app/developer/qbo/docs/develop/
// authentication-and-authorization/oauth-2.0. The authorization and token hosts
// are the SAME for sandbox and production; only the Accounting API host differs
// (config.qboApiHost). The company id — Intuit's `realmId` — arrives as a query
// param on the OAuth callback (NOT from a userinfo call) and scopes every API
// path.

import {
  INTUIT_AUTHORIZE_URL,
  INTUIT_TOKEN_URL,
  INTUIT_REVOKE_URL,
} from './config.js';

// authorizeUrl is where the install flow sends the user's browser to grant the
// app. `scope` is space-joined (the OAuth2 convention), `state` is the CSRF
// token the server generates and re-checks on callback. Intuit appends `realmId`
// (and `code`, `state`) to the redirect on approval.
export function authorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    scope: args.scopes.join(' '),
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `${INTUIT_AUTHORIZE_URL}?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a
// test asserts the Basic header + form body without opening a socket.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// basicAuth builds the Authorization header value for the token endpoint. The
// secret rides only here, never in the body or the URL.
export function basicAuth(clientId: string, clientSecret: string): string {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

// tokenExchange builds the code→token request against Intuit's token endpoint.
// grant_type=authorization_code + the code + the redirect_uri (Intuit REQUIRES
// redirect_uri in the body and matches it against the registered value — unlike
// DocuSign, which omits it). Intuit wants Accept: application/json.
export function tokenExchange(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): PreparedRequest {
  return {
    url: INTUIT_TOKEN_URL,
    headers: {
      Authorization: basicAuth(args.clientId, args.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
    }).toString(),
  };
}

// refreshExchange builds the refresh-token→token request. Same token endpoint,
// grant_type=refresh_token. QBO access tokens live ~1 hour; a long-running
// deployment refreshes the stored token this way rather than re-consenting. The
// refresh token itself rotates ~every 24h and lives ~100 days.
export function refreshExchange(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): PreparedRequest {
  return {
    url: INTUIT_TOKEN_URL,
    headers: {
      Authorization: basicAuth(args.clientId, args.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    }).toString(),
  };
}

// revokeExchange builds the disconnect request. Intuit revokes either the access
// or the refresh token (revoking the refresh token disconnects the app). Basic
// auth, JSON body, application/json.
export function revokeExchange(args: {
  clientId: string;
  clientSecret: string;
  token: string;
}): PreparedRequest {
  return {
    url: INTUIT_REVOKE_URL,
    headers: {
      Authorization: basicAuth(args.clientId, args.clientSecret),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: args.token }),
  };
}

// The token response we care about. Intuit returns access_token (+
// refresh_token, expires_in, x_refresh_token_expires_in, token_type, and — when
// openid is requested — id_token). parseTokenResponse validates the fields we
// must have and surfaces Intuit's own error otherwise.
export interface QboTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType?: string;
  idToken?: string;
}

export function parseTokenResponse(data: any): QboTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.error_description || data.message || data.error;
    throw new Error(`Intuit OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Intuit OAuth response missing access_token');
  }
  if (typeof data.refresh_token !== 'string' || data.refresh_token.length === 0) {
    throw new Error('Intuit OAuth response missing refresh_token');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    refreshExpiresIn:
      typeof data.x_refresh_token_expires_in === 'number' ? data.x_refresh_token_expires_in : undefined,
    tokenType: typeof data.token_type === 'string' ? data.token_type : undefined,
    idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
  };
}

// parseCallback reads the OAuth redirect's query params into the two values the
// server needs: the authorization `code` and the `realmId` (company id). `state`
// is validated by the caller against the value it minted. Throws on Intuit's
// error redirect (?error=access_denied) or a missing code/realmId so the caller
// learns immediately. Pure over a URLSearchParams-like map.
export interface QboCallback {
  code: string;
  realmId: string;
  state: string;
}

export function parseCallback(params: URLSearchParams): QboCallback {
  const error = params.get('error');
  if (error) {
    throw new Error(`Intuit OAuth error: ${params.get('error_description') || error}`);
  }
  const code = params.get('code') || '';
  const realmId = params.get('realmId') || '';
  const state = params.get('state') || '';
  if (!code) throw new Error('OAuth callback missing code');
  if (!realmId) throw new Error('OAuth callback missing realmId (company id)');
  return { code, realmId, state };
}
