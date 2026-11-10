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

export interface BrowserTabInfo {
  id?: number;
  url?: string;
  pendingUrl?: string;
}

export interface BrowserTabs {
  create(options: { url: string }): Promise<BrowserTabInfo>;
  remove(tabId: number): Promise<void>;
  update?(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<BrowserTabInfo>;
  onUpdated: {
    addListener(fn: (tabId: number, changeInfo: { url?: string; status?: string }, tab?: BrowserTabInfo) => void): void;
    removeListener(fn: (tabId: number, changeInfo: { url?: string; status?: string }, tab?: BrowserTabInfo) => void): void;
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

// ── Pending PKCE State (survives MV3 Service Worker idle/restart) ────────

export const PENDING_PKCE_KEY = 'hanzo_iam_pending_pkce';
export const LOGGED_OUT_KEY = 'hanzo_iam_logged_out';

export interface PendingPkce {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const activeAuthStates = new Set<string>();
const activeCallbackFinalizers = new Map<string, (url: string) => void>();

/** Extract standard OIDC user claims from a JWT payload as a resilient fallback. */
export function parseJwtUserInfo(token: string): UserInfo | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!payload || typeof payload !== 'object') return null;
    const sub = payload.sub || payload.id || payload.name;
    const name = payload.displayName || payload.name || payload.preferred_username || payload.email;
    const email = payload.email;
    const picture = payload.avatar || payload.picture;
    if (!sub && !name && !email) return null;
    return {
      ...(sub ? { sub: String(sub) } : {}),
      ...(name ? { name: String(name) } : {}),
      ...(email ? { email: String(email) } : {}),
      ...(picture ? { picture: String(picture) } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Check if a URL is an IAM magic-link email callback (`/callback#email=...&code=...`)
 * that landed on `/callback` instead of `/auth/callback`.
 */
export function getMagicLinkRedirectUrl(urlStr: string | undefined, redirectUriPrefix: string): string | null {
  if (!urlStr || !urlStr.startsWith(redirectUriPrefix)) return null;
  try {
    const parsed = new URL(urlStr);
    if (parsed.searchParams.has('code') || parsed.searchParams.has('access_token') || parsed.searchParams.has('error')) {
      return null;
    }
    const hash = parsed.hash.replace(/^#/, '');
    if (!hash) return null;
    const hashParams = new URLSearchParams(hash);
    if (hashParams.get('email') && hashParams.get('code') && parsed.pathname === '/callback') {
      parsed.pathname = '/auth/callback';
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether a tab URL matches the OAuth redirect URI.
 * Handles both `changeInfo.url` and `tab.url` (Chrome omits `changeInfo.url` on
 * same-origin redirects from `hanzo.ai/login` to `hanzo.ai/callback`).
 */
export function isOAuthRedirectUrl(
  urlStr: string | undefined,
  redirectUriPrefix: string,
  expectedState?: string,
  isAuthTab = false,
): boolean {
  if (!urlStr || !urlStr.startsWith(redirectUriPrefix)) return false;
  // Never treat a fragment-only email magic link (#email=...&code=...) as the OAuth code redirect.
  if (getMagicLinkRedirectUrl(urlStr, redirectUriPrefix)) return false;
  try {
    const parsed = new URL(urlStr);
    const hasOAuthParam =
      parsed.searchParams.has('code') ||
      parsed.searchParams.has('access_token') ||
      parsed.searchParams.has('error');
    if (isAuthTab && !expectedState) {
      return true;
    }
    if (!hasOAuthParam) return isAuthTab && !parsed.hash;
    const urlState = parsed.searchParams.get('state');
    if (expectedState && urlState && urlState !== expectedState) {
      return false;
    }
    if (!isAuthTab && expectedState && urlState !== expectedState) {
      return false;
    }
    return true;
  } catch {
    return isAuthTab;
  }
}

// ── OAuth2 + PKCE Flow ──────────────────────────────────────────────────

function openAuthTab(
  tabs: BrowserTabs,
  authorizeUrl: string,
  redirectUriPrefix: string,
  expectedState?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let authTabId: number | undefined;
    let settled = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Login timed out'));
    }, 300_000);

    function finish(url: string, callbackTabId?: number) {
      if (settled) return;
      settled = true;
      cleanup();
      if (typeof callbackTabId === 'number') {
        tabs.remove(callbackTabId).catch(() => {});
      }
      if (typeof authTabId === 'number' && authTabId !== callbackTabId) {
        tabs.remove(authTabId).catch(() => {});
      }
      resolve(url);
    }

    function cleanup() {
      clearTimeout(timeout);
      if (expectedState) {
        activeCallbackFinalizers.delete(expectedState);
      }
      tabs.onUpdated.removeListener(onTabUpdated);
      tabs.onRemoved.removeListener(onTabRemoved);
    }

    function onTabUpdated(
      tabId: number,
      changeInfo: { url?: string; status?: string },
      tab?: BrowserTabInfo,
    ) {
      const candidateUrl = changeInfo?.url || tab?.url || tab?.pendingUrl;
      if (!candidateUrl) return;

      // If the user clicked an IAM magic link in their email which opened
      // https://hanzo.ai/callback#email=...&code=..., forward it to /auth/callback
      // so hanzo.ai's BroadcastChannel hands the OTP to the waiting login tab.
      const magicRedirect = getMagicLinkRedirectUrl(candidateUrl, redirectUriPrefix);
      if (magicRedirect && typeof tabs.update === 'function') {
        tabs.update(tabId, { url: magicRedirect }).catch(() => {});
        return;
      }

      const isAuthTab = authTabId !== undefined && tabId === authTabId;
      if (!isOAuthRedirectUrl(candidateUrl, redirectUriPrefix, expectedState, isAuthTab)) {
        return;
      }
      finish(candidateUrl, tabId);
    }

    function onTabRemoved(tabId: number) {
      if (tabId !== authTabId || settled) return;
      cleanup();
      reject(new Error('Login cancelled'));
    }

    if (expectedState) {
      activeCallbackFinalizers.set(expectedState, (url: string) => finish(url));
    }

    tabs.onUpdated.addListener(onTabUpdated);
    tabs.onRemoved.addListener(onTabRemoved);
    tabs.create({ url: authorizeUrl }).then((tab) => {
      authTabId = tab.id;
      const initialUrl = tab.url || tab.pendingUrl;
      if (initialUrl && isOAuthRedirectUrl(initialUrl, redirectUriPrefix, expectedState, true)) {
        finish(initialUrl, tab.id);
      }
    }).catch((err) => {
      if (settled) return;
      cleanup();
      reject(err);
    });
  });
}

async function exchangeAndStoreCallback(
  storage: BrowserStorage,
  callbackUrl: string,
  state: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<UserInfo> {
  const config = await getRuntimeConfig(storage);
  const url = new URL(callbackUrl);
  if (url.searchParams.get('state') !== state) throw new Error('State mismatch — possible CSRF');

  const code = url.searchParams.get('code');
  const directToken = url.searchParams.get('access_token');

  if (directToken) {
    await storeTokens(storage, {
      access_token: directToken,
      refresh_token: url.searchParams.get('refresh_token') || undefined,
      token_type: 'Bearer',
    });
  } else if (code) {
    // HIP-0111 canonical token endpoint `/v1/iam/oauth/token`. Token
    // exchange wants application/x-www-form-urlencoded per RFC 6749.
    const tokenResponse = await fetch(`${config.iamApiUrl}${IAM_API_PATH}/oauth/token`, {
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
    await storeTokens(storage, await tokenResponse.json());
  } else {
    const error = url.searchParams.get('error_description') || url.searchParams.get('error') || 'No authorization code or token';
    throw new Error(error);
  }

  await storage.remove([PENDING_PKCE_KEY, LOGGED_OUT_KEY]).catch(() => {});

  const { accessToken } = await getStoredTokens(storage);
  if (!accessToken) throw new Error('Login succeeded but no token was stored');
  const user = await fetchUserInfo(storage, accessToken);
  await storage.set({ [STORAGE_KEYS.user]: user });
  return user;
}

/** Initiate OAuth2 login. Works on Chrome, Firefox, and Safari. */
export async function login(adapter: BrowserAdapter): Promise<UserInfo> {
  const config = await getRuntimeConfig(adapter.storage);
  const { codeVerifier, codeChallenge } = await generatePkceChallenge();
  const state = generateRandomString(32);
  const redirectUri = config.redirectUri;

  await adapter.storage.remove([LOGGED_OUT_KEY]).catch(() => {});
  await adapter.storage.set({
    [PENDING_PKCE_KEY]: {
      state,
      codeVerifier,
      redirectUri,
      createdAt: Date.now(),
    } satisfies PendingPkce,
  });

  const authorizeUrl = new URL(`${config.iamLoginUrl}${IAM_API_PATH}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', config.scopes);
  authorizeUrl.searchParams.set('state', state);

  activeAuthStates.add(state);
  try {
    const callbackUrl = await openAuthTab(adapter.tabs, authorizeUrl.toString(), redirectUri, state);
    return await exchangeAndStoreCallback(adapter.storage, callbackUrl, state, codeVerifier, redirectUri);
  } finally {
    activeAuthStates.delete(state);
  }
}

/**
 * Handle an OAuth callback URL reported by either a top-level `tabs.onUpdated`
 * listener (after an MV3 service worker restart) or a content script on `/callback`.
 */
export async function completePendingAuthCallback(
  adapter: BrowserAdapter,
  callbackUrl: string,
  tabId?: number,
): Promise<UserInfo | null> {
  const config = await getRuntimeConfig(adapter.storage);
  const magicRedirect = getMagicLinkRedirectUrl(callbackUrl, config.redirectUri);
  if (magicRedirect && typeof tabId === 'number' && typeof adapter.tabs.update === 'function') {
    await adapter.tabs.update(tabId, { url: magicRedirect }).catch(() => {});
    return null;
  }

  if (!isOAuthRedirectUrl(callbackUrl, config.redirectUri)) return null;

  let state: string | null = null;
  try {
    state = new URL(callbackUrl).searchParams.get('state');
  } catch {
    return null;
  }
  if (!state) return null;

  // If an in-memory openAuthTab is actively waiting for this state, hand the URL to it.
  const finalizer = activeCallbackFinalizers.get(state);
  if (finalizer) {
    if (typeof tabId === 'number') {
      adapter.tabs.remove(tabId).catch(() => {});
    }
    finalizer(callbackUrl);
    return null;
  }
  if (activeAuthStates.has(state)) return null;

  // Otherwise check storage for a pending PKCE session (e.g. service worker woke up on redirect).
  const stored = await adapter.storage.get([PENDING_PKCE_KEY]);
  const pending = stored[PENDING_PKCE_KEY] as PendingPkce | undefined;
  if (!pending || pending.state !== state) return null;
  if (Date.now() - pending.createdAt > 15 * 60_000) {
    await adapter.storage.remove([PENDING_PKCE_KEY]).catch(() => {});
    return null;
  }

  await adapter.storage.remove([PENDING_PKCE_KEY]).catch(() => {});
  if (typeof tabId === 'number') {
    adapter.tabs.remove(tabId).catch(() => {});
  }
  return exchangeAndStoreCallback(
    adapter.storage,
    callbackUrl,
    pending.state,
    pending.codeVerifier,
    pending.redirectUri || config.redirectUri,
  );
}

/**
 * Adopt a valid `@hanzo/iam` session from a Hanzo web origin (`hanzo.ai`, `hanzo.app`, etc.)
 * into extension storage so users already signed into Hanzo on the web don't have to sign in twice.
 */
export async function syncWebSession(
  storage: BrowserStorage,
  webTokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
    expiresAt?: number | string | null;
    user?: UserInfo | null;
  },
  options?: { force?: boolean },
): Promise<UserInfo | null> {
  const accessToken = webTokens.accessToken?.trim();
  if (!accessToken) return null;

  if (!options?.force) {
    const flags = await storage.get([LOGGED_OUT_KEY, STORAGE_KEYS.accessToken, STORAGE_KEYS.expiresAt]);
    if (flags[LOGGED_OUT_KEY]) return null;
    const existing = flags[STORAGE_KEYS.accessToken];
    const existingExp = Number(flags[STORAGE_KEYS.expiresAt]) || 0;
    if (existing && (!existingExp || Date.now() < existingExp - 60_000)) {
      return (await getUserInfo(storage)) || parseJwtUserInfo(existing);
    }
  }

  const expiresAtNum = webTokens.expiresAt ? Number(webTokens.expiresAt) : 0;
  if (expiresAtNum && Date.now() >= expiresAtNum - 60_000) {
    return null;
  }

  const toStore: Record<string, unknown> = {
    [STORAGE_KEYS.accessToken]: accessToken,
  };
  if (webTokens.refreshToken) toStore[STORAGE_KEYS.refreshToken] = webTokens.refreshToken;
  if (webTokens.idToken) toStore[STORAGE_KEYS.idToken] = webTokens.idToken;
  if (expiresAtNum > 0) toStore[STORAGE_KEYS.expiresAt] = expiresAtNum;

  let user: UserInfo | null = webTokens.user && typeof webTokens.user === 'object' ? webTokens.user : null;
  if (!user) {
    try {
      user = await fetchUserInfo(storage, accessToken);
    } catch {
      user = parseJwtUserInfo(accessToken) || (webTokens.idToken ? parseJwtUserInfo(webTokens.idToken) : null);
    }
  }
  if (user) {
    toStore[STORAGE_KEYS.user] = user;
  }

  await storage.remove([LOGGED_OUT_KEY, PENDING_PKCE_KEY]).catch(() => {});
  await storage.set(toStore);
  return user;
}

/** Open signup page. */
export async function signup(adapter: BrowserAdapter): Promise<void> {
  const config = await getRuntimeConfig(adapter.storage);
  await adapter.tabs.create({ url: `${config.iamLoginUrl}/signup` });
}

/** Clear all stored tokens. */
export async function logout(storage: BrowserStorage): Promise<void> {
  await storage.remove([...Object.values(STORAGE_KEYS), PENDING_PKCE_KEY]);
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

  // Known-expired with nothing to refresh from: the session is over, so say so.
  // Handing the dead token back left every caller believing it was signed in,
  // and the surfaces discovered the 401 for themselves — the answer engine read
  // that as a failed search rather than a signed-out one.
  if (expiresAt) {
    await logout(storage);
    return null;
  }

  // No expiry was ever recorded (the direct-token login path stores none), so
  // the token is not provably stale. Use it.
  return accessToken;
}

async function refreshAccessToken(storage: BrowserStorage, refreshToken: string): Promise<string> {
  const config = await getRuntimeConfig(storage);
  const response = await fetch(`${config.iamApiUrl}${IAM_API_PATH}/oauth/token`, {
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

/** Fetch user info from IAM via the canonical HIP-0111 OIDC userinfo
 *  endpoint `${iamApiUrl}/v1/iam/oauth/userinfo`. Returns standard OIDC
 *  claims (sub, email, name, picture); never the legacy IAM `/api/` shape. */
async function fetchUserInfo(storage: BrowserStorage, accessToken: string): Promise<UserInfo> {
  const config = await getRuntimeConfig(storage);
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const response = await fetch(`${config.iamApiUrl}${IAM_API_PATH}/oauth/userinfo`, { headers });
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Fall back to JWT payload claims below if userinfo network call fails
  }

  const fromJwt = parseJwtUserInfo(accessToken);
  if (fromJwt) return fromJwt;
  throw new Error('Failed to fetch user info');
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
  let user = await getUserInfo(storage);
  if (!user) {
    user = parseJwtUserInfo(token);
    if (user) {
      await storage.set({ [STORAGE_KEYS.user]: user }).catch(() => {});
    }
  }
  return { authenticated: true, user };
}

// ── WebExtension Adapter Factory ────────────────────────────────────────
//
// Unified across Chrome (MV3), Firefox (MV3), Safari (WebExtension), and
// Edge (Chromium MV3). Uses webextension-polyfill at the entrypoint level
// so `globalThis.browser` is the canonical Promise-returning API on every
// runtime. On Firefox/Safari `browser.*` is native; on Chrome the polyfill
// wraps `chrome.*` callbacks. The result is ONE codepath that works
// identically everywhere — no more separate `chromeAdapter` /
// `firefoxAdapter` factories with subtly different behavior.
//
// The adapter intentionally still targets a small surface (storage +
// tabs) because that's all auth.ts needs. If we ever migrate the wider
// codebase to `browser.*` we'd extend this — but for now keeping the
// surface minimal avoids unnecessary churn in callback-style listeners
// elsewhere (e.g. the runtime.onMessage handlers, which are still chrome
// callback style by design).
function getBrowser(): typeof browser {
  // Prefer the polyfilled `browser` if present (Chrome with the polyfill
  // imported at entrypoint, or any native browser.*-supporting runtime).
  // Fall back to wrapping `chrome.*` directly if neither is present
  // (which only happens in tests / non-extension contexts).
  return (globalThis as any).browser ?? (globalThis as any).chrome;
}

/**
 * Create a BrowserAdapter that works on Chrome/Firefox/Edge/Safari.
 * Requires `globalThis.browser` to be defined (which the polyfill
 * import at the entrypoint guarantees on Chrome).
 */
export function webExtensionAdapter(): BrowserAdapter {
  const b: any = getBrowser();
  return {
    storage: {
      // Promise-returning on every runtime once the polyfill is loaded.
      get: (keys) => Promise.resolve(b.storage.local.get(keys)),
      set: (items) => Promise.resolve(b.storage.local.set(items)),
      remove: (keys) => Promise.resolve(b.storage.local.remove(keys)),
    },
    tabs: {
      create: (opts) => Promise.resolve(b.tabs.create(opts)),
      remove: (tabId) => Promise.resolve(b.tabs.remove(tabId)),
      update: b.tabs?.update ? (tabId, props) => Promise.resolve(b.tabs.update(tabId, props)) : undefined,
      onUpdated: b.tabs.onUpdated,
      onRemoved: b.tabs.onRemoved,
    },
  };
}

/**
 * Legacy Chrome adapter — kept for backwards compatibility with callers
 * that imported it before 1.9.0. Now just an alias for
 * `webExtensionAdapter`. Prefer `webExtensionAdapter` in new code.
 */
export function chromeAdapter(): BrowserAdapter {
  return webExtensionAdapter();
}

/**
 * Legacy Firefox adapter — same deal as `chromeAdapter`. Both are
 * aliases now that the polyfill gives us one identical surface.
 */
export function firefoxAdapter(): BrowserAdapter {
  return webExtensionAdapter();
}
