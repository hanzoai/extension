/**
 * Native LastPass Automation for Hanzo Browser Extension.
 *
 * Handles ZAP & extension commands:
 *   - `lastpass.status`   extension + vault tab + cookie-name-only session check
 *   - `lastpass.openIcon` click visible `[data-lastpass-icon-root]` shadow button/svg
 *   - `lastpass.accounts` list vault site metadata ONLY (`id`, `name`, `username`, `url`, `group`)
 *   - `lastpass.fill`     read matching credential inside background worker from signed-in
 *                         `https://lastpass.com` tab and fill target `tabId` via `act({ op: 'fill' })`
 *
 * SECURITY INVARIANT: Plaintext passwords and cookie values NEVER cross ZAP,
 * NEVER return from any exported function, and NEVER touch logs or disk.
 */

import { drive } from './drive.js';
import { parseTabId } from './tab-id.js';

export const LASTPASS_EXTENSION_ID = 'hdokiejnpimakedhajhdlcegeplioahd';

export const LASTPASS_METHODS = new Set([
  'lastpass.status',
  'lastpass.openIcon',
  'lastpass.accounts',
  'lastpass.fill',
]);

export interface LastPassAccountSummary {
  id: string;
  name: string;
  username: string;
  url: string;
  group: string;
}

interface InternalVaultEntry extends LastPassAccountSummary {
  secret?: string;
}

const AUTH_COOKIE_NAMES = new Set(['PHPSESSID', 'lpsession', 'LPMS']);

const flag = (v: unknown): boolean =>
  v === true || v === 1 || (typeof v === 'string' && /^(true|1)$/i.test(v));

const str = (v: unknown): string | undefined =>
  v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isLastPassVaultUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' && (u.hostname === 'lastpass.com' || u.hostname.endsWith('.lastpass.com'));
  } catch {
    return false;
  }
}

function hostKey(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().toLowerCase();
  let host = trimmed;
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    host = u.hostname.toLowerCase();
  } catch {
    host = trimmed.split('/')[0].split(':')[0];
  }
  host = host.replace(/^www\./, '');
  if (host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x.com';
  if (host.endsWith('.x.com')) return 'x.com';
  const parts = host.split('.');
  if (parts.length > 2) return parts.slice(-2).join('.');
  return host;
}

function matchesAccount(
  entry: LastPassAccountSummary,
  criteria: { id?: string; url?: string; domain?: string; username?: string; name?: string; query?: string },
): number {
  if (criteria.id && entry.id !== criteria.id) return 0;

  const wantDomain = hostKey(criteria.domain || criteria.url);
  const entryDomain = hostKey(entry.url);
  const entryNameLower = entry.name.toLowerCase();
  const entryUserLower = entry.username.toLowerCase();
  const entryUrlLower = entry.url.toLowerCase();

  let score = 1;

  if (wantDomain) {
    const domainMatches =
      entryDomain === wantDomain ||
      entryUrlLower.includes(wantDomain) ||
      (wantDomain === 'x.com' && (entryUrlLower.includes('twitter.com') || entryNameLower === 'twitter' || entryNameLower === 'x')) ||
      entryNameLower.includes(wantDomain.split('.')[0]);
    if (!domainMatches) return 0;
    score += entryDomain === wantDomain ? 10 : 5;
  }

  if (criteria.username) {
    const wantUser = criteria.username.toLowerCase().replace(/^@/, '');
    const normUser = entryUserLower.replace(/^@/, '');
    if (normUser === wantUser) score += 10;
    else if (normUser.includes(wantUser)) score += 5;
    else return 0;
  }

  if (criteria.name) {
    const wantName = criteria.name.toLowerCase();
    if (entryNameLower === wantName) score += 8;
    else if (entryNameLower.includes(wantName) || entryUserLower.includes(wantName)) score += 4;
    else return 0;
  }

  if (criteria.query) {
    const q = criteria.query.toLowerCase().replace(/^@/, '');
    const qHost = hostKey(q);
    const hay = `${entryNameLower} ${entryUserLower} ${entryUrlLower} ${entry.group.toLowerCase()}`;
    if (hay.includes(q) || (qHost && entryDomain === qHost)) score += 6;
    else return 0;
  }

  return score;
}

function sanitizeSummary(e: LastPassAccountSummary): LastPassAccountSummary {
  return {
    id: String(e.id || ''),
    name: String(e.name || ''),
    username: String(e.username || ''),
    url: String(e.url || ''),
    group: String(e.group || ''),
  };
}

async function resolveTargetTabId(api: any, params: Record<string, unknown>): Promise<number> {
  const explicit = parseTabId(params.tabId ?? params.targetId);
  if (explicit !== null) return explicit;
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  if (tabs?.[0]?.id !== undefined) return tabs[0].id;
  const all = await api.tabs.query({});
  const firstHttp = all?.find((t: any) => typeof t.id === 'number' && /^https?:/i.test(t.url || '') && !isLastPassVaultUrl(t.url));
  if (firstHttp?.id !== undefined) return firstHttp.id;
  if (all?.[0]?.id !== undefined) return all[0].id;
  throw new Error('No active tab');
}

async function findOrOpenVaultTab(api: any, openIfNeeded: boolean): Promise<number | null> {
  const tabs: any[] = (await api.tabs.query({})) || [];
  const vaultTabs = tabs.filter((t) => typeof t.id === 'number' && isLastPassVaultUrl(t.url));
  const preferred =
    vaultTabs.find((t) => /[?&]ac=1\b|\/vault\b/i.test(String(t.url || ''))) ||
    vaultTabs[0];
  if (preferred?.id !== undefined) return preferred.id;

  if (!openIfNeeded || !api.tabs?.create) return null;

  const created = await api.tabs.create({ url: 'https://lastpass.com/?ac=1', active: false });
  if (typeof created?.id !== 'number') return null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const cur = await api.tabs.get(created.id);
      if (cur?.status === 'complete') break;
    } catch {
      break;
    }
    await sleep(150);
  }
  return created.id;
}

/**
 * Self-contained MAIN-world extractor executed ONLY on `https://lastpass.com/*`.
 * Zero outer closure references so `scripting.executeScript` serializes it cleanly.
 */
function extractVaultEntriesInPage(includeSecret: boolean): InternalVaultEntry[] {
  const w = globalThis as any;
  const results: InternalVaultEntry[] = [];
  const seen = new Set<string>();

  const pushEntry = (raw: any) => {
    if (!raw || typeof raw !== 'object') return;
    const data = raw._data && typeof raw._data === 'object' ? raw._data : raw;
    const id = String(
      data.aid ?? data.id ?? raw.aid ?? raw.id ?? (typeof raw.getID === 'function' ? raw.getID() : '') ?? '',
    ).trim();
    const name = String(
      data.name ?? raw.name ?? (typeof raw.getName === 'function' ? raw.getName() : '') ?? '',
    ).trim();
    const username = String(
      data.un ?? data.username ?? raw.un ?? raw.username ?? (typeof raw.getUsername === 'function' ? raw.getUsername() : '') ?? '',
    ).trim();
    const url = String(
      data.url ?? raw.url ?? (typeof raw.getURL === 'function' ? raw.getURL() : '') ?? '',
    ).trim();
    const group = String(
      data.group ?? data.groupName ?? raw.group ?? (typeof raw.getGroupName === 'function' ? raw.getGroupName() : '') ?? '',
    ).trim();

    if (!name && !url && !username) return;
    const dedupeKey = id || `${name}|${username}|${url}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const item: InternalVaultEntry = { id: id || dedupeKey, name, username, url, group };
    if (includeSecret) {
      let pw = '';
      try {
        if (typeof raw.getPassword === 'function') pw = String(raw.getPassword() ?? '');
        else if (typeof data.password === 'string') pw = data.password;
        else if (typeof data.pw === 'string') pw = data.pw;
        else if (typeof raw.password === 'string') pw = raw.password;
        else if (typeof raw.pw === 'string') pw = raw.pw;
        else if (id && typeof w.LPProxy?.getSitePassword === 'function') pw = String(w.LPProxy.getSitePassword(id) ?? '');
      } catch { /* ignore */ }
      if (pw) item.secret = pw;
    }
    results.push(item);
  };

  try {
    const lp = w.LPProxy;
    if (lp) {
      const lists = [
        typeof lp.getSites === 'function' ? lp.getSites() : null,
        typeof lp.getModels === 'function' ? lp.getModels('Site') : null,
        lp.sites,
      ];
      for (const list of lists) {
        if (!list) continue;
        if (Array.isArray(list)) list.forEach(pushEntry);
        else if (typeof list === 'object') Object.values(list).forEach(pushEntry);
      }
    }
  } catch { /* ignore */ }

  try {
    const gs = w.g_sites;
    if (gs) {
      if (Array.isArray(gs)) gs.forEach(pushEntry);
      else if (typeof gs === 'object') Object.values(gs).forEach(pushEntry);
    }
  } catch { /* ignore */ }

  if (typeof document !== 'undefined' && document.querySelectorAll) {
    const cards = Array.from(
      document.querySelectorAll('.vault-item, [data-automation-id="vault-item"], .site-card, .itemTile, [data-aid]'),
    );
    for (const card of cards) {
      const id = (card.getAttribute('data-aid') || card.getAttribute('data-id') || card.id || '').trim();
      const nameEl = card.querySelector('.item-name, .site-name, .name, [data-automation-id="item-name"], h3, h4');
      const userEl = card.querySelector('.item-username, .username, [data-automation-id="item-username"]');
      const groupEl = card.querySelector('.item-group, .group');
      const name = (card.getAttribute('data-name') || nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
      const username = (card.getAttribute('data-username') || userEl?.textContent || '').replace(/\s+/g, ' ').trim();
      const url = (card.getAttribute('data-url') || card.querySelector('a[href]')?.getAttribute('href') || '').trim();
      const group = (card.getAttribute('data-group') || groupEl?.textContent || '').replace(/\s+/g, ' ').trim();
      const entry: any = { id, name, username, url, group };
      if (includeSecret) {
        const pwInput = card.querySelector('input[type="password"], input[name="password"]') as HTMLInputElement | null;
        if (pwInput?.value) entry.password = pwInput.value;
      }
      pushEntry(entry);
    }
  }

  return results;
}

async function readVaultEntries(api: any, vaultTabId: number, includeSecret: boolean): Promise<InternalVaultEntry[]> {
  let framesResult: any[] = [];
  try {
    framesResult = await api.scripting.executeScript({
      target: { tabId: vaultTabId, allFrames: true },
      world: 'MAIN',
      func: extractVaultEntriesInPage,
      args: [includeSecret],
    });
  } catch {
    try {
      framesResult = await api.scripting.executeScript({
        target: { tabId: vaultTabId },
        func: extractVaultEntriesInPage,
        args: [includeSecret],
      });
    } catch {
      framesResult = [];
    }
  }

  const merged: InternalVaultEntry[] = [];
  const seen = new Set<string>();
  for (const frame of framesResult || []) {
    const arr = Array.isArray(frame?.result) ? frame.result : [];
    for (const item of arr) {
      const key = item.id || `${item.name}|${item.username}|${item.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }
  return merged;
}

export async function lastPassStatus(api: any, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const tabs: any[] = (await api.tabs?.query?.({})) || [];
  const vaultTab =
    tabs.find((t) => isLastPassVaultUrl(t.url) && /[?&]ac=1\b|\/vault\b/i.test(String(t.url || ''))) ||
    tabs.find((t) => isLastPassVaultUrl(t.url));

  let extensionDetected = tabs.some((t) => String(t.url || '').startsWith(`chrome-extension://${LASTPASS_EXTENSION_ID}/`));
  if (!extensionDetected && typeof api.management?.get === 'function') {
    try {
      const info = await api.management.get(LASTPASS_EXTENSION_ID);
      if (info?.enabled !== false) extensionDetected = true;
    } catch { /* management permission optional */ }
  }

  const cookieNames: string[] = [];
  if (api.cookies?.getAll) {
    try {
      const cookies = await api.cookies.getAll({ domain: 'lastpass.com' });
      const seen = new Set<string>();
      for (const c of cookies || []) {
        if (c?.name && !seen.has(c.name)) {
          seen.add(c.name);
          cookieNames.push(String(c.name));
        }
      }
    } catch { /* ignore */ }
  }

  let iconDetectedOnTab = false;
  const explicitTab = parseTabId(params.tabId ?? params.targetId);
  const candidateTabs = explicitTab !== null
    ? [{ id: explicitTab }]
    : tabs.filter((t) => typeof t.id === 'number' && /^https?:/i.test(t.url || '') && !isLastPassVaultUrl(t.url)).slice(0, 5);

  if (api.scripting?.executeScript) {
    for (const t of candidateTabs) {
      try {
        const [res] = await api.scripting.executeScript({
          target: { tabId: t.id },
          func: () => Boolean(
            document.querySelector(
              '[data-lastpass-icon-root], [data-lastpass-root], iframe[src*="hdokiejnpimakedhajhdlcegeplioahd"]',
            ),
          ),
          args: [],
        });
        if (res?.result) {
          iconDetectedOnTab = true;
          extensionDetected = true;
          break;
        }
      } catch { /* unscriptable tab */ }
    }
  }

  const hasAuthCookie = cookieNames.some((n) => AUTH_COOKIE_NAMES.has(n));
  let vaultSignedIn = hasAuthCookie;
  if (!vaultSignedIn && vaultTab?.id !== undefined) {
    if (/[?&]ac=1\b|\/vault\b/i.test(String(vaultTab.url || ''))) {
      vaultSignedIn = true;
    } else {
      const entries = await readVaultEntries(api, vaultTab.id, false);
      if (entries.length > 0) vaultSignedIn = true;
    }
  }

  return {
    extensionId: LASTPASS_EXTENSION_ID,
    extensionDetected,
    iconDetectedOnTab,
    vaultTabOpen: Boolean(vaultTab),
    ...(vaultTab?.id !== undefined ? { vaultTabId: vaultTab.id } : {}),
    vaultSignedIn,
    cookieNames,
  };
}

export async function lastPassOpenIcon(api: any, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const tabId = await resolveTargetTabId(api, params);
  const fieldSelector = str(params.fieldSelector ?? params.selector);

  const [prep] = await api.scripting.executeScript({
    target: { tabId },
    func: (sel: string | null) => {
      document.querySelectorAll('[data-hanzo-lp-icon]').forEach((el) => el.removeAttribute('data-hanzo-lp-icon'));
      if (sel) {
        const field = document.querySelector(sel) as HTMLElement | null;
        field?.focus?.();
      }
      let hosts = Array.from(document.querySelectorAll('[data-lastpass-icon-root]'));
      if (hosts.length === 0) {
        const input = document.querySelector(
          'input[type="password"], input[autocomplete*="username"], input[name="text"], input[type="email"], input[type="text"]',
        ) as HTMLElement | null;
        input?.focus?.();
        hosts = Array.from(document.querySelectorAll('[data-lastpass-icon-root]'));
      }
      const visible = hosts.find((h) => {
        const r = h.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }) || hosts[0];
      if (!visible) return { found: false };
      visible.setAttribute('data-hanzo-lp-icon', '1');
      const dom = (globalThis as any).chrome?.dom;
      const sr = (typeof (visible as any).openOrClosedShadowRoot === 'function'
        ? (visible as any).openOrClosedShadowRoot()
        : dom?.openOrClosedShadowRoot?.(visible)) ?? visible.shadowRoot;
      if (sr?.querySelector?.('button')) return { found: true, selector: '[data-hanzo-lp-icon="1"] >>> button' };
      if (sr?.querySelector?.('svg')) return { found: true, selector: '[data-hanzo-lp-icon="1"] >>> svg' };
      return { found: true, selector: '[data-hanzo-lp-icon="1"]' };
    },
    args: [fieldSelector ?? null],
  });

  if (!prep?.result?.found) {
    throw new Error('No visible LastPass in-field icon ([data-lastpass-icon-root]) found on tab');
  }

  const targetSelector: string = prep.result.selector;
  try {
    const res = await drive(api, tabId, 'hanzo.act', { op: 'click', selector: targetSelector });
    return {
      success: true,
      tabId,
      selector: targetSelector,
      clicked: res.clicked ?? targetSelector,
    };
  } finally {
    await api.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.querySelectorAll('[data-hanzo-lp-icon]').forEach((el) => el.removeAttribute('data-hanzo-lp-icon'));
      },
      args: [],
    }).catch(() => {});
  }
}

export async function lastPassAccounts(api: any, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const vaultTabId = await findOrOpenVaultTab(api, flag(params.openVaultIfNeeded));
  if (vaultTabId === null) {
    return { accounts: [], vaultTabOpen: false };
  }

  const rawEntries = await readVaultEntries(api, vaultTabId, false);
  const criteria = {
    id: str(params.id),
    url: str(params.url),
    domain: str(params.domain),
    username: str(params.username),
    name: str(params.name),
    query: str(params.query),
  };

  const accounts = rawEntries
    .map((entry) => ({ entry, score: matchesAccount(entry, criteria) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => sanitizeSummary(x.entry));

  return {
    accounts,
    vaultTabOpen: true,
    vaultTabId,
  };
}

export async function lastPassFill(api: any, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const tabId = await resolveTargetTabId(api, params);
  const targetTab = await api.tabs.get(tabId);
  const vaultTabId = await findOrOpenVaultTab(api, flag(params.openVaultIfNeeded));
  if (vaultTabId === null) {
    throw new Error('No signed-in https://lastpass.com vault tab open. Open https://lastpass.com/?ac=1 or pass openVaultIfNeeded=true.');
  }

  const entries = await readVaultEntries(api, vaultTabId, true);
  const criteria = {
    id: str(params.id),
    url: str(params.url) ?? (targetTab?.url && /^https?:/i.test(targetTab.url) ? String(targetTab.url) : undefined),
    domain: str(params.domain),
    username: str(params.username),
    name: str(params.name),
    query: str(params.query),
  };

  const ranked = entries
    .map((entry) => ({ entry, score: matchesAccount(entry, criteria) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    throw new Error('No matching LastPass vault account found for target site/query');
  }

  const chosen = ranked[0].entry;
  const matched = sanitizeSummary(chosen);
  let secretValue = chosen.secret || '';

  const explicitUserSel = str(params.usernameSelector);
  const explicitPassSel = str(params.passwordSelector);

  const [fields] = await api.scripting.executeScript({
    target: { tabId },
    func: (uSel: string | null, pSel: string | null) => {
      document.querySelectorAll('[data-hanzo-lp-user],[data-hanzo-lp-pass]').forEach((el) => {
        el.removeAttribute('data-hanzo-lp-user');
        el.removeAttribute('data-hanzo-lp-pass');
      });
      const isVisibleWritable = (el: Element | null): el is HTMLInputElement => {
        if (!el || el.tagName.toLowerCase() !== 'input') return false;
        const inp = el as HTMLInputElement;
        if (inp.disabled || inp.readOnly || inp.type === 'hidden') return false;
        const r = inp.getBoundingClientRect();
        const cs = window.getComputedStyle(inp);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0 || !(inp as any).offsetParent === false);
      };

      let userEl: HTMLInputElement | null = uSel ? (document.querySelector(uSel) as HTMLInputElement | null) : null;
      let passEl: HTMLInputElement | null = pSel ? (document.querySelector(pSel) as HTMLInputElement | null) : null;

      const allInputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
      if (!passEl) {
        passEl = allInputs.find((i) => i.type === 'password' && isVisibleWritable(i))
          || allInputs.find((i) => i.type === 'password' && !i.disabled && !i.readOnly)
          || null;
      }
      if (!userEl) {
        const candidates = allInputs.filter(
          (i) => i !== passEl && ['text', 'email', 'tel', 'search', ''].includes((i.type || 'text').toLowerCase()) && !i.disabled && !i.readOnly,
        );
        const scoreInput = (i: HTMLInputElement): number => {
          const attrs = `${i.name} ${i.id} ${i.autocomplete} ${i.placeholder} ${i.getAttribute('aria-label') || ''}`.toLowerCase();
          let s = isVisibleWritable(i) ? 10 : 1;
          if (attrs.includes('username') || attrs.includes('user') || attrs.includes('login') || attrs.includes('email') || i.name === 'text') s += 10;
          return s;
        };
        candidates.sort((a, b) => scoreInput(b) - scoreInput(a));
        userEl = candidates[0] || null;
      }

      if (userEl && !uSel) userEl.setAttribute('data-hanzo-lp-user', '1');
      if (passEl && !pSel) passEl.setAttribute('data-hanzo-lp-pass', '1');

      return {
        userSelector: userEl ? (uSel || '[data-hanzo-lp-user="1"]') : null,
        passSelector: passEl ? (pSel || '[data-hanzo-lp-pass="1"]') : null,
      };
    },
    args: [explicitUserSel ?? null, explicitPassSel ?? null],
  });

  let filledUsername = false;
  let filledPassword = false;

  try {
    const userSelector: string | null = fields?.result?.userSelector ?? null;
    const passSelector: string | null = fields?.result?.passSelector ?? null;

    if (userSelector && matched.username) {
      await drive(api, tabId, 'hanzo.act', { op: 'fill', selector: userSelector, text: matched.username });
      filledUsername = true;
    }
    if (passSelector && secretValue) {
      await drive(api, tabId, 'hanzo.act', { op: 'fill', selector: passSelector, text: secretValue });
      filledPassword = true;
    }
  } finally {
    secretValue = '';
    for (const e of entries) delete e.secret;
    await api.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.querySelectorAll('[data-hanzo-lp-user],[data-hanzo-lp-pass]').forEach((el) => {
          el.removeAttribute('data-hanzo-lp-user');
          el.removeAttribute('data-hanzo-lp-pass');
        });
      },
      args: [],
    }).catch(() => {});
  }

  if (!filledUsername && !filledPassword) {
    throw new Error('No writable username or password fields could be filled on target tab');
  }

  return {
    success: true,
    tabId,
    matched,
    filledUsername,
    filledPassword,
  };
}

export async function handleLastPass(api: any, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  switch (method) {
    case 'lastpass.status':
      return lastPassStatus(api, params);
    case 'lastpass.openIcon':
      return lastPassOpenIcon(api, params);
    case 'lastpass.accounts':
      return lastPassAccounts(api, params);
    case 'lastpass.fill':
      return lastPassFill(api, params);
  }
  throw new Error(`Unknown LastPass method: ${method}`);
}
