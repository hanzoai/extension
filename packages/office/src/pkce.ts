// PKCE (RFC 7636) + the IAM authorize URL — pure crypto, no Office, no DOM, so
// it is unit-tested directly. The add-in runs the authorization-code+PKCE flow
// against hanzo.id (HIP-0111) through the Office Dialog API; auth.ts is the thin
// dialog glue over these functions.

import { iamAuthorizeURL, CLIENT_ID, OAUTH_SCOPES } from './config.js';

// base64url encodes bytes without padding (the PKCE + OAuth-state alphabet).
export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// randomString returns a base64url token of `bytes` entropy (verifier/state),
// using the platform CSPRNG (browser webcrypto or node webcrypto).
export function randomString(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  (globalThis.crypto as Crypto).getRandomValues(buf);
  return base64url(buf);
}

// challengeFromVerifier is the S256 code_challenge = BASE64URL(SHA256(verifier)).
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await (globalThis.crypto as Crypto).subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkce(): Promise<PkcePair> {
  const verifier = randomString(32);
  const challenge = await challengeFromVerifier(verifier);
  const state = randomString(16);
  return { verifier, challenge, state };
}

// buildAuthorizeURL assembles the hanzo.id authorize URL for the dialog to
// open. redirectUri is the add-in's dialog callback (same host as the task
// pane), which must be registered on the hanzo-office IAM client.
export function buildAuthorizeURL(redirectUri: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${iamAuthorizeURL()}?${q.toString()}`;
}
