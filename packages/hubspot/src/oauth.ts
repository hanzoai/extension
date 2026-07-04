// HubSpot OAuth 2.0 (Authorization Code Grant) — pure request shaping. The
// client_secret is held by the app's backend and never reaches the card's React
// frontend; these functions build the exact URL / headers / body of each OAuth
// call so the wire shape is unit-testable without a network round-trip. The
// token exchange and refresh are each one fetch in the OAuth handler.
//
// HubSpot puts client_id, client_secret, redirect_uri, and code all in the
// form-encoded body of the token endpoint (POST /oauth/v1/token) — the plain
// OAuth2 body shape, NOT HTTP Basic. Docs:
// developers.hubspot.com/docs/guides/apps/authentication/working-with-oauth.

import { hubspotAuthorizeURL, hubspotTokenURL } from './config.js';

// authorizeUrl is where the install flow sends the user's browser to grant the
// app. `scope` is space-joined (the OAuth2 convention), `state` is the CSRF
// token the backend generates and re-checks on callback. `optionalScope`, when
// present, lets the user grant extra scopes without them being required.
export function authorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  optionalScopes?: readonly string[];
}): string {
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: args.scopes.join(' '),
    state: args.state,
  });
  if (args.optionalScopes && args.optionalScopes.length > 0) {
    q.set('optional_scope', args.optionalScopes.join(' '));
  }
  return `${hubspotAuthorizeURL()}?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a
// test asserts the form body + content type without opening a socket. The secret
// rides in the body per HubSpot's OAuth2 shape, never in the URL.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' } as const;

// tokenExchange builds the code→token request against /oauth/v1/token.
// grant_type=authorization_code + the code + the SAME redirect_uri used in the
// authorize step (HubSpot requires the match) + the client credentials.
export function tokenExchange(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): PreparedRequest {
  return {
    url: hubspotTokenURL(),
    headers: { ...FORM_HEADERS },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
    }).toString(),
  };
}

// refreshExchange builds the refresh-token→token request. Same endpoint,
// grant_type=refresh_token. A long-lived install refreshes the portal's stored
// token this way rather than re-consenting; redirect_uri is NOT part of a
// refresh body (only the initial exchange needs it).
export function refreshExchange(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): PreparedRequest {
  return {
    url: hubspotTokenURL(),
    headers: { ...FORM_HEADERS },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
    }).toString(),
  };
}

// The token response we care about. HubSpot returns access_token (+
// refresh_token, expires_in, token_type). parseTokenResponse validates the one
// field we must have and surfaces HubSpot's own error otherwise.
export interface HubspotTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

// parseTokenResponse reads a /oauth/v1/token body into a typed token set. Throws
// on an error payload (HubSpot returns { status: 'error', message }) or a
// missing access_token, so the caller learns immediately rather than storing an
// empty credential. Pure — unit-tested.
export function parseTokenResponse(data: unknown): HubspotTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  const d = data as {
    status?: string;
    message?: string;
    error?: string;
    error_description?: string;
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    token_type?: unknown;
  };
  if (d.status === 'error' || d.error) {
    const reason = d.message || d.error_description || d.error || 'unknown error';
    throw new Error(`HubSpot OAuth error: ${reason}`);
  }
  if (typeof d.access_token !== 'string' || d.access_token.length === 0) {
    throw new Error('HubSpot OAuth response missing access_token');
  }
  return {
    access_token: d.access_token,
    refresh_token: typeof d.refresh_token === 'string' ? d.refresh_token : undefined,
    expires_in: typeof d.expires_in === 'number' ? d.expires_in : undefined,
    token_type: typeof d.token_type === 'string' ? d.token_type : undefined,
  };
}
