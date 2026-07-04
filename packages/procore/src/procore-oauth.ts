// Procore OAuth 2.0 (Authorization Code Grant) — pure request shaping. The client
// secret is held by the server (server.ts) and never reaches the browser; these
// functions build the exact URL/body of each OAuth call so the wire shape is
// unit-testable without a network round-trip. The token exchange and refresh are
// each one fetch in the server.
//
// Procore uses form-encoded bodies with client_id + client_secret IN THE BODY
// (not HTTP Basic) and requires the redirect_uri on the code exchange — the
// standard OAuth2 web-server shape, documented at
// developers.procore.com/documentation/oauth-auth-grant-flow. The login host is
// login.procore.com (production) / login-sandbox.procore.com (sandbox).

import { hosts, type ProcoreEnv } from './config.js';

// authorizeUrl is where the install flow sends the user's browser to grant the
// app. `state` is the CSRF token the server generates and re-checks on callback.
// Procore's standard data-connection grant takes response_type=code + client_id
// + redirect_uri; scope is optional (permissions are per-company/tool), so it is
// only appended when non-empty.
export function authorizeUrl(args: {
  env: ProcoreEnv;
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
  return `${hosts(args.env).login}/oauth/authorize?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a
// test asserts the form body without opening a socket. Procore's token endpoint
// takes application/x-www-form-urlencoded.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// tokenUrl is the OAuth token endpoint for an environment.
export function tokenUrl(env: ProcoreEnv): string {
  return `${hosts(env).login}/oauth/token`;
}

// tokenExchange builds the code→token request against the login host's
// /oauth/token. grant_type=authorization_code with the code, the app's
// credentials, and the SAME redirect_uri that was used on /oauth/authorize
// (Procore requires it to match). The secret rides only in this server-side body.
export function tokenExchange(args: {
  env: ProcoreEnv;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): PreparedRequest {
  return {
    url: tokenUrl(args.env),
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

// refreshExchange builds the refresh-token→token request. Procore access tokens
// are short-lived (~2h) and each refresh returns a NEW refresh token (rotation),
// so the server must store the returned refresh_token after every refresh.
export function refreshExchange(args: {
  env: ProcoreEnv;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): PreparedRequest {
  return {
    url: tokenUrl(args.env),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }).toString(),
  };
}

// The token response we care about. Procore returns access_token (+
// refresh_token, expires_in, created_at, token_type). parseTokenResponse
// validates the one field we must have and surfaces Procore's own error otherwise.
export interface ProcoreTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  created_at?: number;
  token_type?: string;
}

export function parseTokenResponse(data: any): ProcoreTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.error_description || data.message || data.error;
    throw new Error(`Procore OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Procore OAuth response missing access_token');
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    created_at: typeof data.created_at === 'number' ? data.created_at : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
  };
}

// tokenExpiresAt computes the absolute epoch-seconds expiry from a token set,
// applying a safety skew so a request is never sent with a token about to expire
// mid-flight. created_at + expires_in is Procore's own clock; when created_at is
// absent we fall back to `now`. Pure — the caller passes `now` for testability.
export function tokenExpiresAt(token: ProcoreTokenSet, now: number, skewSeconds = 60): number {
  const base = typeof token.created_at === 'number' ? token.created_at : now;
  const ttl = typeof token.expires_in === 'number' ? token.expires_in : 0;
  return base + ttl - skewSeconds;
}

// isExpired reports whether a token set is at/past its (skew-adjusted) expiry as
// of `now`. The server checks this before each API call and refreshes when true.
export function isExpired(token: ProcoreTokenSet, now: number, skewSeconds = 60): boolean {
  return now >= tokenExpiresAt(token, now, skewSeconds);
}
