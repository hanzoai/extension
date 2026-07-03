// The auth FLOW — written exactly once, against TokenStore + Opener. This is the
// decomplected heart: browser / office / vscode / cli call these functions with
// their own adapter and get identical login, refresh, and session semantics. No
// surface re-implements PKCE, endpoint assembly, code exchange, or refresh.

import { createPkce } from './pkce.js';
import {
  buildAuthorizeURL, exchangeCode, refreshTokens, fetchUserInfo, parseCallback,
  type UserInfo,
} from './oauth.js';
import type { TokenStore, TokenSet, Opener } from './types.js';

export interface AuthClient {
  clientId: string;
  redirectUri: string;
  scope?: string;
  loginIssuer?: string;
  apiIssuer?: string;
}

// EXPIRY_SKEW_MS refreshes a token slightly before it truly expires, so a call
// never races the deadline.
const EXPIRY_SKEW_MS = 60_000;

// login runs the full interactive authorization-code + PKCE flow and persists
// the tokens. Returns the TokenSet. Throws on user-cancel, state mismatch, an
// IAM error param, or a failed exchange — the surface shows the message.
export async function login(client: AuthClient, store: TokenStore, opener: Opener): Promise<TokenSet> {
  const pkce = await createPkce();
  const authorizeUrl = buildAuthorizeURL({
    clientId: client.clientId,
    redirectUri: client.redirectUri,
    challenge: pkce.challenge,
    state: pkce.state,
    scope: client.scope,
    loginIssuer: client.loginIssuer,
  });

  const redirectUrl = await opener.open(authorizeUrl, client.redirectUri);
  const cb = parseCallback(redirectUrl);
  if (cb.error) throw new Error(`sign-in failed: ${cb.error}`);
  if (!cb.code) throw new Error('sign-in returned no authorization code');
  if (cb.state !== pkce.state) throw new Error('sign-in state mismatch (possible CSRF) — try again');

  const tokens = await exchangeCode({
    clientId: client.clientId,
    code: cb.code,
    verifier: pkce.verifier,
    redirectUri: client.redirectUri,
    apiIssuer: client.apiIssuer,
  });
  await store.set(tokens);
  return tokens;
}

// isExpired reports whether a TokenSet is at/near its deadline. A token with no
// expiresAt is treated as non-expiring (the surface still validates server-side
// on 401). Pure.
export function isExpired(tokens: TokenSet | null, now: number = Date.now()): boolean {
  if (!tokens) return true;
  if (tokens.expiresAt === undefined) return false;
  return now >= tokens.expiresAt - EXPIRY_SKEW_MS;
}

// getValidToken returns a usable access token, transparently refreshing an
// expired one when a refresh_token is present. Returns '' when there is no
// session (never signed in) or the refresh failed — the caller then either runs
// login() or proceeds anonymously. This is the ONE function every surface calls
// before an authenticated request.
export async function getValidToken(client: AuthClient, store: TokenStore): Promise<string> {
  const current = await store.get();
  if (!current) return '';
  if (!isExpired(current)) return current.accessToken;
  if (!current.refreshToken) return current.accessToken; // no refresh path; let the server 401
  try {
    const next = await refreshTokens({
      clientId: client.clientId,
      refreshToken: current.refreshToken,
      apiIssuer: client.apiIssuer,
    });
    await store.set(next);
    return next.accessToken;
  } catch {
    return ''; // refresh failed (revoked/expired) — surface re-prompts login
  }
}

// logout clears the stored session.
export async function logout(store: TokenStore): Promise<void> {
  await store.clear();
}

// currentUser returns the signed-in identity for onboarding UIs, or null when
// there is no valid session. Refreshes if needed.
export async function currentUser(client: AuthClient, store: TokenStore): Promise<UserInfo | null> {
  const token = await getValidToken(client, store);
  if (!token) return null;
  try {
    return await fetchUserInfo(token, client.apiIssuer);
  } catch {
    return null;
  }
}
