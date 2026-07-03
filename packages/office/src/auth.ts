// Auth: token storage in Office roaming settings (persists per-user across the
// user's devices) + the IAM authorization-code+PKCE flow run through the Office
// Dialog API. The URL/crypto is in pkce.ts (tested); this is the dialog glue.

/* global Office */

import { TOKEN_SETTING_KEY, APIKEY_SETTING_KEY, iamTokenURL, CLIENT_ID, pickBearer } from './config.js';
import { createPkce, buildAuthorizeURL } from './pkce.js';

// getToken / setToken / clearToken persist the IAM access token. roamingSettings
// is per-user and roams with the Office identity; it is NOT shared across users
// on a shared machine.
export function getToken(): string {
  try {
    return (Office.context.roamingSettings.get(TOKEN_SETTING_KEY) as string) || '';
  } catch {
    return '';
  }
}

// getApiKey / setApiKey / clearApiKey persist a pasted Hanzo API key (`hk-…`).
// This is the zero-setup credential — no OAuth client registration required —
// used by the downloadable test kit.
export function getApiKey(): string {
  try {
    return (Office.context.roamingSettings.get(APIKEY_SETTING_KEY) as string) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.roamingSettings.set(APIKEY_SETTING_KEY, key.trim());
    Office.context.roamingSettings.saveAsync((r) => {
      r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error('save key failed'));
    });
  });
}

export function clearApiKey(): Promise<void> {
  return new Promise((resolve) => {
    Office.context.roamingSettings.remove(APIKEY_SETTING_KEY);
    Office.context.roamingSettings.saveAsync(() => resolve());
  });
}

// bearer is the credential the chat call sends: the pasted API key wins over the
// OAuth token (see pickBearer), else empty for anonymous.
export function bearer(): string {
  return pickBearer(getApiKey(), getToken());
}

export function setToken(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.roamingSettings.set(TOKEN_SETTING_KEY, token);
    Office.context.roamingSettings.saveAsync((r) => {
      r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error('save token failed'));
    });
  });
}

export function clearToken(): Promise<void> {
  return new Promise((resolve) => {
    Office.context.roamingSettings.remove(TOKEN_SETTING_KEY);
    Office.context.roamingSettings.saveAsync(() => resolve());
  });
}

// redirectURI is the dialog callback served from the add-in's own host (same
// origin as the task pane), registered on the hanzo-office IAM client.
function redirectURI(): string {
  return `${location.origin}/auth-callback.html`;
}

// signIn opens the IAM login in an Office dialog, runs PKCE, exchanges the code
// for a token, stores it, and resolves the token. Rejects if the user cancels
// or the exchange fails. The dialog posts its `?code=&state=` back via
// messageParent; auth-callback.html is that trivial page.
export async function signIn(): Promise<string> {
  const { verifier, challenge, state } = await createPkce();
  const url = buildAuthorizeURL(redirectURI(), challenge, state);

  const callback = await openAuthDialog(url);
  const params = new URLSearchParams(callback.split('?')[1] || '');
  if (params.get('state') !== state) throw new Error('auth state mismatch');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error') || 'no authorization code');

  const resp = await fetch(iamTokenURL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectURI(),
    }),
  });
  if (!resp.ok) throw new Error(`token exchange failed: ${resp.status}`);
  const tok = await resp.json();
  const access = tok.access_token as string;
  if (!access) throw new Error('no access_token in response');
  await setToken(access);
  return access;
}

// openAuthDialog wraps the Office Dialog API in a promise that resolves with the
// callback URL the dialog posts back (via Office.context.ui.messageParent).
function openAuthDialog(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.ui.displayDialogAsync(url, { height: 60, width: 30 }, (result) => {
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
}
