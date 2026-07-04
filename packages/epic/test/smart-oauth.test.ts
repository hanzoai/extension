import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  parseSmartConfiguration,
  base64urlEncode,
  randomVerifier,
  challengeFromVerifier,
  createPkce,
  authorizeUrl,
  tokenExchange,
  tokenRefresh,
  parseTokenResponse,
  isExpired,
  parseLaunch,
  parseCallback,
} from '../src/smart-oauth.js';

// A deterministic SHA-256 that matches the browser subtle.digest contract, so
// the PKCE challenge is verifiable in a plain node test.
const nodeSha256 = async (input: string): Promise<Uint8Array> =>
  new Uint8Array(createHash('sha256').update(input, 'utf8').digest());

describe('smart discovery', () => {
  it('extracts authorize + token endpoints', () => {
    const cfg = parseSmartConfiguration({
      authorization_endpoint: 'https://ehr/auth',
      token_endpoint: 'https://ehr/token',
      capabilities: ['launch-ehr', 'client-confidential-symmetric'],
      scopes_supported: ['openid', 'patient/Patient.read'],
    });
    expect(cfg.authorizationEndpoint).toBe('https://ehr/auth');
    expect(cfg.tokenEndpoint).toBe('https://ehr/token');
    expect(cfg.capabilities).toContain('launch-ehr');
    expect(cfg.scopesSupported).toContain('patient/Patient.read');
  });

  it('throws when the authorize endpoint is missing', () => {
    expect(() => parseSmartConfiguration({ token_endpoint: 'https://ehr/token' })).toThrow(
      /authorization_endpoint/,
    );
  });
  it('throws when the token endpoint is missing', () => {
    expect(() => parseSmartConfiguration({ authorization_endpoint: 'https://ehr/auth' })).toThrow(
      /token_endpoint/,
    );
  });
});

describe('PKCE', () => {
  it('base64url has no +/= characters', () => {
    const enc = base64urlEncode(new Uint8Array([251, 255, 191, 0, 62, 63]));
    expect(enc).not.toMatch(/[+/=]/);
  });

  it('randomVerifier uses the injected randomness and is base64url', () => {
    const bytes = new Uint8Array(32).fill(7);
    const v = randomVerifier(() => bytes);
    expect(v).toBe(base64urlEncode(bytes));
    expect(v).not.toMatch(/[+/=]/);
    // 32 bytes → 43 base64url chars (within the RFC 7636 43..128 range).
    expect(v.length).toBe(43);
  });

  it('challenge = base64url(sha256(verifier)) — S256', async () => {
    const verifier = 'test-verifier-value';
    const challenge = await challengeFromVerifier(verifier, nodeSha256);
    const expected = base64urlEncode(await nodeSha256(verifier));
    expect(challenge).toBe(expected);
    // Cross-check against the RFC 7636 canonical construction.
    const rfc = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(rfc);
  });

  it('createPkce returns a verifier + matching S256 challenge', async () => {
    const bytes = new Uint8Array(32).fill(9);
    const pkce = await createPkce(() => bytes, nodeSha256);
    expect(pkce.method).toBe('S256');
    expect(pkce.verifier).toBe(base64urlEncode(bytes));
    expect(pkce.challenge).toBe(await challengeFromVerifier(pkce.verifier, nodeSha256));
  });
});

describe('authorize URL', () => {
  const base = {
    authorizationEndpoint: 'https://ehr/auth',
    clientId: 'my-client',
    redirectUri: 'https://epic.hanzo.ai/oauth/callback',
    aud: 'https://fhir/r4',
    scope: 'launch openid patient/Patient.read',
    state: 'st-123',
    codeChallenge: 'chal-abc',
  };

  it('carries response_type, PKCE, aud and scope', () => {
    const u = new URL(authorizeUrl(base));
    expect(u.origin + u.pathname).toBe('https://ehr/auth');
    const p = u.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('my-client');
    expect(p.get('redirect_uri')).toBe('https://epic.hanzo.ai/oauth/callback');
    expect(p.get('aud')).toBe('https://fhir/r4');
    expect(p.get('scope')).toBe('launch openid patient/Patient.read');
    expect(p.get('state')).toBe('st-123');
    expect(p.get('code_challenge')).toBe('chal-abc');
    expect(p.get('code_challenge_method')).toBe('S256');
  });

  it('includes launch for an EHR launch and omits it standalone', () => {
    expect(new URL(authorizeUrl({ ...base, launch: 'lt-9' })).searchParams.get('launch')).toBe('lt-9');
    expect(new URL(authorizeUrl(base)).searchParams.has('launch')).toBe(false);
  });
});

describe('token exchange shaping', () => {
  it('shapes a confidential auth-code exchange with PKCE verifier + secret', () => {
    const req = tokenExchange({
      tokenEndpoint: 'https://ehr/token',
      clientId: 'my-client',
      redirectUri: 'https://epic.hanzo.ai/oauth/callback',
      code: 'auth-code',
      codeVerifier: 'the-verifier',
      clientSecret: 'shh',
    });
    expect(req.url).toBe('https://ehr/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('redirect_uri')).toBe('https://epic.hanzo.ai/oauth/callback');
    expect(body.get('client_id')).toBe('my-client');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('client_secret')).toBe('shh');
  });

  it('omits client_secret for a public (PKCE-only) app', () => {
    const req = tokenExchange({
      tokenEndpoint: 'https://ehr/token',
      clientId: 'pub',
      redirectUri: 'https://x/cb',
      code: 'c',
      codeVerifier: 'v',
    });
    expect(new URLSearchParams(req.body).has('client_secret')).toBe(false);
    // PKCE verifier is ALWAYS present — a public app depends on it.
    expect(new URLSearchParams(req.body).get('code_verifier')).toBe('v');
  });

  it('shapes a refresh with the stored refresh_token', () => {
    const req = tokenRefresh({
      tokenEndpoint: 'https://ehr/token',
      clientId: 'my-client',
      refreshToken: 'rt-1',
      clientSecret: 'shh',
    });
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('client_id')).toBe('my-client');
    expect(body.get('client_secret')).toBe('shh');
  });
});

describe('token response → SMART context', () => {
  it('parses tokens + patient context and computes absolute expiry', () => {
    const now = 1_000_000;
    const ctx = parseTokenResponse(
      {
        access_token: 'AT',
        refresh_token: 'RT',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'launch patient/Patient.read',
        patient: 'Patient-42',
        encounter: 'Enc-7',
        id_token: 'IDT',
      },
      now,
    );
    expect(ctx.accessToken).toBe('AT');
    expect(ctx.refreshToken).toBe('RT');
    expect(ctx.tokenType).toBe('Bearer');
    expect(ctx.expiresAt).toBe(now + 3600 * 1000);
    expect(ctx.patient).toBe('Patient-42');
    expect(ctx.encounter).toBe('Enc-7');
    expect(ctx.scope).toBe('launch patient/Patient.read');
    expect(ctx.idToken).toBe('IDT');
  });

  it('defaults missing optionals to empty strings', () => {
    const ctx = parseTokenResponse({ access_token: 'AT', expires_in: 300 }, 0);
    expect(ctx.refreshToken).toBe('');
    expect(ctx.patient).toBe('');
    expect(ctx.encounter).toBe('');
    expect(ctx.tokenType).toBe('Bearer');
  });

  it('throws on an OAuth error payload with the real reason', () => {
    expect(() =>
      parseTokenResponse({ error: 'invalid_grant', error_description: 'code expired' }),
    ).toThrow(/code expired/);
  });

  it('throws when there is no access_token', () => {
    expect(() => parseTokenResponse({ token_type: 'Bearer' })).toThrow(/no access_token/);
  });
});

describe('isExpired', () => {
  it('is true at/after expiry (minus skew) and false before', () => {
    expect(isExpired({ expiresAt: 100_000 }, 0, 60_000)).toBe(false); // well before
    expect(isExpired({ expiresAt: 100_000 }, 50_000, 60_000)).toBe(true); // within skew window
    expect(isExpired({ expiresAt: 100_000 }, 100_001, 60_000)).toBe(true); // past expiry
    expect(isExpired({ expiresAt: 100_000 }, 39_999, 60_000)).toBe(false); // just before the skew window
  });
});

describe('launch + callback parsing', () => {
  it('parses an EHR launch (iss + launch)', () => {
    const l = parseLaunch('?iss=https%3A%2F%2Ffhir%2Fr4&launch=xyz');
    expect(l.iss).toBe('https://fhir/r4');
    expect(l.launch).toBe('xyz');
  });
  it('tolerates a cold open (no params)', () => {
    const l = parseLaunch('');
    expect(l.iss).toBe('');
    expect(l.launch).toBe('');
  });
  it('parses a success callback', () => {
    const c = parseCallback('?code=abc&state=st');
    expect(c.code).toBe('abc');
    expect(c.state).toBe('st');
    expect(c.error).toBe('');
  });
  it('parses a declined callback with a reason', () => {
    const c = parseCallback('?error=access_denied&error_description=user%20declined');
    expect(c.error).toBe('access_denied');
    expect(c.errorDescription).toBe('user declined');
    expect(c.code).toBe('');
  });
});

// Guard: the module must not accidentally depend on hmac/secret material for
// PKCE (a common wrong turn). PKCE is a plain hash — this asserts the intent.
describe('PKCE is a plain SHA-256, not an HMAC', () => {
  it('challenge does not match an HMAC construction', async () => {
    const verifier = 'v';
    const challenge = await challengeFromVerifier(verifier, nodeSha256);
    const hmac = createHmac('sha256', 'anykey').update(verifier).digest('base64url');
    expect(challenge).not.toBe(hmac);
  });
});
