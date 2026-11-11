/**
 * Unified Password & Credential Vault Integration for Hanzo Browser Extension
 *
 * Bridges:
 * 1. LastPass Browser Extension (`hdokiejnpimakedhajhdlcegeplioahd` / Firefox `support@lastpass.com`)
 * 2. 1Password Browser Extension (`aeblfdkhhhdcdjpifhhbdiojplfjncoa` / Firefox `d634138d-c276-4fc8-924b-40a0ea21d284`)
 * 3. Hanzo KMS (`/v1/kms/secrets`) for sealed API keys, tokens, and secret egress
 *
 * SECURITY INVARIANT:
 * Plaintext passwords, API keys, and KMS secret values NEVER leave the extension
 * worker in return payloads, logs, or error strings. Every fill/egress method
 * returns boolean/redacted metadata only.
 */

import { kmsListSecrets, kmsGetSecret, kmsPutSecret, type KmsSecretRef } from './kms.js';
import { API_BASE_URL, KMS_API_URL } from './config.js';
import { getSocialSessions, syncSocialAccounts } from './social-web.js';

export const VAULT_EXTENSIONS = {
  lastpass: {
    id: 'lastpass',
    name: 'LastPass',
    chromeIds: ['hdokiejnpimakedhajhdlcegeplioahd'],
    firefoxIds: ['support@lastpass.com'],
  },
  onepassword: {
    id: '1password',
    name: '1Password',
    chromeIds: ['aeblfdkhhhdcdjpifhhbdiojplfjncoa', 'dppgmdbiimibapkepcbdbmkaabgiofem'],
    firefoxIds: ['{d634138d-c276-4fc8-924b-40a0ea21d284}'],
  },
} as const;

export const VAULT_METHODS = new Set([
  'vault.status',
  'vault.autofill',
  'vault.syncAutofill',
  'vault.fillFromKms',
  'vault.captureToKms',
  'vault.egressFetch',
  'post.setup',
]);

export interface VaultManagerInfo {
  id: 'lastpass' | '1password';
  name: string;
  extensionId: string;
  installed: boolean;
  enabled: boolean;
  version?: string;
  detectedOnPage?: boolean;
}

/**
 * Inspect installed sibling password manager extensions via `management` API (when permitted)
 * plus DOM markers in the target tab (always available on scriptable http/https pages).
 */
export async function getVaultStatus(
  api: any,
  opts: { tabId?: number | null; getToken?: () => Promise<string | null>; org?: string } = {},
): Promise<Record<string, unknown>> {
  const managers: Record<'lastpass' | '1password', VaultManagerInfo> = {
    lastpass: {
      id: 'lastpass',
      name: 'LastPass',
      extensionId: VAULT_EXTENSIONS.lastpass.chromeIds[0],
      installed: false,
      enabled: false,
    },
    '1password': {
      id: '1password',
      name: '1Password',
      extensionId: VAULT_EXTENSIONS.onepassword.chromeIds[0],
      installed: false,
      enabled: false,
    },
  };

  // 1. Check chrome.management if optional permission is present
  try {
    if (api?.management?.getAll) {
      const exts: any[] = await new Promise((resolve) => {
        try {
          const maybe = api.management.getAll((list: any[]) => resolve(list || []));
          if (maybe && typeof maybe.then === 'function') maybe.then(resolve, () => resolve([]));
        } catch {
          resolve([]);
        }
      });
      for (const ext of exts) {
        const id = String(ext?.id || '');
        const lname = String(ext?.name || '').toLowerCase();
        if (VAULT_EXTENSIONS.lastpass.chromeIds.includes(id as any) || lname.includes('lastpass')) {
          managers.lastpass = {
            id: 'lastpass',
            name: ext.name || 'LastPass',
            extensionId: id,
            installed: true,
            enabled: Boolean(ext.enabled),
            version: ext.version,
          };
        } else if (VAULT_EXTENSIONS.onepassword.chromeIds.includes(id as any) || lname.includes('1password')) {
          managers['1password'] = {
            id: '1password',
            name: ext.name || '1Password',
            extensionId: id,
            installed: true,
            enabled: Boolean(ext.enabled),
            version: ext.version,
          };
        }
      }
    }
  } catch {}

  // 2. Inspect target tab DOM for LastPass / 1Password inline badges & login form state (CSP-safe)
  let pageLogin: Record<string, unknown> | null = null;
  if (opts.tabId && api?.scripting?.executeScript) {
    try {
      const [res] = await api.scripting.executeScript({
        target: { tabId: opts.tabId },
        world: 'MAIN',
        func: () => {
          const lpDom = Boolean(
            document.querySelector(
              '[data-lastpass-icon-root], [data-lastpass-root], iframe[src*="hdokiejnpimakedhajhdlcegeplioahd"], div[id^="__lpform_"]',
            ),
          );
          const opDom = Boolean(
            document.querySelector(
              'com-1password-button, com-1password-menu, [data-com-onepassword-filled], iframe[src*="aeblfdkhhhdcdjpifhhbdiojplfjncoa"]',
            ),
          );
          const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
          const pwInputs = inputs.filter((i) => i.type === 'password');
          const userInputs = inputs.filter((i) => {
            if (i.type === 'hidden' || i.type === 'password' || i.type === 'submit' || i.type === 'checkbox') return false;
            const hint = `${i.name} ${i.id} ${i.autocomplete} ${i.placeholder} ${i.getAttribute('aria-label') || ''}`.toLowerCase();
            return /user|email|login|identifier|handle|phone/.test(hint);
          });
          return {
            lastpassDetected: lpDom,
            onepasswordDetected: opDom,
            hasUsernameField: userInputs.length > 0,
            usernameFilled: userInputs.some((i) => i.value.length > 0),
            hasPasswordField: pwInputs.length > 0,
            passwordFilled: pwInputs.some((i) => i.value.length > 0),
          };
        },
      });
      if (res?.result) {
        pageLogin = res.result;
        if (res.result.lastpassDetected) {
          managers.lastpass.installed = true;
          managers.lastpass.enabled = true;
          managers.lastpass.detectedOnPage = true;
        }
        if (res.result.onepasswordDetected) {
          managers['1password'].installed = true;
          managers['1password'].enabled = true;
          managers['1password'].detectedOnPage = true;
        }
      }
    } catch {}
  }

  // 3. Check Hanzo KMS health & IAM token availability
  let kmsReady = false;
  let kmsAuthenticated = false;
  let kmsSecretCount: number | null = null;
  try {
    const h = await fetch(`${KMS_API_URL}/v1/kms/health`, { signal: AbortSignal.timeout(3000) });
    if (h.ok) {
      const hd = await h.json().catch(() => ({}));
      kmsReady = Boolean(hd.ready ?? true);
    }
  } catch {}

  if (opts.getToken) {
    try {
      const token = await opts.getToken();
      if (token) {
        kmsAuthenticated = true;
        try {
          const names = await kmsListSecrets(token, { org: opts.org });
          kmsSecretCount = names.length;
        } catch {}
      }
    } catch {}
  }

  return {
    managers: [managers.lastpass, managers['1password']],
    kms: {
      url: KMS_API_URL,
      ready: kmsReady,
      authenticated: kmsAuthenticated,
      secretCount: kmsSecretCount,
    },
    pageLogin,
  };
}

/**
 * Trigger / synchronize LastPass or 1Password autofill on the active login form in `tabId`
 * and synchronize React's `MAIN`-world `_valueTracker` on every filled field without
 * reading or returning any password/credential values.
 */
export async function autofillWithVault(
  api: any,
  tabId: number,
  params: { provider?: string; selector?: string; submit?: boolean | string } = {},
): Promise<Record<string, unknown>> {
  if (!api?.scripting?.executeScript) {
    throw new Error('scripting.executeScript unavailable');
  }
  const wantSubmit = params.submit === true || params.submit === 'true' || params.submit === '1';
  const preferred = String(params.provider || 'auto').toLowerCase();

  // Step 1: Wake inline LastPass / 1Password autofill icons by focusing target input(s),
  // optionally clicking inline autofill trigger if fields are still empty, then wait briefly
  const [wake] = await api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [preferred, params.selector || ''],
    func: (pref: string, sel: string) => {
      const targetInput = (sel ? document.querySelector(sel) : null) as HTMLInputElement | null;
      const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
      const visibleInputs = inputs.filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && i.type !== 'hidden' && i.type !== 'submit' && i.type !== 'checkbox';
      });
      const focusTarget = targetInput || visibleInputs.find((i) => i.type === 'password') || visibleInputs[0];
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
        focusTarget.dispatchEvent(new Event('focus', { bubbles: true }));
        focusTarget.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      }

      // Check if LastPass or 1Password inline button is present when fields are still blank
      let manager: 'lastpass' | '1password' | 'browser' = 'browser';
      if (document.querySelector('[data-lastpass-icon-root], [data-lastpass-root], iframe[src*="hdokiejnpimakedhajhdlcegeplioahd"]')) {
        manager = 'lastpass';
      } else if (document.querySelector('com-1password-button, [data-com-onepassword-filled], iframe[src*="aeblfdkhhhdcdjpifhhbdiojplfjncoa"]')) {
        manager = '1password';
      }
      if (pref === '1password' || pref === 'lastpass') manager = pref;
      return { focused: Boolean(focusTarget), manager };
    },
  });

  await new Promise((r) => setTimeout(r, 180));

  // Step 2: Sync MAIN-world React _valueTracker on all filled text/password inputs so
  // framework state matches whatever LastPass / 1Password / browser autofill wrote!
  const [synced] = await api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [wantSubmit],
    func: (doSubmit: boolean) => {
      const inputs = Array.from(document.querySelectorAll('input, textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>;
      let syncedCount = 0;
      let usernameFilled = false;
      let passwordFilled = false;

      for (const el of inputs) {
        const type = (el as HTMLInputElement).type || 'text';
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') continue;
        const val = el.value;
        if (!val) continue;
        if (type === 'password') passwordFilled = true;
        else usernameFilled = true;

        // Force React's MAIN-world _valueTracker to observe the transition without exposing `val`
        const tracker = (el as any)._valueTracker;
        if (tracker && typeof tracker.setValue === 'function') {
          tracker.setValue(`__hanzo_autofill_prev_${val.length}__`);
        }
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, val);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        syncedCount++;
      }

      let submitted = false;
      if (doSubmit && (usernameFilled || passwordFilled)) {
        const pw = inputs.find((i) => (i as HTMLInputElement).type === 'password' && i.value.length > 0);
        const form = pw?.form || inputs.find((i) => i.value.length > 0)?.form;
        if (form) {
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
          submitted = true;
        } else {
          const btn = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find((b) => {
            const r = b.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            const txt = (b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
            return /^(log\s*in|sign\s*in|continue|next|submit|authorize|connect)$/.test(txt);
          }) as HTMLElement | undefined;
          if (btn) {
            btn.click();
            submitted = true;
          }
        }
      }

      return {
        filled: usernameFilled || passwordFilled,
        usernameFilled,
        passwordFilled,
        syncedCount,
        submitted,
      };
    },
  });

  return {
    manager: wake?.result?.manager || 'browser',
    ...(synced?.result || { filled: false, usernameFilled: false, passwordFilled: false, syncedCount: 0, submitted: false }),
    redacted: true,
  };
}

/**
 * Inject a sealed Hanzo KMS secret directly into a DOM input in `tabId` inside the extension
 * worker — the secret plaintext NEVER returns to the MCP caller or LLM context.
 */
export async function fillFieldFromKms(
  api: any,
  tabId: number,
  token: string,
  params: { selector: string; name: string; path?: string; env?: string; org?: string; baseUrl?: string },
): Promise<Record<string, unknown>> {
  if (!token) throw new Error('Not authenticated with Hanzo IAM; sign in to read KMS secrets');
  if (!params.selector) throw new Error('selector required');
  if (!params.name) throw new Error('KMS secret name required');

  const ref: KmsSecretRef = {
    org: params.org,
    env: params.env || 'default',
    path: params.path,
    name: params.name,
  };
  const secretValue = await kmsGetSecret(token, ref, params.baseUrl);
  if (!secretValue) throw new Error(`KMS secret ${ref.path ? `${ref.path}/` : ''}${ref.name} is empty`);

  const [inj] = await api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [params.selector, secretValue],
    func: (sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return { ok: false, error: `No element matches ${sel}` };
      el.focus({ preventScroll: true });
      const tracker = (el as any)._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') {
        tracker.setValue('__hanzo_kms_prev__');
      }
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val);
      else el.value = val;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, tagName: el.tagName.toLowerCase() };
    },
  });

  if (!inj?.result?.ok) {
    throw new Error(inj?.result?.error || 'Failed to inject KMS secret into element');
  }

  return {
    filled: true,
    selector: params.selector,
    secret: `${ref.path ? `${ref.path}/` : ''}${ref.name}`,
    env: ref.env,
    redacted: true,
  };
}

/**
 * Capture an API key / token displayed or entered in `selector` on `tabId` and seal it
 * directly into Hanzo KMS (`/v1/kms/secrets`) without returning the value to the caller.
 */
export async function captureFieldToKms(
  api: any,
  tabId: number,
  token: string,
  params: { selector: string; name: string; path?: string; env?: string; org?: string; baseUrl?: string },
): Promise<Record<string, unknown>> {
  if (!token) throw new Error('Not authenticated with Hanzo IAM; sign in to seal KMS secrets');
  if (!params.selector || !params.name) throw new Error('selector and name are required');

  const [inj] = await api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [params.selector],
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLElement | null;
      if (!el) return { ok: false, error: `No element matches ${sel}` };
      const raw = ('value' in el && typeof (el as HTMLInputElement).value === 'string' && (el as HTMLInputElement).value)
        ? (el as HTMLInputElement).value
        : (el.textContent || '').trim();
      if (!raw) return { ok: false, error: `Element ${sel} has an empty value` };
      return { ok: true, value: raw };
    },
  });

  if (!inj?.result?.ok || !inj.result.value) {
    throw new Error(inj?.result?.error || 'Failed to capture field value');
  }

  const ref: KmsSecretRef = {
    org: params.org,
    env: params.env || 'default',
    path: params.path,
    name: params.name,
  };
  await kmsPutSecret(token, ref, String(inj.result.value), params.baseUrl);

  return {
    stored: true,
    secret: `${ref.path ? `${ref.path}/` : ''}${ref.name}`,
    env: ref.env,
    redacted: true,
  };
}

const KMS_TEMPLATE_RE = /\{\{kms:([^}]+)\}\}|\$KMS\{([^}]+)\}/g;

/**
 * Egress HTTP fetch with sealed KMS secret substitution (`{{kms:path/NAME}}` or `$KMS{path/NAME}`).
 * Resolves secrets inside the worker, executes the request, and scrubs all resolved secret values
 * from the returned body & headers so secrets never leak to the caller.
 */
export async function vaultEgressFetch(
  token: string,
  params: {
    url: string;
    method?: string;
    headers?: Record<string, string> | string;
    body?: string;
    env?: string;
    org?: string;
    baseUrl?: string;
  },
): Promise<Record<string, unknown>> {
  if (!params.url) throw new Error('url required');
  const rawHeaders: Record<string, string> = typeof params.headers === 'string'
    ? JSON.parse(params.headers)
    : { ...(params.headers || {}) };

  const resolvedSecrets = new Map<string, string>();
  const resolveTemplates = async (input: string): Promise<string> => {
    const matches = Array.from(input.matchAll(KMS_TEMPLATE_RE));
    if (matches.length === 0) return input;
    if (!token) throw new Error('Not authenticated with Hanzo IAM; cannot resolve {{kms:...}} templates');
    let out = input;
    for (const m of matches) {
      const coord = (m[1] || m[2] || '').trim();
      if (!coord) continue;
      let secretVal = resolvedSecrets.get(coord);
      if (secretVal === undefined) {
        const slash = coord.lastIndexOf('/');
        const path = slash >= 0 ? coord.slice(0, slash) : undefined;
        const name = slash >= 0 ? coord.slice(slash + 1) : coord;
        secretVal = await kmsGetSecret(token, { org: params.org, env: params.env || 'default', path, name }, params.baseUrl);
        resolvedSecrets.set(coord, secretVal);
      }
      out = out.split(m[0]).join(secretVal);
    }
    return out;
  };

  const finalUrl = await resolveTemplates(params.url);
  const finalHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    finalHeaders[k] = await resolveTemplates(String(v));
  }
  const finalBody = params.body !== undefined ? await resolveTemplates(String(params.body)) : undefined;

  const scrub = (s: string): string => {
    let clean = s;
    for (const val of resolvedSecrets.values()) {
      if (val && val.length >= 4) clean = clean.split(val).join('[REDACTED_KMS_SECRET]');
    }
    return clean;
  };

  const resp = await fetch(finalUrl, {
    method: params.method || 'GET',
    headers: finalHeaders,
    body: finalBody,
  });

  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    if (!/^(set-cookie|authorization)$/i.test(k)) respHeaders[k] = scrub(v);
  });
  const text = scrub(await resp.text());
  return {
    ok: resp.ok,
    status: resp.status,
    headers: respHeaders,
    body: text.length > 100_000 ? `${text.slice(0, 100_000)}...(truncated)` : text,
    injectedSecrets: Array.from(resolvedSecrets.keys()),
  };
}

/**
 * 1-click Hanzo Post / Social setup (`post.setup`):
 * - Checks password vaults (LastPass + 1Password + Hanzo KMS)
 * - Detects all logged-in social browser sessions
 * - Syncs connected sessions to `/v1/social/accounts`
 * - Returns ready-to-click `/v1/provider/<network>/authorize` URLs for OAuth PKCE channels
 */
export async function setupHanzoPost(
  api: any,
  opts: { tabId?: number | null; token?: string | null; org?: string; apiEndpoint?: string },
): Promise<Record<string, unknown>> {
  const endpoint = (opts.apiEndpoint || API_BASE_URL).replace(/\/+$/, '');
  const vault = await getVaultStatus(api, {
    tabId: opts.tabId,
    getToken: async () => opts.token || null,
    org: opts.org,
  });
  const sync = await syncSocialAccounts({
    apiEndpoint: endpoint,
    token: opts.token || undefined,
  });

  let accounts: any[] = [];
  if (opts.token) {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
      if (opts.org) headers['X-Hanzo-Org'] = opts.org;
      const res = await fetch(`${endpoint}/v1/social/accounts`, { headers });
      if (res.ok) {
        const data = await res.json();
        accounts = Array.isArray(data) ? data : (data.accounts || []);
      }
    } catch {}
  }

  const authenticatedProviders = sync.sessions.filter((s) => s.authenticated).map((s) => s.provider);
  const connectedIds = new Set(accounts.filter((a) => a.connected || a.status === 'connected').map((a) => a.provider || a.network));
  const oauthAuthorizeUrls: Record<string, string> = {};
  for (const p of ['x', 'linkedin', 'youtube', 'instagram', 'threads', 'tiktok', 'reddit', 'facebook']) {
    if (!connectedIds.has(p)) {
      oauthAuthorizeUrls[p] = `${endpoint}/v1/provider/${p}/authorize?redirect_uri=${encodeURIComponent('https://post.hanzo.ai/accounts')}`;
    }
  }

  return {
    vault,
    browserAuthenticatedProviders: authenticatedProviders,
    syncedCount: sync.synced,
    connectedAccounts: accounts.map((a) => ({
      id: a.id,
      provider: a.provider || a.network,
      handle: a.handle,
      name: a.name,
      connected: Boolean(a.connected ?? a.status === 'connected'),
    })),
    oauthAuthorizeUrls,
  };
}
