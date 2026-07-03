import { describe, it, expect } from 'vitest';
import { base64url, randomString, challengeFromVerifier, createPkce, buildAuthorizeURL } from '../src/pkce';

describe('base64url', () => {
  it('is url-safe and unpadded', () => {
    const s = base64url(new Uint8Array([251, 255, 191, 0, 1, 2]));
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe('randomString', () => {
  it('is non-empty and unique per call', () => {
    const a = randomString();
    const b = randomString();
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });
});

describe('challengeFromVerifier', () => {
  it('matches the RFC 7636 S256 test vector', async () => {
    // Appendix B: verifier → BASE64URL(SHA256(verifier)) == known challenge.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('createPkce', () => {
  it('produces a verifier, its S256 challenge, and a state', async () => {
    const p = await createPkce();
    expect(p.verifier).toBeTruthy();
    expect(p.state).toBeTruthy();
    expect(await challengeFromVerifier(p.verifier)).toBe(p.challenge);
  });
});

describe('buildAuthorizeURL', () => {
  it('targets hanzo.id with PKCE S256 and the hanzo-office client', () => {
    const url = buildAuthorizeURL('https://office.hanzo.ai/auth-callback.html', 'CHAL', 'STATE');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://hanzo.id/v1/iam/oauth/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('hanzo-office');
    expect(u.searchParams.get('code_challenge')).toBe('CHAL');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('STATE');
    expect(u.searchParams.get('redirect_uri')).toBe('https://office.hanzo.ai/auth-callback.html');
  });
});
