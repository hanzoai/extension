// SMART-on-FHIR launch: discovery, PKCE, the authorize URL, the code→token
// exchange/refresh shaping, and pulling the patient context out of the token
// response. PURE request-shaping only — this module never does a network call
// and never sources the client_secret (server.ts holds it, from the
// environment), so it is trivially unit-testable and free of secrets.
//
// SMART App Launch (http://hl7.org/fhir/smart-app-launch): the app is launched
// EITHER by the EHR (Epic) with `iss` (the FHIR base) + `launch` (an opaque
// launch token carrying the patient/encounter context) in the URL, OR
// standalone (the app supplies its own `iss` and asks the user to pick a
// patient via the `launch/patient` scope). Both paths then:
//   1. discover authorize/token endpoints from `<iss>/.well-known/smart-configuration`
//   2. redirect the browser to `authorize` with auth-code + PKCE (+ the `launch`
//      token and `aud=<iss>` — Epic REQUIRES `aud`)
//   3. exchange the returned `code` for tokens, which for a patient-context
//      launch carry a `patient` id (the launched patient) alongside the tokens.
// Confidential apps (server-side secret) also send client_secret at step 3;
// public apps rely on PKCE alone. This module shapes 1–3; server.ts runs them.

// ── SMART discovery ────────────────────────────────────────────────────────

// The subset of `.well-known/smart-configuration` this app needs: the two OAuth
// endpoints and (informational) the capabilities/scopes the server advertises.
// Epic publishes the full document; we read only what we use.
export interface SmartConfiguration {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  // Optional, informational: what the server says it supports.
  capabilities?: string[];
  scopesSupported?: string[];
}

// parseSmartConfiguration validates the discovery document and extracts the two
// endpoints. Throws when either endpoint is missing — a SMART app that cannot
// find the authorize/token URLs must fail loudly, not guess Epic-specific paths.
// Pure — the fetch is server.ts's job. Boundary guard on an external response.
export function parseSmartConfiguration(data: unknown): SmartConfiguration {
  const d = data as {
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
    capabilities?: unknown;
    scopes_supported?: unknown;
  };
  const authorizationEndpoint = d?.authorization_endpoint;
  const tokenEndpoint = d?.token_endpoint;
  if (typeof authorizationEndpoint !== 'string' || !authorizationEndpoint) {
    throw new Error('SMART discovery: no authorization_endpoint');
  }
  if (typeof tokenEndpoint !== 'string' || !tokenEndpoint) {
    throw new Error('SMART discovery: no token_endpoint');
  }
  return {
    authorizationEndpoint,
    tokenEndpoint,
    capabilities: Array.isArray(d?.capabilities)
      ? (d.capabilities.filter((c) => typeof c === 'string') as string[])
      : undefined,
    scopesSupported: Array.isArray(d?.scopes_supported)
      ? (d.scopes_supported.filter((s) => typeof s === 'string') as string[])
      : undefined,
  };
}

// ── PKCE ───────────────────────────────────────────────────────────────────
//
// PKCE (RFC 7636) protects the auth-code exchange: the app sends a random
// `code_verifier`'s SHA-256 hash (`code_challenge`) at authorize time, then the
// raw verifier at token time — an intercepted code is useless without it. Epic
// requires PKCE (S256) for public apps and supports it for confidential ones.

// base64url encodes bytes without padding, per RFC 7636. Pure.
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa in the browser; Buffer in node — both reachable here, prefer btoa.
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A PKCE pair: the secret verifier (kept by the app across the redirect) and the
// challenge (sent to authorize). `method` is always S256 — the only method Epic
// and the SMART spec want; `plain` is never used.
export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

// randomVerifier makes a high-entropy code_verifier: 32 random bytes → 43-char
// base64url (within the RFC's 43–128 range). `random` is injectable so a test
// gets a deterministic verifier; it defaults to Web Crypto's CSPRNG.
export function randomVerifier(
  random: (n: number) => Uint8Array = cryptoRandom,
): string {
  return base64urlEncode(random(32));
}

// cryptoRandom fills n bytes from the platform CSPRNG (Web Crypto in the browser
// and in node ≥18). Never Math.random — this is security material.
function cryptoRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// challengeFromVerifier derives the S256 code_challenge = base64url(sha256(
// verifier)). `sha256` is injectable for tests; defaults to Web Crypto's
// subtle.digest (async). Returns the challenge string.
export async function challengeFromVerifier(
  verifier: string,
  sha256: (input: string) => Promise<Uint8Array> = subtleSha256,
): Promise<string> {
  return base64urlEncode(await sha256(verifier));
}

async function subtleSha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

// createPkce mints a full PKCE pair (verifier + S256 challenge). The app stores
// `verifier` alongside the CSRF `state` before the redirect and replays it at
// token exchange. `random`/`sha256` are injectable for deterministic tests.
export async function createPkce(
  random: (n: number) => Uint8Array = cryptoRandom,
  sha256: (input: string) => Promise<Uint8Array> = subtleSha256,
): Promise<PkcePair> {
  const verifier = randomVerifier(random);
  const challenge = await challengeFromVerifier(verifier, sha256);
  return { verifier, challenge, method: 'S256' };
}

// ── The authorize redirect ───────────────────────────────────────────────

export interface AuthorizeParams {
  authorizationEndpoint: string; // discovered from smart-configuration
  clientId: string;
  redirectUri: string;
  // The FHIR base (`iss`) — SMART/Epic REQUIRE it as `aud` so the token is
  // audienced to the FHIR server the app will call.
  aud: string;
  scope: string;
  state: string; // CSRF state the caller mints and verifies on the callback
  codeChallenge: string; // PKCE S256 challenge
  // The opaque `launch` token from an EHR launch. Present for EHR launch,
  // absent (and omitted) for standalone launch.
  launch?: string;
}

// authorizeUrl builds the exact URL to redirect the browser to. SMART's
// authorization request: response_type=code, client_id, redirect_uri, scope,
// state, aud, code_challenge(+method=S256), and `launch` when present. Pure.
export function authorizeUrl(p: AuthorizeParams): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope,
    state: p.state,
    aud: p.aud,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (p.launch) params.set('launch', p.launch);
  return `${p.authorizationEndpoint}?${params.toString()}`;
}

// ── Token exchange / refresh shaping ──────────────────────────────────────

// The shape of the POST server.ts will make — separated from fetch so a test
// asserts URL, headers, and form body without a network call. Confidential apps
// authenticate with client_secret (in the body here — Epic accepts
// client_secret_post); public apps omit it and rely on PKCE.
export interface TokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string; // urlencoded form
}

export interface ExchangeParams {
  tokenEndpoint: string; // discovered
  clientId: string;
  redirectUri: string;
  code: string; // the authorization code from the callback
  codeVerifier: string; // the PKCE verifier stored before the redirect
  // Confidential-app secret (server-only). Omit for a public app.
  clientSecret?: string;
}

// tokenExchange shapes the code→token POST. SMART/OAuth2:
// grant_type=authorization_code with code, redirect_uri, client_id,
// code_verifier, and client_secret for confidential apps. Pure.
export function tokenExchange(p: ExchangeParams): TokenRequest {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.codeVerifier,
  });
  if (p.clientSecret) body.set('client_secret', p.clientSecret);
  return {
    url: p.tokenEndpoint,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  };
}

export interface RefreshParams {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  clientSecret?: string;
  // A refresh MAY narrow scope; omit to keep the granted scopes.
  scope?: string;
}

// tokenRefresh shapes the refresh POST. grant_type=refresh_token with the stored
// refresh_token (+ client_secret for confidential apps). Same endpoint/content
// type as exchange. Pure.
export function tokenRefresh(p: RefreshParams): TokenRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
  });
  if (p.clientSecret) body.set('client_secret', p.clientSecret);
  if (p.scope) body.set('scope', p.scope);
  return {
    url: p.tokenEndpoint,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  };
}

// ── The token response → SMART context ────────────────────────────────────

// A parsed SMART token response: the OAuth tokens PLUS the SMART launch context
// that rides in the token payload (`patient`, `encounter`, `id_token`, the
// granted `scope`, and the FHIR base to call). The `patient` id is what every
// subsequent FHIR read scopes to.
export interface SmartContext {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  // Absolute expiry (epoch ms) computed from expires_in at parse time, so
  // callers compare against Date.now() without re-deriving.
  expiresAt: number;
  // The launched patient's FHIR id — present for a patient-context launch.
  patient: string;
  // The encounter id when the launch carries one (optional).
  encounter: string;
  // The granted scopes (may be narrower than requested).
  scope: string;
  // OpenID id_token identifying the clinician (`fhirUser`), when present.
  idToken: string;
  // Some servers echo the FHIR base in the token response; kept when present so
  // the caller can prefer it over the launch `iss`.
  fhirBase: string;
}

// parseTokenResponse turns a SMART token payload into a SmartContext, computing
// the absolute expiry. `now` is injectable so the derivation is unit-testable.
// Throws on an OAuth error payload so the caller surfaces the server's real
// reason. Boundary guard on an external response.
export function parseTokenResponse(data: unknown, now: number = Date.now()): SmartContext {
  const d = data as Record<string, unknown>;
  if (d && d.error) {
    const desc = (d.error_description as string) || (d.error as string);
    throw new Error(`SMART OAuth error: ${desc}`);
  }
  const accessToken = d?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('SMART OAuth: no access_token in response');
  }
  const expiresIn = Number(d?.expires_in ?? 0);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    accessToken,
    refreshToken: str(d?.refresh_token),
    tokenType: str(d?.token_type) || 'Bearer',
    expiresAt: now + expiresIn * 1000,
    patient: str(d?.patient),
    encounter: str(d?.encounter),
    scope: str(d?.scope),
    idToken: str(d?.id_token),
    fhirBase: str(d?.fhirBase) || str((d as { serverUrl?: unknown })?.serverUrl),
  };
}

// isExpired reports whether a context's access token is at/near expiry. A skew
// (default 60s) refreshes slightly early so an in-flight FHIR read never races
// the boundary. Pure.
export function isExpired(ctx: Pick<SmartContext, 'expiresAt'>, now: number = Date.now(), skewMs = 60_000): boolean {
  return now >= ctx.expiresAt - skewMs;
}

// ── Launch-URL parsing (pure) ─────────────────────────────────────────────

// The launch parameters SMART puts on the app's launch URL. EHR launch carries
// `iss` (FHIR base) + `launch` (opaque token); standalone launch carries
// neither (the app supplies its own `iss`). Both may be absent when the page is
// opened cold.
export interface LaunchParams {
  iss: string; // FHIR base from the EHR
  launch: string; // opaque launch token
}

// parseLaunch reads the launch URL query into a LaunchParams. Pure — takes a
// query string so it is unit-tested without a DOM. Values are trimmed; absence
// is represented as ''.
export function parseLaunch(search: string): LaunchParams {
  const q = new URLSearchParams(search);
  return {
    iss: (q.get('iss') || '').trim(),
    launch: (q.get('launch') || '').trim(),
  };
}

// The callback parameters SMART returns to redirect_uri: the auth `code` and the
// `state` (to verify against the mint), or an `error`(+description) when the
// user declines / the server rejects.
export interface CallbackParams {
  code: string;
  state: string;
  error: string;
  errorDescription: string;
}

// parseCallback reads the callback URL query. Pure. An `error` present means the
// grant failed — the caller surfaces errorDescription and does NOT exchange.
export function parseCallback(search: string): CallbackParams {
  const q = new URLSearchParams(search);
  return {
    code: (q.get('code') || '').trim(),
    state: (q.get('state') || '').trim(),
    error: (q.get('error') || '').trim(),
    errorDescription: (q.get('error_description') || '').trim(),
  };
}
