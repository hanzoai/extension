// The SPA glue. Wires the DOM to: Clio sign-in (redirect to Clio's authorize
// URL via the token service), loading a matter + its documents, running the four
// Hanzo actions, and writing the result back to Clio. The logic-heavy parts
// (oauth URL, api request shaping, context assembly, chat, custom-action parse)
// live in their tested modules; this is the thin binding.
//
// Credentials:
//  - Clio: the OAuth token is obtained server-side (token service) and returned
//    to the app; kept in sessionStorage for the tab's lifetime, refreshed via
//    the service. The client_secret is NEVER here.
//  - Hanzo: an `hk-` key pasted by the user (kept in localStorage), or empty
//    (anonymous/limited). Same contract as @hanzo/office-addin.

/* global window, document, sessionStorage, localStorage, crypto */

import { clioBase, DEFAULT_CLIO_REGION, DEFAULT_MODEL, type ClioRegion } from './config.js';
import { oauthAuthorizeUrl, isExpired, type TokenSet } from './clio-oauth.js';
import {
  listMatters,
  getMatter,
  listDocuments,
  downloadDocument,
  clioFetch,
  clioDownload,
  unwrapData,
} from './clio-api.js';
import { listModels } from './hanzo-chat.js';
import {
  runAction,
  writeBack,
  noteSubject,
  isTextExtractable,
  type ActionId,
  type MatterContext,
  type WriteTarget,
} from './actions.js';
import { parseCustomAction } from './custom-action.js';

// The token service origin (this app's own backend). Same-origin in production
// (clio.hanzo.ai serves both the static SPA and the service via ingress).
const SERVICE = ''; // '' → same origin

// The Clio Developer App's public client_id and redirect. The client_id is
// public (it identifies the app in the authorize URL); only the SECRET is
// server-side. These are stamped at build time via esbuild `define`.
declare const CLIO_CLIENT_ID: string;
declare const CLIO_REDIRECT_URI: string;
declare const CLIO_REGION: string;

const region: ClioRegion = (CLIO_REGION as ClioRegion) || DEFAULT_CLIO_REGION;
const base = clioBase(region);

// ── credential storage ────────────────────────────────────────────────────
const CLIO_TOKEN_KEY = 'hanzo.clio.tokens';
const HANZO_KEY = 'hanzo.apiKey';
const STATE_KEY = 'hanzo.clio.oauthState';

function clioTokens(): TokenSet | null {
  const raw = sessionStorage.getItem(CLIO_TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}
function hanzoKey(): string {
  return localStorage.getItem(HANZO_KEY) || '';
}

// ── Clio calls through the app (bearer added here) ────────────────────────
// The SPA holds the Clio access token in-tab and calls Clio directly with it
// (the SECRET is never involved in a REST call, only in the token grant).
// clioToken() is the current access token; ensureClioToken() refreshes it via
// the token service (which holds the secret) when it is at/near expiry, so a
// long matter session never fails mid-flight on a stale token.
function clioToken(): string {
  return clioTokens()?.accessToken || '';
}

async function ensureClioToken(): Promise<string> {
  const t = clioTokens();
  if (!t || !t.refreshToken || !isExpired(t)) return t?.accessToken || '';
  const resp = await fetch(`${SERVICE}/oauth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: t.refreshToken }),
  });
  if (!resp.ok) return t.accessToken; // let the call fail with Clio's own 401
  const next: TokenSet = await resp.json();
  sessionStorage.setItem(CLIO_TOKEN_KEY, JSON.stringify(next));
  return next.accessToken;
}

async function loadMatterContext(matterId: number, nonce = ''): Promise<MatterContext> {
  const token = await ensureClioToken();
  // The first authenticated call carries the Custom Action nonce (if any) so
  // Clio validates the click server-side — a bad/stale nonce makes this 403.
  const matter = unwrapData<any>(await clioFetch(getMatter(token, base, matterId, undefined, nonce)));
  const docsResp = await clioFetch(listDocuments({ token, base, matterId, limit: 25 }));
  const docs = unwrapData<any[]>(docsResp) || [];

  // Pull text only for text-extractable documents; a binary (PDF/DOCX) would
  // download as mojibake, so keep just its name so the model knows it exists.
  const documents: Array<{ name: string; text: string }> = [];
  for (const d of docs.slice(0, 10)) {
    const name = d.name || `document ${d.id}`;
    if (!isTextExtractable(d.content_type)) {
      documents.push({ name, text: `(binary document — ${d.content_type || 'unknown type'}, not extracted)` });
      continue;
    }
    let text = '';
    try {
      text = await clioDownload(downloadDocument(token, base, d.id));
    } catch {
      text = '(document content unavailable)';
    }
    documents.push({ name, text });
  }

  return {
    displayNumber: matter.display_number,
    description: matter.description,
    status: matter.status,
    clientName: matter.client?.name,
    practiceArea: matter.practice_area?.name,
    responsibleAttorney: matter.responsible_attorney?.name,
    openDate: matter.open_date,
    documents,
  };
}

// ── boot ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const params = new URLSearchParams(window.location.search);

  const statusEl = $('status');
  const outputEl = $('output') as HTMLTextAreaElement;
  const matterEl = $('matter') as HTMLSelectElement;
  const modelEl = $('model') as HTMLSelectElement;
  const detailEl = $('detail') as HTMLInputElement;
  const targetEl = $('target') as HTMLSelectElement;
  const apiKeyEl = $('apikey') as HTMLInputElement;
  const signInBtn = $('signin') as HTMLButtonElement;
  const writeBtn = $('writeback') as HTMLButtonElement;
  const actionBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.action'));

  let currentMatterId = 0;
  let currentMatterLabel = '';
  let currentOutput = '';
  let lastAction: ActionId = 'summarize';
  // A Custom Action deep-link's single-use nonce — consumed on the first Clio
  // call (Clio validates it server-side, once), then cleared.
  let deepLinkNonce = params.get('custom_action_nonce') || '';

  function setStatus(msg: string, kind: 'ok' | 'warn' | 'error' | '' = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + kind;
  }

  // OAuth callback landing: Clio redirected back with ?code=&state=. Exchange it
  // via the token service (which holds the secret), store the token set.
  async function maybeHandleOAuthCallback(): Promise<boolean> {
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return false;
    if (state !== sessionStorage.getItem(STATE_KEY)) {
      setStatus('OAuth state mismatch — sign in again.', 'error');
      return true;
    }
    setStatus('Completing Clio sign-in…');
    const resp = await fetch(`${SERVICE}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const tokens = await resp.json();
    if (!resp.ok) {
      setStatus(tokens?.error || 'Clio sign-in failed.', 'error');
      return true;
    }
    sessionStorage.setItem(CLIO_TOKEN_KEY, JSON.stringify(tokens));
    // Drop the code/state from the URL so a refresh doesn't re-exchange.
    window.history.replaceState({}, '', window.location.pathname);
    setStatus('Signed in to Clio.', 'ok');
    return true;
  }

  signInBtn.onclick = () => {
    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    window.location.href = oauthAuthorizeUrl({
      base,
      clientId: CLIO_CLIENT_ID,
      redirectUri: CLIO_REDIRECT_URI,
      state,
    });
  };

  apiKeyEl.value = hanzoKey();
  apiKeyEl.onchange = () => {
    const k = apiKeyEl.value.trim();
    if (k) localStorage.setItem(HANZO_KEY, k);
    else localStorage.removeItem(HANZO_KEY);
  };

  async function populateMatters() {
    if (!clioToken()) return;
    try {
      const resp = await clioFetch(listMatters({ token: clioToken(), base, status: 'open', limit: 50 }));
      const matters = unwrapData<any[]>(resp) || [];
      matterEl.innerHTML = '';
      for (const m of matters) {
        const opt = document.createElement('option');
        opt.value = String(m.id);
        opt.textContent = `${m.display_number || m.id} — ${m.description || ''}`.trim();
        matterEl.appendChild(opt);
      }
      if (currentMatterId) matterEl.value = String(currentMatterId);
      else if (matters[0]) selectMatter(matters[0].id, matterEl.options[0]?.textContent || '');
    } catch (e: any) {
      setStatus(e?.message || 'Could not load matters.', 'error');
    }
  }

  function selectMatter(id: number, label: string) {
    currentMatterId = id;
    currentMatterLabel = label;
  }
  matterEl.onchange = () => selectMatter(Number(matterEl.value), matterEl.selectedOptions[0]?.textContent || '');

  async function populateModels() {
    try {
      const ids = (await listModels(hanzoKey())).sort();
      if (!ids.length) return;
      modelEl.innerHTML = '';
      for (const id of ids) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        modelEl.appendChild(opt);
      }
      modelEl.value = ids.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : ids[0];
    } catch {
      modelEl.innerHTML = `<option value="${DEFAULT_MODEL}">${DEFAULT_MODEL}</option>`;
    }
  }

  async function run(id: ActionId) {
    if (!currentMatterId) {
      setStatus('Pick a matter first.', 'warn');
      return;
    }
    for (const b of actionBtns) b.disabled = true;
    writeBtn.disabled = true;
    outputEl.value = '';
    try {
      setStatus('Loading matter & documents from Clio…');
      const context = await loadMatterContext(currentMatterId, deepLinkNonce);
      deepLinkNonce = ''; // single-use — do not replay
      setStatus('Asking Hanzo…');
      currentOutput = await runAction({
        id,
        detail: detailEl.value,
        context,
        hanzoToken: hanzoKey(),
        chatOpts: { model: modelEl.value || DEFAULT_MODEL },
      });
      outputEl.value = currentOutput;
      writeBtn.disabled = !currentOutput;
      setStatus('Done — review, then write back to Clio.', 'ok');
    } catch (e: any) {
      setStatus(e?.message || String(e), 'error');
    } finally {
      for (const b of actionBtns) b.disabled = false;
    }
  }

  // Wire each action button once. Remember which action produced the current
  // output so the write-back note gets the right subject.
  for (const b of actionBtns) {
    b.onclick = () => {
      lastAction = b.dataset.action as ActionId;
      void run(lastAction);
    };
  }

  writeBtn.onclick = async () => {
    const body = outputEl.value.trim();
    if (!body || !currentMatterId) return;
    try {
      setStatus('Writing back to Clio…');
      await writeBack({
        target: (targetEl.value as WriteTarget) || 'note',
        token: clioToken(),
        base,
        matterId: currentMatterId,
        subject: noteSubject(lastAction, currentMatterLabel),
        body,
      });
      setStatus(`Saved to Clio as a ${targetEl.value}.`, 'ok');
    } catch (e: any) {
      setStatus(e?.message || String(e), 'error');
    }
  };

  // ── init ────────────────────────────────────────────────────────────────
  (async () => {
    const handled = await maybeHandleOAuthCallback();
    // Custom Action deep-link: Clio (via the token service redirect) lands here
    // with ?matter_id=…, or with the raw subject_url params. Resolve the matter.
    const ca = parseCustomAction(params);
    const deepMatter = Number(params.get('matter_id')) || ca.matterId || 0;
    if (deepMatter) {
      selectMatter(deepMatter, '');
      if (clioToken()) {
        try {
          // First authenticated call — replay the single-use nonce for Clio's
          // server-side validation of the Custom Action click, then clear it.
          const token = await ensureClioToken();
          const m = unwrapData<any>(await clioFetch(getMatter(token, base, deepMatter, undefined, deepLinkNonce)));
          deepLinkNonce = '';
          currentMatterLabel = `${m.display_number || deepMatter}`;
        } catch (e: any) {
          setStatus(e?.message || 'Could not open the matter from Clio.', 'error');
        }
      }
    }
    await populateModels();
    if (!handled && !clioToken()) {
      setStatus('Sign in to Clio to load your matters.', 'warn');
    } else {
      await populateMatters();
    }
  })();
});
