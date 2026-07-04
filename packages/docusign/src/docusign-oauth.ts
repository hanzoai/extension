// DocuSign OAuth (Confidential Authorization Code Grant) — pure request shaping.
// The secret key is held by the server (server.ts) and never reaches the
// browser; these functions build the exact URL/headers/body of each OAuth call
// so the wire shape is unit-testable without a network round-trip. The token
// exchange and userinfo GET are each one fetch in the server.
//
// DocuSign uses HTTP Basic auth (base64 integration_key:secret_key) on the token
// endpoint and form-encoded bodies — the OAuth2 confidential-client shape,
// documented at developers.docusign.com/platform/auth/confidential-authcode-get-token.
// The account server is account-d.docusign.com (demo) / account.docusign.com
// (prod); the per-account REST base_uri is discovered from /oauth/userinfo.

import { accountServer, ESIGN_API_VERSION, type DocusignEnv } from './config.js';

// authorizeUrl is where the install flow sends the user's browser to grant the
// app. `scope` is space-joined (the OAuth2 convention), `state` is the CSRF
// token the server generates and re-checks on callback.
export function authorizeUrl(args: {
  env: DocusignEnv;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    scope: args.scopes.join(' '),
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `${accountServer(args.env)}/oauth/auth?${q.toString()}`;
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

// tokenExchange builds the code→token request against the account server's
// /oauth/token. grant_type=authorization_code + the code; the redirect_uri is
// NOT part of DocuSign's token body (unlike some providers) — the code alone,
// bound to the app by the Basic credential, is exchanged.
export function tokenExchange(args: {
  env: DocusignEnv;
  clientId: string;
  clientSecret: string;
  code: string;
}): PreparedRequest {
  return {
    url: `${accountServer(args.env)}/oauth/token`,
    headers: {
      Authorization: basicAuth(args.clientId, args.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
    }).toString(),
  };
}

// refreshExchange builds the refresh-token→token request. Same account server,
// grant_type=refresh_token. A long-lived Connect deployment refreshes the
// server's stored token this way rather than re-consenting.
export function refreshExchange(args: {
  env: DocusignEnv;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): PreparedRequest {
  return {
    url: `${accountServer(args.env)}/oauth/token`,
    headers: {
      Authorization: basicAuth(args.clientId, args.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    }).toString(),
  };
}

// userInfoUrl is the account-server endpoint that returns the caller's accounts
// and — critically — each account's REST base_uri. We never hard-code a REST
// host; it is discovered here after login.
export function userInfoUrl(env: DocusignEnv): string {
  return `${accountServer(env)}/oauth/userinfo`;
}

// The token response we care about. DocuSign returns access_token (+
// refresh_token, expires_in, token_type). parseTokenResponse validates the one
// field we must have and surfaces DocuSign's own error otherwise.
export interface DocusignTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export function parseTokenResponse(data: any): DocusignTokenSet {
  if (!data || typeof data !== 'object') throw new Error('empty token response');
  if (data.error) {
    const reason = data.error_description || data.message || data.error;
    throw new Error(`DocuSign OAuth error: ${reason}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('DocuSign OAuth response missing access_token');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
  };
}

// One account entry from /oauth/userinfo. base_uri is the regional REST host
// (e.g. https://demo.docusign.net) WITHOUT the /restapi path — apiBaseUrl adds
// it. account_id is the GUID used in every eSignature REST path.
export interface DocusignAccount {
  accountId: string;
  accountName: string;
  baseUri: string;
  isDefault: boolean;
}

// The resolved caller identity: who they are plus their accounts.
export interface DocusignUserInfo {
  sub: string;
  name: string;
  email: string;
  accounts: DocusignAccount[];
}

// parseUserInfo reads /oauth/userinfo into a typed identity. DocuSign's field
// names are snake_case (account_id, base_uri, is_default); we normalize to
// camelCase at this boundary so nothing downstream touches the wire shape.
// Throws on a payload with no accounts (a signed-in user always has at least
// one) so the caller learns immediately rather than failing later on an empty
// base_uri.
export function parseUserInfo(data: any): DocusignUserInfo {
  if (!data || typeof data !== 'object') throw new Error('empty userinfo response');
  if (data.error) {
    throw new Error(`DocuSign userinfo error: ${data.error_description || data.error}`);
  }
  const rawAccounts = Array.isArray(data.accounts) ? data.accounts : [];
  const accounts: DocusignAccount[] = rawAccounts
    .map((a: any) => ({
      accountId: String(a?.account_id ?? ''),
      accountName: String(a?.account_name ?? ''),
      baseUri: String(a?.base_uri ?? '').replace(/\/+$/, ''),
      isDefault: a?.is_default === true || a?.is_default === 'true',
    }))
    .filter((a: DocusignAccount) => a.accountId.length > 0 && a.baseUri.length > 0);
  if (accounts.length === 0) {
    throw new Error('DocuSign userinfo returned no usable accounts');
  }
  return {
    sub: String(data.sub ?? ''),
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    accounts,
  };
}

// defaultAccount picks the account a request should run against: the one flagged
// is_default, else the first. Pure — the caller may override by accountId.
export function defaultAccount(info: DocusignUserInfo): DocusignAccount {
  return info.accounts.find((a) => a.isDefault) ?? info.accounts[0];
}

// apiBaseUrl turns an account's base_uri into the eSignature REST root for the
// current API version: `${base_uri}/restapi/v2.1`. Every DocuSign API call is
// built on top of this. Pure — the request wrappers in docusign-api.ts take
// this string.
export function apiBaseUrl(baseUri: string): string {
  return `${baseUri.replace(/\/+$/, '')}/restapi/${ESIGN_API_VERSION}`;
}
