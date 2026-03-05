/**
 * Hanzo IAM OAuth2 + PKCE authentication for browser extensions.
 *
 * Uses chrome.identity.launchWebAuthFlow() — the proper extension OAuth API.
 * Token storage uses hanzo_iam_* prefix (matching @hanzo/iam SDK convention).
 */

// ---------------------------------------------------------------------------
// PKCE Utilities (adapted from @hanzo/iam-sdk/src/pkce.ts)
// ---------------------------------------------------------------------------

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkceChallenge(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = generateRandomString(64);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

function generateState(): string {
  return generateRandomString(32);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IAM_BASE = 'https://hanzo.id';
const CLIENT_ID = 'app-hanzo';
const SCOPES = 'openid profile email';

// Storage keys (matching @hanzo/iam SDK convention)
const STORAGE_KEYS = {
  accessToken: 'hanzo_iam_access_token',
  refreshToken: 'hanzo_iam_refresh_token',
  idToken: 'hanzo_iam_id_token',
  expiresAt: 'hanzo_iam_expires_at',
  user: 'hanzo_iam_user',
} as const;

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

interface TokenData {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface UserInfo {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: unknown;
}

async function storeTokens(tokens: TokenData): Promise<void> {
  const data: Record<string, unknown> = {
    [STORAGE_KEYS.accessToken]: tokens.access_token,
  };
  if (tokens.refresh_token) data[STORAGE_KEYS.refreshToken] = tokens.refresh_token;
  if (tokens.id_token) data[STORAGE_KEYS.idToken] = tokens.id_token;
  if (tokens.expires_in) {
    data[STORAGE_KEYS.expiresAt] = Date.now() + tokens.expires_in * 1000;
  }
  return chrome.storage.local.set(data);
}

async function getStoredTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken, STORAGE_KEYS.expiresAt],
      (result) => {
        resolve({
          accessToken: result[STORAGE_KEYS.accessToken] || null,
          refreshToken: result[STORAGE_KEYS.refreshToken] || null,
          expiresAt: result[STORAGE_KEYS.expiresAt] || null,
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// OAuth2 + PKCE Flow
// ---------------------------------------------------------------------------

/**
 * Initiate OAuth2 login via chrome.identity.launchWebAuthFlow.
 * Returns user info on success.
 */
export async function login(): Promise<UserInfo> {
  const { codeVerifier, codeChallenge } = await generatePkceChallenge();
  const state = generateState();
  const redirectUri = chrome.identity.getRedirectURL();

  const authorizeUrl = new URL(`${IAM_BASE}/login/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', SCOPES);
  authorizeUrl.searchParams.set('state', state);

  // Launch browser-managed auth popup
  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authorizeUrl.toString(),
    interactive: true,
  });

  if (!callbackUrl) throw new Error('Authentication cancelled');

  const url = new URL(callbackUrl);
  const returnedState = url.searchParams.get('state');
  if (returnedState !== state) throw new Error('State mismatch — possible CSRF');

  const code = url.searchParams.get('code');
  if (!code) {
    const error = url.searchParams.get('error_description') || url.searchParams.get('error') || 'No authorization code';
    throw new Error(error);
  }

  // Exchange code for tokens (OIDC standard endpoint)
  const tokenResponse = await fetch(`${IAM_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${errText}`);
  }

  const tokens: TokenData = await tokenResponse.json();
  await storeTokens(tokens);

  // Fetch user info
  const user = await fetchUserInfo(tokens.access_token);
  await chrome.storage.local.set({ [STORAGE_KEYS.user]: user });

  return user;
}

/**
 * Log out — clear all stored tokens.
 */
export async function logout(): Promise<void> {
  await chrome.storage.local.remove(Object.values(STORAGE_KEYS));
}

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const { accessToken, refreshToken, expiresAt } = await getStoredTokens();
  if (!accessToken) return null;

  // Token still valid (with 60s buffer)
  if (expiresAt && Date.now() < expiresAt - 60_000) {
    return accessToken;
  }

  // Try refresh
  if (refreshToken) {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      return refreshed;
    } catch {
      // Refresh failed — user needs to re-login
      await logout();
      return null;
    }
  }

  // Expired, no refresh token
  return accessToken; // Return anyway, let API reject if expired
}

/**
 * Refresh access token using refresh_token grant.
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch(`${IAM_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) throw new Error('Token refresh failed');

  const tokens: TokenData = await response.json();
  await storeTokens(tokens);
  return tokens.access_token;
}

/**
 * Fetch user info from IAM.
 */
async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(`${IAM_BASE}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch user info');
  return response.json();
}

/**
 * Get cached user info from storage.
 */
export async function getUserInfo(): Promise<UserInfo | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.user], (result) => {
      resolve(result[STORAGE_KEYS.user] || null);
    });
  });
}

/**
 * Check if user is authenticated (has a stored token).
 */
export async function isAuthenticated(): Promise<boolean> {
  const { accessToken } = await getStoredTokens();
  return !!accessToken;
}

/**
 * Get auth status for UI display.
 */
export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  user: UserInfo | null;
}> {
  const [authenticated, user] = await Promise.all([
    isAuthenticated(),
    getUserInfo(),
  ]);
  return { authenticated, user };
}
