/**
 * Chrome auth module — thin wrapper around shared auth.
 *
 * Re-exports shared auth functions bound to Chrome extension APIs.
 * All PKCE, token storage, and IAM logic lives in shared/auth.ts.
 */

import {
  login as sharedLogin,
  signup as sharedSignup,
  logout as sharedLogout,
  getValidAccessToken as sharedGetValidAccessToken,
  getUserInfo as sharedGetUserInfo,
  isAuthenticated as sharedIsAuthenticated,
  getAuthStatus as sharedGetAuthStatus,
  completePendingAuthCallback as sharedCompletePendingAuthCallback,
  syncWebSession as sharedSyncWebSession,
  LOGGED_OUT_KEY,
  chromeAdapter,
  type UserInfo,
} from './shared/auth.js';

const adapter = chromeAdapter();

const HANZO_WEB_PATTERNS = [
  'https://hanzo.ai/*',
  'https://*.hanzo.ai/*',
  'https://hanzo.app/*',
  'https://*.hanzo.app/*',
  'https://hanzo.chat/*',
];

/**
 * Inspect open Hanzo web tabs (`hanzo.ai`, `hanzo.app`, `hanzo.chat`) for an active
 * `@hanzo/iam` localStorage session and adopt it into extension storage if valid.
 */
export async function trySyncFromHanzoTabs(options?: { force?: boolean }): Promise<UserInfo | null> {
  try {
    if (!globalThis.chrome?.tabs?.query || !globalThis.chrome?.scripting?.executeScript) {
      return null;
    }
    if (!options?.force) {
      const flags = await adapter.storage.get([LOGGED_OUT_KEY]);
      if (flags[LOGGED_OUT_KEY]) return null;
    }
    const tabs = await chrome.tabs.query({ url: HANZO_WEB_PATTERNS });
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try {
              const accessToken = localStorage.getItem('hanzo_iam_access_token');
              if (!accessToken) return null;
              let user = null;
              try {
                const rawUser = localStorage.getItem('hanzo_iam_user');
                if (rawUser) user = JSON.parse(rawUser);
              } catch {}
              return {
                accessToken,
                refreshToken: localStorage.getItem('hanzo_iam_refresh_token'),
                idToken: localStorage.getItem('hanzo_iam_id_token'),
                expiresAt: localStorage.getItem('hanzo_iam_expires_at'),
                user,
              };
            } catch {
              return null;
            }
          },
        });
        const webTokens = results?.[0]?.result;
        if (webTokens?.accessToken) {
          const syncedUser = await sharedSyncWebSession(adapter.storage, webTokens, options);
          if (syncedUser) return syncedUser;
        }
      } catch {
        // Tab may be discarded or not scriptable; continue checking others.
      }
    }
  } catch {
    // Ignore tab query errors.
  }
  return null;
}

export async function login(): Promise<UserInfo> {
  await adapter.storage.remove([LOGGED_OUT_KEY]).catch(() => {});
  const synced = await trySyncFromHanzoTabs({ force: true });
  if (synced) return synced;
  return sharedLogin(adapter);
}

export async function signup(): Promise<void> {
  return sharedSignup(adapter);
}

export async function logout(): Promise<void> {
  await sharedLogout(adapter.storage);
  await adapter.storage.set({ [LOGGED_OUT_KEY]: true }).catch(() => {});
}

export async function getValidAccessToken(): Promise<string | null> {
  const token = await sharedGetValidAccessToken(adapter.storage);
  if (token) return token;
  const synced = await trySyncFromHanzoTabs();
  if (synced) {
    return sharedGetValidAccessToken(adapter.storage);
  }
  return null;
}

export async function getUserInfo(): Promise<UserInfo | null> {
  return sharedGetUserInfo(adapter.storage);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getValidAccessToken();
  return !!token;
}

export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  user: UserInfo | null;
}> {
  let status = await sharedGetAuthStatus(adapter.storage);
  if (!status.authenticated) {
    const synced = await trySyncFromHanzoTabs();
    if (synced) {
      status = await sharedGetAuthStatus(adapter.storage);
    }
  }
  return status;
}

export async function completePendingAuthCallback(callbackUrl: string, tabId?: number): Promise<UserInfo | null> {
  return sharedCompletePendingAuthCallback(adapter, callbackUrl, tabId);
}

export async function syncWebSession(
  webTokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
    expiresAt?: number | string | null;
    user?: UserInfo | null;
  },
  options?: { force?: boolean },
): Promise<UserInfo | null> {
  return sharedSyncWebSession(adapter.storage, webTokens, options);
}

export type { UserInfo };
