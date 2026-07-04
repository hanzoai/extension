// Zoom OAuth (authorization-code) — pure request shaping. The client_secret is
// held by the server (server.ts) and never reaches the browser; these functions
// build the exact URL/headers/body of each OAuth call so the wire shape is
// unit-testable without a network round-trip. Token exchange itself is one
// fetch in the server.
//
// Zoom uses HTTP Basic auth (base64 client_id:client_secret) on the token
// endpoint and form-encoded bodies — the OAuth2 standard shape, documented at
// developers.zoom.us/docs/integrations/oauth.

import { ZOOM_OAUTH_AUTHORIZE_URL, ZOOM_OAUTH_TOKEN_URL } from '../config.js';

// authorizeUrl is where the install flow sends the admin's browser to grant the
// app. `state` is the CSRF token the server generates and re-checks on callback.
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${ZOOM_OAUTH_AUTHORIZE_URL}?${q.toString()}`;
}

// A prepared HTTP request: the pieces a single fetch needs. Pure output so a
// test asserts the Basic header + form body without opening a socket.
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

// tokenExchange builds the code→token request. The secret rides in the Basic
// header, never the body or the URL.
export function tokenExchange(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): PreparedRequest {
  return {
    url: ZOOM_OAUTH_TOKEN_URL,
    headers: {
      Authorization: basicAuth(args.clientId, args.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
    }).toString(),
  };
}

// The token response we care about. Zoom returns access_token (+ refresh_token,
// expires_in, scope); parseTokenResponse validates the one field we must have.
export interface ZoomTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

// parseTokenResponse validates a Zoom token payload — throws with Zoom's own
// error message on a failure body (so the server surfaces the real reason)
// rather than silently returning a token-less object.
export function parseTokenResponse(data: any): ZoomTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.reason || data.error_description || data.error;
    throw new Error(`Zoom OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Zoom OAuth response missing access_token');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  };
}
