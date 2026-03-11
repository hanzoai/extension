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
  chromeAdapter,
  type UserInfo,
} from './shared/auth.js';

const adapter = chromeAdapter();

export async function login(): Promise<UserInfo> {
  return sharedLogin(adapter);
}

export async function signup(): Promise<void> {
  return sharedSignup(adapter);
}

export async function logout(): Promise<void> {
  return sharedLogout(adapter.storage);
}

export async function getValidAccessToken(): Promise<string | null> {
  return sharedGetValidAccessToken(adapter.storage);
}

export async function getUserInfo(): Promise<UserInfo | null> {
  return sharedGetUserInfo(adapter.storage);
}

export async function isAuthenticated(): Promise<boolean> {
  return sharedIsAuthenticated(adapter.storage);
}

export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  user: UserInfo | null;
}> {
  return sharedGetAuthStatus(adapter.storage);
}

export type { UserInfo };
