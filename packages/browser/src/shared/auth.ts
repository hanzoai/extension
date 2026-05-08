/**
 * Hanzo IAM OAuth2 + PKCE authentication — shared across all browser targets.
 *
 * Uses tab-based auth flow: opens a browser tab for login, monitors for
 * redirect via tabs.onUpdated, then exchanges the authorization code for tokens.
 *
 * Browser-agnostic: accepts a BrowserAdapter so Chrome/Firefox/Safari can
 * each provide their own `tabs` and `storage` implementations.
 */

import {
  IAM_LOGIN_URL,
  IAM_API_URL,
  IAM_API_PATH,
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPES,
  DEFAULT_REDIRECT_URI,
  STORAGE_KEYS,
  loadRuntimeConfig,
  type RuntimeConfig,
} from './config.js';

// ── PKCE Utilities ──────────────────────────────────────────────────────

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkceChallenge(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = generateRandomString(64);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

// ── Browser Adapter (Chrome/Firefox/Safari abstraction) ─────────────────

export interface BrowserStorage {
  get(keys: string[]): Promise<Record<string, any>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface BrowserTabs {
  create(options: { url: string }): Promise<{ id?: number }>;
  remove(tabId: number): Promise<void>;
  onUpdated: {
    addListener(fn: (tabId: number, changeInfo: { url?: string }) => void): void;
    removeListener(fn: (tabId: number, changeInfo: { url?: string }) => void): void;
  };
  onRemoved: {
    addListener(fn: (tabId: number) => void): void;
    removeListener(fn: (tabId: number) => void): void;
  };
}

export interface BrowserAdapter {
  storage: BrowserStorage;
  tabs: BrowserTabs;
}

// ── Token Types ─────────────────────────────────────────────────────────

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface UserInfo {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: unknown;
}

// ── Runtime Config (cached) ─────────────────────────────────────────────

let _runtimeConfig: RuntimeConfig | null = null;

async function getRuntimeConfig(storage: BrowserStorage): Promise<RuntimeConfig> {
  if (!_runtimeConfig) {
    _runtimeConfig = await loadRuntimeConfig(storage as any);
  }
  return _runtimeConfig;
}

// ── Token Storage ───────────────────────────────────────────────────────

async function storeTokens(storage: BrowserStorage, tokens: TokenData): Promise<void> {
  const data: Record<string, unknown> = {
    [STORAGE_KEYS.accessToken]: tokens.access_token,
  };
  if (tokens.refresh_token) data[STORAGE_KEYS.refreshToken] = tokens.refresh_token;
  if (tokens.id_token) data[STORAGE_KEYS.idToken] = tokens.id_token;
  if (tokens.expires_in) {
    data[STORAGE_KEYS.expiresAt] = Date.now() + tokens.expires_in * 1000;
  }
  await storage.set(data);
}

async function getStoredTokens(storage: BrowserStorage): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}> {
  const result = await storage.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.expiresAt,
  ]);
  return {
    accessToken: result[STORAGE_KEYS.accessToken] || null,
    refreshToken: result[STORAGE_KEYS.refreshToken] || null,
    expiresAt: result[STORAGE_KEYS.expiresAt] || null,
  };
}

// ── OAuth2 + PKCE Flow ──────────────────────────────────────────────────

function openAuthTab(
  tabs: BrowserTabs,
  authorizeUrl: string,
  redirectUriPrefix: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let authTabId: number | undefined;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Login timed out'));
    }, 300_000);

    function cleanup() {
      clearTimeout(timeout);
      tabs.onUpdated.removeListener(onTabUpdated);
      tabs.onRemoved.removeListener(onTabRemoved);
    }

    function onTabUpdated(tabId: number, changeInfo: { url?: string }) {
      if (tabId !== authTabId || !changeInfo.url) return;
      if (changeInfo.url.startsWith(redirectUriPrefix)) {
        cleanup();
        tabs.remove(tabId).catch(() => {});
        resolve(changeInfo.url);
      }
    }

    function onTabRemoved(tabId: number) {
      if (tabId !== authTabId) return;
      cleanup();
      reject(new Error('Login cancelled'));
    }

    tabs.onUpdated.addListener(onTabUpdated);
    tabs.onRemoved.addListener(onTabRemoved);
    tabs.create({ url: authorizeUrl }).then((tab) => {
      authTabId = tab.id;
    }).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

/** Initiate OAuth2 login. Works on Chrome, Firefox, and Safari. */
export async function login(adapter: BrowserAdapter): Promise<UserInfo> {
  const config = await getRuntimeConfig(adapter.storage);
  const { codeVerifier, codeChallenge } = await generatePkceChallenge();
  const state = generateRandomString(32);
  const redirectUri = config.redirectUri;

  const authorizeUrl = new URL(`${config.iamLoginUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', config.scopes);
  authorizeUrl.searchParams.set('state', state);

  const callbackUrl = await openAuthTab(adapter.tabs, authorizeUrl.toString(), redirectUri);
  const url = new URL(callbackUrl);
  if (url.searchParams.get('state') !== state) throw new Error('State mismatch — possible CSRF');

  const code = url.searchParams.get('code');
  const directToken = url.searchParams.get('access_token');

  if (directToken) {
    await storeTokens(adapter.storage, {
      access_token: directToken,
      refresh_token: url.searchParams.get('refresh_token') || undefined,
      token_type: 'Bearer',
    });
  } else if (code) {
    // Hanzo gateway exposes Casdoor's `/api/login/oauth/access_token` at
    // `/v1/iam/login/oauth/access_token`. The bare `/oauth/token` from
    // the OIDC well-known doc 404s in prod. Token exchange wants
    // application/x-www-form-urlencoded per RFC 6749, not JSON.
    const tokenResponse = await fetch(`${config.iamApiUrl}${IAM_API_PATH}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });
    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    await storeTokens(adapter.storage, await tokenResponse.json());
  } else {
    const error = url.searchParams.get('error_description') || url.searchParams.get('error') || 'No authorization code or token';
    throw new Error(error);
  }

  const { accessToken } = await getStoredTokens(adapter.storage);
  if (!accessToken) throw new Error('Login succeeded but no token was stored');
  const user = await fetchUserInfo(adapter.storage, accessToken);
  await adapter.storage.set({ [STORAGE_KEYS.user]: user });
  return user;
}

/** Open signup page. */
export async function signup(adapter: BrowserAdapter): Promise<void> {
  const config = await getRuntimeConfig(adapter.storage);
  await adapter.tabs.create({ url: `${config.iamLoginUrl}/signup` });
}

/** Clear all stored tokens. */
export async function logout(storage: BrowserStorage): Promise<void> {
  await storage.remove(Object.values(STORAGE_KEYS));
}

/** Get a valid access token, refreshing if expired. */
export async function getValidAccessToken(storage: BrowserStorage): Promise<string | null> {
  const { accessToken, refreshToken, expiresAt } = await getStoredTokens(storage);
  if (!accessToken) return null;

  if (expiresAt && Date.now() < expiresAt - 60_000) return accessToken;

  if (refreshToken) {
    try {
      return await refreshAccessToken(storage, refreshToken);
    } catch {
      await logout(storage);
      return null;
    }
  }

  return accessToken;
}

async function refreshAccessToken(storage: BrowserStorage, refreshToken: string): Promise<string> {
  const config = await getRuntimeConfig(storage);
  const response = await fetch(`${config.iamApiUrl}${IAM_API_PATH}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!response.ok) throw new Error('Token refresh failed');
  const tokens: TokenData = await response.json();
  await storeTokens(storage, tokens);
  return tokens.access_token;
}

/** Fetch user info from IAM. Hanzo gateway exposes Casdoor's get-account
 *  and userinfo at `${iamApiUrl}/v1/iam/...` — never `/api/`. */
async function fetchUserInfo(storage: BrowserStorage, accessToken: string): Promise<UserInfo> {
  const config = await getRuntimeConfig(storage);
  const base = `${config.iamApiUrl}${IAM_API_PATH}`;
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const acctResp = await fetch(`${base}/get-account`, { headers });
    if (acctResp.ok) {
      const acctJson = await acctResp.json();
      const acct = acctJson.data || acctJson;
      if (acct.name || acct.email) {
        return {
          sub: acct.id || acct.sub,
          name: acct.displayName || acct.name,
          email: acct.email,
          picture: acct.avatar || undefined,
        };
      }
    }
  } catch { /* fall through */ }

  const response = await fetch(`${base}/userinfo`, { headers });
  if (!response.ok) throw new Error('Failed to fetch user info');
  return response.json();
}

/** Get cached user info from storage. */
export async function getUserInfo(storage: BrowserStorage): Promise<UserInfo | null> {
  const result = await storage.get([STORAGE_KEYS.user]);
  return result[STORAGE_KEYS.user] || null;
}

/** Check if user is authenticated (validates token, refreshes if needed). */
export async function isAuthenticated(storage: BrowserStorage): Promise<boolean> {
  const token = await getValidAccessToken(storage);
  return !!token;
}

/** Get auth status for UI display. Validates token and auto-clears stale sessions. */
export async function getAuthStatus(storage: BrowserStorage): Promise<{
  authenticated: boolean;
  user: UserInfo | null;
}> {
  const token = await getValidAccessToken(storage);
  if (!token) {
    return { authenticated: false, user: null };
  }
  const user = await getUserInfo(storage);
  return { authenticated: true, user };
}

// ── Chrome/Firefox Adapter Factories ────────────────────────────────────

/** Create a BrowserAdapter from Chrome extension APIs */
export function chromeAdapter(): BrowserAdapter {
  return {
    storage: {
      get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
      set: (items) => chrome.storage.local.set(items),
      remove: (keys) => chrome.storage.local.remove(keys),
    },
    tabs: {
      create: (opts) => new Promise((resolve, reject) => {
        chrome.tabs.create(opts, (tab) => {
          if (chrome.runtime.lastError || !tab?.id) {
            reject(new Error(chrome.runtime.lastError?.message || 'Failed to open tab'));
          } else {
            resolve(tab);
          }
        });
      }),
      remove: (tabId) => chrome.tabs.remove(tabId),
      onUpdated: chrome.tabs.onUpdated,
      onRemoved: chrome.tabs.onRemoved,
    },
  };
}

/** Create a BrowserAdapter from Firefox WebExtension APIs */
export function firefoxAdapter(): BrowserAdapter {
  const b = (globalThis as any).browser;
  return {
    storage: {
      get: (keys) => b.storage.local.get(keys),
      set: (items) => b.storage.local.set(items),
      remove: (keys) => b.storage.local.remove(keys),
    },
    tabs: {
      create: (opts) => b.tabs.create(opts),
      remove: (tabId) => b.tabs.remove(tabId),
      onUpdated: b.tabs.onUpdated,
      onRemoved: b.tabs.onRemoved,
    },
  };
}
