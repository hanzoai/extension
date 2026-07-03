// The OAuth2/OIDC HTTP calls — pure functions over `fetch`. No storage, no UI,
// no runtime specifics. Every authorize URL and token exchange in the Hanzo
// extension family is built HERE, against config.ts, so HIP-0111 paths are
// assembled exactly once.

import { authorizeURL, tokenURL, userinfoURL, DEFAULT_SCOPES, IAM_LOGIN_URL, IAM_API_URL } from './config.js';
import type { TokenSet } from './types.js';

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope?: string;
  loginIssuer?: string;
}

// buildAuthorizeURL assembles the authorization-code + PKCE (S256) URL.
export function buildAuthorizeURL(p: AuthorizeParams): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope || DEFAULT_SCOPES,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `${authorizeURL(p.loginIssuer || IAM_LOGIN_URL)}?${q.toString()}`;
}

// normalizeTokens converts an OIDC token response into our TokenSet, turning the
// relative expires_in into an absolute expiresAt deadline (now-based).
export function normalizeTokens(raw: any, now: number = Date.now()): TokenSet {
  if (!raw || typeof raw.access_token !== 'string' || !raw.access_token) {
    throw new Error('token response missing access_token');
  }
  const set: TokenSet = { accessToken: raw.access_token };
  if (raw.refresh_token) set.refreshToken = raw.refresh_token;
  if (raw.id_token) set.idToken = raw.id_token;
  if (raw.token_type) set.tokenType = raw.token_type;
  if (raw.scope) set.scope = raw.scope;
  if (typeof raw.expires_in === 'number') set.expiresAt = now + raw.expires_in * 1000;
  return set;
}

// exchangeCode trades an authorization code for tokens (RFC 6749 §4.1.3 +
// PKCE). Form-encoded per the spec — application/json is NOT accepted by IAM.
export async function exchangeCode(args: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  apiIssuer?: string;
}): Promise<TokenSet> {
  const resp = await fetch(tokenURL(args.apiIssuer || IAM_API_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: args.clientId,
      code: args.code,
      code_verifier: args.verifier,
      redirect_uri: args.redirectUri,
    }),
  });
  if (!resp.ok) {
    throw new Error(`token exchange failed: ${resp.status} ${await safeText(resp)}`);
  }
  return normalizeTokens(await resp.json());
}

// refreshTokens uses a refresh_token to mint a fresh access token. IAM may or
// may not rotate the refresh_token; if it omits one we keep the old.
export async function refreshTokens(args: {
  clientId: string;
  refreshToken: string;
  apiIssuer?: string;
}): Promise<TokenSet> {
  const resp = await fetch(tokenURL(args.apiIssuer || IAM_API_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: args.clientId,
      refresh_token: args.refreshToken,
    }),
  });
  if (!resp.ok) {
    throw new Error(`refresh failed: ${resp.status} ${await safeText(resp)}`);
  }
  const set = normalizeTokens(await resp.json());
  if (!set.refreshToken) set.refreshToken = args.refreshToken; // reuse when not rotated
  return set;
}

// UserInfo is the OIDC userinfo shape the surfaces render for onboarding.
export interface UserInfo {
  sub: string;
  name?: string;
  email?: string;
  org?: string;
  picture?: string;
}

export async function fetchUserInfo(accessToken: string, apiIssuer?: string): Promise<UserInfo> {
  const resp = await fetch(userinfoURL(apiIssuer || IAM_API_URL), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`userinfo failed: ${resp.status}`);
  const j = await resp.json();
  return { sub: j.sub, name: j.name, email: j.email, org: j.org || j.owner, picture: j.picture };
}

// parseCallback extracts { code, state, error } from the redirect URL IAM lands
// on (the Opener resolves this). Pure.
export function parseCallback(redirectUrl: string): { code?: string; state?: string; error?: string } {
  const qi = redirectUrl.indexOf('?');
  const params = new URLSearchParams(qi >= 0 ? redirectUrl.slice(qi + 1) : '');
  return {
    code: params.get('code') || undefined,
    state: params.get('state') || undefined,
    error: params.get('error') || undefined,
  };
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 200);
  } catch {
    return '';
  }
}
