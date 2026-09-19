// PKCE (RFC 7636) — pure crypto over the platform CSPRNG + WebCrypto, so it runs
// identically in a browser extension, an Office task pane, VS Code's extension
// host, and Node. The ONE PKCE implementation for every Hanzo surface.

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  (globalThis.crypto as Crypto).getRandomValues(buf);
  return base64url(buf);
}

// challengeFromVerifier = BASE64URL(SHA256(verifier)) — the S256 method.
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await (globalThis.crypto as Crypto).subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkce(): Promise<Pkce> {
  const verifier = randomString(32);
  const challenge = await challengeFromVerifier(verifier);
  const state = randomString(16);
  return { verifier, challenge, state };
}
