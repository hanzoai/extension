// Canvas OAuth 2.0 (Authorization Code Grant) — pure request shaping. The client
// secret is held by the server (server.ts) and never reaches the browser; these
// functions build the exact URL/body of each OAuth call so the wire shape is
// unit-testable without a network round-trip. The token exchange and refresh are
// each one fetch in the server.
//
// Canvas uses form-encoded bodies with client_id + client_secret IN THE BODY (not
// HTTP Basic) and requires the redirect_uri on the code exchange — the standard
// OAuth2 web-server shape, documented at
// canvas.instructure.com/doc/api/file.oauth_endpoints.html. The login host is the
// institution's own Canvas host (see config.authBase): authorize at
// /login/oauth2/auth, token at /login/oauth2/token.

import { authBase } from './config.js';

// authorizeUrl is where the install flow sends the user's browser to grant the
// app. `state` is the CSRF token the server generates and re-checks on callback.
// Canvas's Authorization Code grant takes response_type=code + client_id +
// redirect_uri + state; scope is optional (only enforced when the Developer Key
// enables scope enforcement), so it is only appended when non-empty.
export function authorizeUrl(args: {
  host: string;
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
  state: string;
}): string {
  const params: Record<string, string> = {
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    state: args.state,
  };
  if (args.scopes && args.scopes.length > 0) params.scope = args.scopes.join(' ');
  const q = new URLSearchParams(params);
  return `${authBase(args.host)}/login/oauth2/auth?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a test
// asserts the form body without opening a socket. Canvas's token endpoint takes
// application/x-www-form-urlencoded.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// tokenUrl is the OAuth token endpoint for a host.
export function tokenUrl(host: string): string {
  return `${authBase(host)}/login/oauth2/token`;
}

// tokenExchange builds the code→token request against the host's
// /login/oauth2/token. grant_type=authorization_code with the code, the key's
// credentials, and the SAME redirect_uri that was used on /login/oauth2/auth
// (Canvas requires it to match). The secret rides only in this server-side body.
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
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
    }).toString(),
  };
}

// refreshExchange builds the refresh-token→token request. Canvas access tokens are
// short-lived (~1h); a refresh returns a fresh access_token but — unlike Procore —
// Canvas does NOT rotate the refresh token (it returns none), so the server keeps
// the original refresh token. No redirect_uri on refresh.
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
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
    }).toString(),
  };
}

// The Canvas person sub-object returned alongside a token (the authorizing user).
export interface CanvasUser {
  id: number;
  name: string;
}

// The token response we care about. Canvas returns access_token (+ token_type,
// user, expires_in, and refresh_token ONLY on the initial code exchange).
// parseTokenResponse validates the one field we must have and surfaces Canvas's
// own error otherwise.
export interface CanvasTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user?: CanvasUser;
}

export function parseTokenResponse(data: any): CanvasTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.error_description || data.message || data.error;
    throw new Error(`Canvas OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Canvas OAuth response missing access_token');
  }
  const user =
    data.user && typeof data.user === 'object'
      ? { id: Number(data.user.id ?? 0), name: String(data.user.name ?? '') }
      : undefined;
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    user,
  };
}

// carryRefreshToken applies Canvas's non-rotating refresh semantics: a refresh
// response omits the refresh token, so the new token set inherits the previous
// refresh token. Pure — the server calls this after every refresh so the session
// never loses the ability to refresh again.
export function carryRefreshToken(next: CanvasTokenSet, previous: CanvasTokenSet): CanvasTokenSet {
  return next.refresh_token ? next : { ...next, refresh_token: previous.refresh_token };
}

// tokenExpiresAt computes the absolute epoch-seconds expiry from a token set and
// the wall-clock second it was minted, applying a safety skew so a request is never
// sent with a token about to expire mid-flight. Canvas does not return a mint
// timestamp, so the caller supplies `mintedAt` (recorded when the token was
// stored). Pure.
export function tokenExpiresAt(token: CanvasTokenSet, mintedAt: number, skewSeconds = 60): number {
  const ttl = typeof token.expires_in === 'number' ? token.expires_in : 0;
  return mintedAt + ttl - skewSeconds;
}

// isExpired reports whether a token set is at/past its (skew-adjusted) expiry as of
// `now`, given when it was minted. The server checks this before each API call and
// refreshes when true. Pure.
export function isExpired(
  token: CanvasTokenSet,
  mintedAt: number,
  now: number,
  skewSeconds = 60,
): boolean {
  return now >= tokenExpiresAt(token, mintedAt, skewSeconds);
}
