// Office's auth = the @hanzo/auth core + two thin Office adapters. The OAuth2 +
// PKCE flow, endpoints, and refresh live ONCE in @hanzo/auth; here we only teach
// it how Office stores tokens (roamingSettings) and how it opens a login window
// (the Dialog API). Plus the office-only API-key path for zero-setup use.

/* global Office */

import {
  authClientFor, login as coreLogin, logout as coreLogout, getValidToken,
  type TokenStore, type TokenSet, type Opener,
} from '@hanzo/auth';
import { APIKEY_SETTING_KEY, TOKEN_SETTING_KEY, pickBearer } from './config.js';

// The office IAM client, with the redirect served from the add-in's own origin
// (registered on the hanzo-office IAM client).
function client() {
  return authClientFor('office', { redirectUri: `${location.origin}/auth-callback.html` });
}

// roamingStore is the Office TokenStore: roamingSettings is per-user and roams
// with the Office identity. The TokenSet is JSON-serialized under one key.
const roamingStore: TokenStore = {
  async get(): Promise<TokenSet | null> {
    try {
      const raw = Office.context.roamingSettings.get(TOKEN_SETTING_KEY) as string;
      return raw ? (JSON.parse(raw) as TokenSet) : null;
    } catch {
      return null;
    }
  },
  set(tokens: TokenSet): Promise<void> {
    return saveRoaming(TOKEN_SETTING_KEY, JSON.stringify(tokens));
  },
  clear(): Promise<void> {
    return removeRoaming(TOKEN_SETTING_KEY);
  },
};

// dialogOpener is the Office Opener: it opens the authorize URL in an Office
// dialog and resolves with the callback URL the dialog posts back via
// messageParent (auth-callback.html does that post).
const dialogOpener: Opener = {
  open(authorizeUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      Office.context.ui.displayDialogAsync(authorizeUrl, { height: 60, width: 30 }, (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error(result.error?.message || 'could not open login dialog'));
          return;
        }
        const dialog = result.value;
        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg: any) => {
          dialog.close();
          resolve(String(arg.message || ''));
        });
        dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
          reject(new Error('login dialog closed'));
        });
      });
    });
  },
};

// signIn / clearToken / getToken delegate to the core with the Office adapters.
export async function signIn(): Promise<string> {
  const tokens = await coreLogin(client(), roamingStore, dialogOpener);
  return tokens.accessToken;
}
export function clearToken(): Promise<void> {
  return coreLogout(roamingStore);
}
// getToken returns a valid (auto-refreshed) access token, or '' if not signed in.
export async function getToken(): Promise<string> {
  return getValidToken(client(), roamingStore);
}

// ── API-key path (office-only, zero-setup) ────────────────────────────────

export function getApiKey(): string {
  try {
    return (Office.context.roamingSettings.get(APIKEY_SETTING_KEY) as string) || '';
  } catch {
    return '';
  }
}
export function setApiKey(key: string): Promise<void> {
  return saveRoaming(APIKEY_SETTING_KEY, key.trim());
}
export function clearApiKey(): Promise<void> {
  return removeRoaming(APIKEY_SETTING_KEY);
}

// bearer is the credential the chat call sends: a pasted API key wins over the
// OAuth token (see pickBearer). Async because the OAuth token may refresh.
export async function bearer(): Promise<string> {
  const key = getApiKey();
  if (key) return key;
  return getValidToken(client(), roamingStore);
}

// hasApiKey / hasSession are SYNC reflect checks for the pane (no refresh, no
// network) — used only to render which credential is live, not to authorize.
export function hasApiKey(): boolean {
  return !!getApiKey();
}
export function hasSession(): boolean {
  try {
    return !!(Office.context.roamingSettings.get(TOKEN_SETTING_KEY) as string);
  } catch {
    return false;
  }
}

// ── roamingSettings helpers ───────────────────────────────────────────────

function saveRoaming(key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.roamingSettings.set(key, value);
    Office.context.roamingSettings.saveAsync((r) => {
      r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error('save failed'));
    });
  });
}
function removeRoaming(key: string): Promise<void> {
  return new Promise((resolve) => {
    Office.context.roamingSettings.remove(key);
    Office.context.roamingSettings.saveAsync(() => resolve());
  });
}

// pickBearer re-export kept for callers/tests that import it from auth.
export { pickBearer };
