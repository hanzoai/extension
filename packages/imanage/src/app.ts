// The iManage panel glue: the embedded/linked-app page that opens with a customer
// + library (and optionally a workspace or document) in context and drives the AI
// actions over the matter's live records. All the logic-heavy work (action
// prompts, context windowing, chat shaping, proxy request shaping, text
// extraction, auth) lives in its own tested modules; this file binds them to the
// DOM. It is the one impure, browser-only entry point.
//
// Data flow: the panel reads iManage ONLY through the same-origin server proxy
// (createProxyClient), which holds the OAuth token server-side. It loads a
// document's profile + extracted content (or a search result set), assembles a
// windowed context (buildContext), and runs an action or a freeform question
// against api.hanzo.ai with the pasted Hanzo key. The optional profile write-back
// (save the summary into the document's comment) posts back through the same
// proxy, behind an explicit button + confirm.

import { actionList, isActionId, runAction } from './actions.js';
import { ask as askHanzo, listModels, type MatterMeta } from './hanzo.js';
import {
  buildContext,
  contextNote,
  documentSection,
  documentIndexSection,
  workspaceSection,
  searchResultSection,
  type DocumentContext,
} from './documents.js';
import { DEFAULT_MODEL } from './config.js';
import { getApiKey, setApiKey, hasApiKey, bearer, validateKey } from './auth.js';
import { createProxyClient, parseLaunchContext, type ProxyClient } from './panel.js';
import type { Workspace, DocumentEntry } from './imanage-api.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let controller: AbortController | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const launch = parseLaunchContext(window.location.search);

  const customerEl = $<HTMLInputElement>('customer');
  const libraryEl = $<HTMLInputElement>('library');
  const workspaceEl = $<HTMLSelectElement>('workspace');
  const browseBtn = $<HTMLButtonElement>('browse');
  const documentEl = $<HTMLSelectElement>('document');
  const loadBtn = $<HTMLButtonElement>('load');
  const searchEl = $<HTMLInputElement>('search');
  const searchBtn = $<HTMLButtonElement>('searchbtn');
  const recordsEl = $('records');
  const outputEl = $<HTMLTextAreaElement>('output');
  const statusEl = $('status');
  const modelEl = $<HTMLSelectElement>('model');
  const chipRow = $('chips');
  const runBtn = $<HTMLButtonElement>('run');
  const stopBtn = $<HTMLButtonElement>('stop');
  const promptEl = $<HTMLTextAreaElement>('prompt');
  const apiKeyEl = $<HTMLInputElement>('apikey');
  const saveKeyBtn = $<HTMLButtonElement>('savekey');
  const authHint = $('authhint');
  const saveBtn = $<HTMLButtonElement>('save');

  customerEl.value = launch.customerId;
  libraryEl.value = launch.libraryId;
  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();
  void loadConfigDefaults();

  // Loaded state: the context the actions run over, the matter meta, and the
  // document we're scoped to (for the profile write-back). A search result set has
  // no single document, so write-back is disabled then.
  let ctx: DocumentContext | null = null;
  let meta: MatterMeta = {};
  let currentDocumentId = '';

  // Action chips — derived from the catalog so UI and logic never drift.
  for (const a of actionList()) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.dataset.action = a.id;
    b.onclick = () => void run(a.id);
    chipRow.appendChild(b);
  }

  // client builds a proxy client scoped to the current customer + library. Rebuilt
  // on demand so a scope change takes effect immediately.
  function client(): ProxyClient {
    return createProxyClient({ customerId: customerEl.value.trim(), libraryId: libraryEl.value.trim() });
  }

  browseBtn.onclick = () => void browseWorkspaces();
  workspaceEl.onchange = () => void browseDocuments();
  documentEl.onchange = () => {
    currentDocumentId = documentEl.value;
  };
  loadBtn.onclick = () => void loadDocument();
  searchBtn.onclick = () => void runSearch();
  runBtn.onclick = () => {
    const prompt = promptEl.value.trim();
    if (prompt) void ask(prompt);
  };
  stopBtn.onclick = () => controller?.abort();
  saveBtn.onclick = () => void saveToProfile();
  saveKeyBtn.onclick = async () => {
    const key = apiKeyEl.value.trim();
    setStatus('Checking key…');
    try {
      const models = await validateKey(key);
      setApiKey(key);
      fillModels(models);
      reflectAuth();
      setStatus('Key saved.', 'ok');
    } catch (e: any) {
      setStatus(e?.message || 'Key rejected.', 'error');
    }
  };

  // If we launched already scoped, browse workspaces; if a workspace or document
  // was named, drill straight in.
  if (launch.customerId && launch.libraryId) {
    void browseWorkspaces().then(() => {
      if (launch.workspaceId) {
        workspaceEl.value = launch.workspaceId;
        void browseDocuments().then(() => {
          if (launch.documentId) {
            documentEl.value = launch.documentId;
            currentDocumentId = launch.documentId;
            void loadDocument();
          }
        });
      }
    });
  }

  // loadConfigDefaults pre-fills customer/library from a single-tenant deployment's
  // /config when the launch context didn't supply them. Best-effort.
  async function loadConfigDefaults(): Promise<void> {
    if (customerEl.value && libraryEl.value) return;
    try {
      const resp = await fetch('/config', { credentials: 'include' });
      if (!resp.ok) return;
      const cfg = await resp.json();
      if (!customerEl.value && cfg.customerId) customerEl.value = String(cfg.customerId);
      if (!libraryEl.value && cfg.libraryId) libraryEl.value = String(cfg.libraryId);
    } catch {
      /* no /config — the user enters the scope manually */
    }
  }

  // browseWorkspaces fills the workspace picker from the proxy for the current
  // scope. An empty scope (or an auth failure) leaves it empty with a hint.
  async function browseWorkspaces(): Promise<void> {
    if (!requireScope()) return;
    setStatus('Loading workspaces…');
    try {
      const { items } = await client().listWorkspaces({ limit: 100 });
      fillWorkspaces(items);
      setStatus(items.length ? `Loaded ${items.length} workspaces.` : 'No workspaces visible.', items.length ? 'ok' : 'warn');
      if (items.length) await browseDocuments();
    } catch (e: any) {
      setStatus(e?.message || 'Could not load workspaces — is the app connected? (Connect on imanage.hanzo.ai)', 'error');
    }
  }

  // browseDocuments lists the selected workspace's documents into the document
  // picker (a workspace is a container, so its id is a valid folder id here).
  async function browseDocuments(): Promise<void> {
    const workspaceId = workspaceEl.value;
    if (!workspaceId) return;
    setStatus('Loading documents…');
    try {
      const { items } = await client().listFolderChildren(workspaceId, { limit: 100 });
      fillDocuments(items.documents);
      const ws = workspaces.find((w) => w.id === workspaceId);
      meta = ws ? { workspaceName: ws.name, matterNumber: ws.matter, client: ws.client } : {};
      setStatus(
        `${items.documents.length} documents · ${items.folders.length} folders in ${ws?.name || workspaceId}.`,
        'ok',
      );
    } catch (e: any) {
      setStatus(e?.message || 'Could not load documents.', 'error');
    }
  }

  // loadDocument pulls the selected document's profile + content and assembles a
  // single-document context the actions run over.
  async function loadDocument(): Promise<void> {
    const documentId = documentEl.value || currentDocumentId;
    if (!documentId) {
      setStatus('Pick a document first.', 'warn');
      return;
    }
    currentDocumentId = documentId;
    setStatus('Loading document…');
    const c = client();
    try {
      const [doc, extracted] = await Promise.all([c.getDocument(documentId), c.getDocumentContent(documentId).catch(() => null)]);
      const text = extracted ?? { text: '', extracted: false, reason: 'Content could not be retrieved.' };
      ctx = buildContext([documentSection(doc, text)]);
      meta = { ...meta, workspaceName: meta.workspaceName };
      recordsEl.textContent = `${doc.name}${doc.extension ? '.' + doc.extension : ''}${text.extracted ? '' : ' (profile only — content not extractable)'}`;
      saveBtn.disabled = false;
      saveBtn.title = `Save the result into the comment field of ${doc.name}`;
      setStatus(contextNote(ctx));
    } catch (e: any) {
      setStatus(e?.message || 'Could not load the document.', 'error');
    }
  }

  // runSearch runs a document search across the library and builds a result-set
  // context for the synthesize / compare actions (index only, not full content).
  async function runSearch(): Promise<void> {
    const query = searchEl.value.trim();
    if (!requireScope()) return;
    if (!query) {
      setStatus('Enter a search query.', 'warn');
      return;
    }
    setStatus(`Searching for “${query}”…`);
    try {
      const { items, paging } = await client().search(query, { limit: 50 });
      ctx = buildContext([searchResultSection(items)]);
      currentDocumentId = ''; // a result set has no single document
      saveBtn.disabled = true;
      recordsEl.textContent = `${items.length}${paging.hasMore ? '+' : ''} documents matched “${query}”.`;
      setStatus(items.length ? contextNote(ctx) : 'No documents matched.', items.length ? '' : 'warn');
    } catch (e: any) {
      setStatus(e?.message || 'Search failed.', 'error');
    }
  }

  // run executes one of the named actions over the loaded context.
  async function run(actionId: string): Promise<void> {
    if (!isActionId(actionId)) return;
    await execute((c, m, opts) => runAction(actionId, c, m, opts));
  }

  // ask executes a freeform question over the loaded context.
  async function ask(prompt: string): Promise<void> {
    await execute((c, m, opts) => askHanzo(prompt, c, m, opts));
  }

  // execute is the shared runner: require a loaded context, call the model, show
  // the result. Both the chips and freeform ask funnel through here (one path).
  async function execute(
    call: (
      c: DocumentContext,
      m: MatterMeta,
      opts: { token: string; model: string; signal: AbortSignal },
    ) => Promise<string>,
  ): Promise<void> {
    if (!ctx || ctx.totalBlocks === 0) {
      setStatus('Load a document or run a search first.', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    setStatus(contextNote(ctx));
    outputEl.value = '';
    try {
      const text = await call(ctx, meta, {
        token: bearer(),
        model: modelEl.value || DEFAULT_MODEL,
        signal: controller.signal,
      });
      outputEl.value = text;
      setStatus('Done.', 'ok');
    } catch (e: any) {
      if (e?.name === 'AbortError') setStatus('Stopped.');
      else setStatus(e?.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // saveToProfile writes the current output back to iManage as the loaded
  // document's comment — the explicit, documented, gated write-back. Guarded: never
  // posts an empty body and always confirms which document it targets.
  async function saveToProfile(): Promise<void> {
    const body = outputEl.value.trim();
    if (!currentDocumentId) return setStatus('Load a single document to save a comment to.', 'warn');
    if (!body) return setStatus('Nothing to save — run an action first.', 'warn');
    if (!confirm(`Save this into the comment field of the loaded document? This updates its iManage profile.`)) return;
    setBusy(true);
    setStatus('Saving to iManage profile…');
    try {
      await client().updateDocumentProfile(currentDocumentId, { comment: body.slice(0, 4000) });
      setStatus('Saved to the document comment.', 'ok');
    } catch (e: any) {
      setStatus(e?.message || 'Save failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- small DOM helpers ----------------------------------------------------

  function requireScope(): boolean {
    if (!customerEl.value.trim() || !libraryEl.value.trim()) {
      setStatus('Enter your iManage customer id and library id.', 'warn');
      return false;
    }
    return true;
  }

  let workspaces: Workspace[] = [];
  function fillWorkspaces(items: Workspace[]): void {
    workspaces = items;
    workspaceEl.innerHTML = '';
    for (const w of items) {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = w.name || w.id;
      workspaceEl.appendChild(opt);
    }
  }
  function fillDocuments(items: DocumentEntry[]): void {
    documentEl.innerHTML = '';
    for (const d of items) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name}${d.extension ? '.' + d.extension : ''}`;
      documentEl.appendChild(opt);
    }
    currentDocumentId = documentEl.value || '';
  }

  async function populateModels(): Promise<void> {
    try {
      fillModels(await listModels({ token: bearer() }));
    } catch {
      fillModels([DEFAULT_MODEL]);
    }
  }
  function fillModels(ids: string[]): void {
    const list = ids.length ? ids : [DEFAULT_MODEL];
    modelEl.innerHTML = '';
    for (const id of list) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      modelEl.appendChild(opt);
    }
    if (list.includes(DEFAULT_MODEL)) modelEl.value = DEFAULT_MODEL;
  }

  function reflectAuth(): void {
    authHint.textContent = hasApiKey()
      ? 'Using your saved Hanzo key.'
      : 'No key saved — using public models. Paste an hk-… key for your org models.';
  }

  function setBusy(b: boolean): void {
    runBtn.disabled = b;
    stopBtn.disabled = !b;
    loadBtn.disabled = b;
    browseBtn.disabled = b;
    searchBtn.disabled = b;
    for (const c of Array.from(chipRow.querySelectorAll('button'))) (c as HTMLButtonElement).disabled = b;
    saveBtn.disabled = b || !currentDocumentId;
  }

  function setStatus(msg: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
    statusEl.textContent = msg;
    statusEl.className = `status${kind ? ' ' + kind : ''}`;
  }
});
