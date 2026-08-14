// The SPA glue. Wires the DOM to: Notion sign-in (redirect to Notion's authorize
// URL), loading a page's blocks (recursively) into text, running the four Hanzo
// actions, and writing the result back onto the page (callout) or into a
// database (rows). The logic-heavy parts (oauth URL, api request shaping, block
// ↔ text, context assembly, chat, extraction) live in their tested modules; this
// is the thin binding.
//
// Credentials:
//  - Notion: the OAuth bot token is obtained + STORED server-side (the proxy
//    service). The app holds only an opaque SESSION id (sessionStorage) and
//    proxies every Notion call through the service — the bot token and the
//    client_secret are NEVER in the browser.
//  - Hanzo: an `sk-` key pasted by the user (localStorage), or empty
//    (anonymous/limited). Same createAiClient contract as every Hanzo surface.

/* global window, document, sessionStorage, localStorage, crypto */

import { DEFAULT_MODEL } from './config.js';
import { oauthAuthorizeUrl } from './notion-oauth.js';
import {
  retrieveBlockChildren,
  retrievePage,
  appendChildren,
  createPage,
  search,
  readListPage,
  type NotionRequest,
} from './notion-api.js';
import { blocksToText, pageTitle, type BlockNode, type NotionBlock } from './blocks.js';
import { createAiClient } from './client.js';
import {
  runAction,
  parseActionItems,
  actionItemProperties,
  resultBlocks,
  DEFAULT_FIELD_MAP,
  type ActionId,
  type PageContext,
} from './actions.js';

// Stamped at build time via esbuild `define` (the client_id + redirect are
// PUBLIC; only the SECRET is server-side).
declare const NOTION_CLIENT_ID: string;
declare const NOTION_REDIRECT_URI: string;

// The proxy-service origin (this app's own backend). Same-origin in production
// (notion.hanzo.ai serves both the static SPA and the service via ingress).
const SERVICE = ''; // '' → same origin

// ── credential / session storage ────────────────────────────────────────────
const SESSION_KEY = 'hanzo.notion.session';
const STATE_KEY = 'hanzo.notion.oauthState';
const HANZO_KEY = 'hanzo.apiKey';

function session(): string {
  return sessionStorage.getItem(SESSION_KEY) || '';
}
function hanzoKey(): string {
  return localStorage.getItem(HANZO_KEY) || '';
}

// ── Notion calls, proxied through the service ────────────────────────────────
// The app never holds a Notion token. It shapes a NotionRequest with the pure
// wrappers, then rewrites the URL to hit the SERVICE proxy and attaches the
// opaque session id; the service adds the real Bearer + Notion-Version and
// forwards to Notion. So the SAME request shapers drive both the (tested) wire
// contract and the live call.
function toProxyRequest(req: NotionRequest): { url: string; init: RequestInit } {
  // req.url is https://api.notion.com/v1/<subpath>; keep only the subpath.
  const subPath = req.url.replace(/^https?:\/\/[^/]+\/v1/, '');
  const headers: Record<string, string> = { 'x-hanzo-session': session() };
  if (req.body) headers['Content-Type'] = 'application/json';
  return {
    url: `${SERVICE}/notion${subPath}`,
    init: { method: req.method, headers, body: req.body },
  };
}

async function proxyFetch(req: NotionRequest): Promise<any> {
  const { url, init } = toProxyRequest(req);
  const resp = await fetch(url, init);
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) throw new Error(data?.message || data?.error || `Notion ${resp.status}`);
  return data;
}

// Recursively read a page's block tree into BlockNode[]. Notion returns a flat
// list per parent; a block with has_children is fetched again for its children.
// Bounded depth so a pathological nesting can't loop forever.
async function readBlockTree(blockId: string, depth = 0): Promise<BlockNode[]> {
  if (depth > 4) return [];
  const nodes: BlockNode[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const shaped = retrieveBlockChildren({ token: '', blockId, startCursor: cursor });
    const listPage = readListPage<NotionBlock>(await proxyFetch(shaped));
    for (const block of listPage.results) {
      const children = block.has_children ? await readBlockTree(block.id, depth + 1) : [];
      nodes.push({ block, children });
    }
    if (!listPage.hasMore || !listPage.nextCursor) break;
    cursor = listPage.nextCursor;
  }
  return nodes;
}

async function loadPageContext(pageId: string): Promise<PageContext> {
  const page = await proxyFetch(retrievePage({ token: '', pageId }));
  const tree = await readBlockTree(pageId);
  return { title: pageTitle(page), text: blocksToText(tree) };
}

// ── boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const params = new URLSearchParams(window.location.search);

  const statusEl = $('status');
  const outputEl = $('output') as HTMLTextAreaElement;
  const pageEl = $('page') as HTMLSelectElement;
  const dbEl = $('database') as HTMLSelectElement;
  const modelEl = $('model') as HTMLSelectElement;
  const detailEl = $('detail') as HTMLInputElement;
  const apiKeyEl = $('apikey') as HTMLInputElement;
  const signInBtn = $('signin') as HTMLButtonElement;
  const appendBtn = $('append') as HTMLButtonElement;
  const rowsBtn = $('rows') as HTMLButtonElement;
  const actionBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.action'));

  let currentPageId = '';
  let currentOutput = '';
  let lastAction: ActionId = 'summarize';

  function setStatus(msg: string, kind: 'ok' | 'warn' | 'error' | '' = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + kind;
  }

  // OAuth callback landing: Notion redirected back with ?code=&state=. Exchange
  // it via the service (which holds the secret) for an opaque session id.
  async function maybeHandleOAuthCallback(): Promise<boolean> {
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return false;
    if (state !== sessionStorage.getItem(STATE_KEY)) {
      setStatus('OAuth state mismatch — sign in again.', 'error');
      return true;
    }
    setStatus('Completing Notion sign-in…');
    const resp = await fetch(`${SERVICE}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setStatus(data?.error || 'Notion sign-in failed.', 'error');
      return true;
    }
    sessionStorage.setItem(SESSION_KEY, data.session);
    window.history.replaceState({}, '', window.location.pathname);
    setStatus(`Connected to ${data.workspace?.name || 'Notion'}.`, 'ok');
    return true;
  }

  signInBtn.onclick = () => {
    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    window.location.href = oauthAuthorizeUrl({
      clientId: NOTION_CLIENT_ID,
      redirectUri: NOTION_REDIRECT_URI,
      state,
    });
  };

  apiKeyEl.value = hanzoKey();
  apiKeyEl.onchange = () => {
    const k = apiKeyEl.value.trim();
    if (k) localStorage.setItem(HANZO_KEY, k);
    else localStorage.removeItem(HANZO_KEY);
  };

  // Discover the pages + databases the integration was granted, via /search.
  async function populatePages() {
    if (!session()) return;
    try {
      const pagesResp = readListPage<any>(await proxyFetch(search({ token: '', filterObject: 'page', pageSize: 50 })));
      pageEl.innerHTML = '';
      for (const p of pagesResp.results) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = pageTitle(p) || p.id;
        pageEl.appendChild(opt);
      }
      if (pagesResp.results[0]) currentPageId = pagesResp.results[0].id;

      const dbResp = readListPage<any>(await proxyFetch(search({ token: '', filterObject: 'database', pageSize: 50 })));
      dbEl.innerHTML = '';
      for (const d of dbResp.results) {
        const opt = document.createElement('option');
        opt.value = d.id;
        const title = Array.isArray(d.title) ? d.title.map((t: any) => t.plain_text).join('') : '';
        opt.textContent = title || d.id;
        dbEl.appendChild(opt);
      }
    } catch (e: any) {
      setStatus(e?.message || 'Could not load pages.', 'error');
    }
  }
  pageEl.onchange = () => (currentPageId = pageEl.value);

  async function populateModels() {
    try {
      const ai = createAiClient({ token: hanzoKey() });
      const ids = (await ai.models.list()).map((m) => m.id).sort();
      if (!ids.length) throw new Error('empty');
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

  // ONE path from the UI to the model: read the page, ask Hanzo with the action's
  // task, show the raw text. `extract` returns a JSON array (parsed into rows on
  // write-back); the others return prose (appended as a callout). The only
  // per-action difference is the task string and which write-back is enabled.
  async function run(id: ActionId) {
    if (!currentPageId) {
      setStatus('Pick a page first.', 'warn');
      return;
    }
    for (const b of actionBtns) b.disabled = true;
    appendBtn.disabled = true;
    rowsBtn.disabled = true;
    outputEl.value = '';
    try {
      setStatus('Reading the page from Notion…');
      const context = await loadPageContext(currentPageId);
      setStatus(id === 'extract' ? 'Extracting action items…' : 'Asking Hanzo…');
      currentOutput = await runAction({
        id,
        detail: detailEl.value,
        context,
        hanzoToken: hanzoKey(),
        model: modelEl.value || DEFAULT_MODEL,
      });
      outputEl.value = currentOutput;
      appendBtn.disabled = !currentOutput;
      // Rows only make sense for `extract` (JSON) and only with a database picked.
      rowsBtn.disabled = id !== 'extract' || !currentOutput || !dbEl.value;
      setStatus(
        id === 'extract'
          ? 'Extracted — review the JSON, then create rows.'
          : 'Done — review, then write back to Notion.',
        'ok',
      );
    } catch (e: any) {
      setStatus(e?.message || String(e), 'error');
    } finally {
      for (const b of actionBtns) b.disabled = false;
    }
  }

  for (const b of actionBtns) {
    b.onclick = () => {
      lastAction = b.dataset.action as ActionId;
      void run(lastAction);
    };
  }

  // Append the current output onto the page as a labelled callout + paragraphs.
  appendBtn.onclick = async () => {
    const body = outputEl.value.trim();
    if (!body || !currentPageId) return;
    try {
      setStatus('Appending to the page…');
      await proxyFetch(
        appendChildren({ token: '', blockId: currentPageId, children: resultBlocks(lastAction, body) }),
      );
      setStatus('Appended to the Notion page.', 'ok');
    } catch (e: any) {
      setStatus(e?.message || String(e), 'error');
    }
  };

  // Create one database row per extracted action item.
  rowsBtn.onclick = async () => {
    const dbId = dbEl.value;
    if (!dbId) {
      setStatus('Pick a database first.', 'warn');
      return;
    }
    try {
      const items = parseActionItems(outputEl.value);
      if (!items.length) {
        setStatus('No action items to create.', 'warn');
        return;
      }
      setStatus(`Creating ${items.length} rows…`);
      for (const item of items) {
        await proxyFetch(
          createPage({
            token: '',
            parent: { database_id: dbId },
            properties: actionItemProperties(item, DEFAULT_FIELD_MAP),
          }),
        );
      }
      setStatus(`Created ${items.length} rows in the database.`, 'ok');
    } catch (e: any) {
      setStatus(e?.message || String(e), 'error');
    }
  };

  // ── init ──────────────────────────────────────────────────────────────────
  (async () => {
    const handled = await maybeHandleOAuthCallback();
    await populateModels();
    if (!handled && !session()) {
      setStatus('Connect Notion to load your pages.', 'warn');
    } else {
      await populatePages();
    }
  })();
});
