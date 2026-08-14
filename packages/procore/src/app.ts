// The Procore panel glue: the embedded/linked-app page that opens with a company
// (and optionally a project) in context and drives the AI actions over the
// project's live records. All the logic-heavy work (action prompts, context
// windowing, chat shaping, proxy request shaping, auth) lives in its own tested
// modules; this file binds them to the DOM. It is the one impure, browser-only
// entry point.
//
// Data flow: the panel reads Procore ONLY through the same-origin server proxy
// (createProxyClient), which holds the OAuth token server-side. It pulls the
// project's RFIs / submittals / documents / observations, assembles a windowed
// context (buildProjectContext), and runs an action or a freeform question
// against api.hanzo.ai with the pasted Hanzo key. The optional RFI reply
// write-back posts back through the same proxy, behind an explicit button.

import { actionList, isActionId, runAction } from './actions.js';
import { ask as askHanzo, listModels, type ProjectMeta } from './hanzo.js';
import {
  buildProjectContext,
  contextNote,
  rfiSection,
  submittalSection,
  documentSection,
  observationSection,
  type ProjectContext,
} from './project.js';
import { DEFAULT_MODEL } from './config.js';
import { getApiKey, setApiKey, hasApiKey, bearer, validateKey } from './auth.js';
import { createProxyClient, parseLaunchContext, type ProxyClient } from './panel.js';
import type { ProjectSummary, Rfi } from './procore-api.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let controller: AbortController | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const launch = parseLaunchContext(window.location.search);

  const companyEl = $<HTMLInputElement>('company');
  const projectEl = $<HTMLSelectElement>('project');
  const loadBtn = $<HTMLButtonElement>('load');
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
  const replyBtn = $<HTMLButtonElement>('reply');

  companyEl.value = launch.companyId;
  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();

  // Loaded project state: the records that make up the current context, plus the
  // project we're scoped to (for the reply write-back).
  let ctx: ProjectContext | null = null;
  let meta: ProjectMeta = {};
  let currentProjectId = '';
  let firstOpenRfi: Rfi | null = null;

  // Action chips — derived from the catalog so UI and logic never drift.
  for (const a of actionList()) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.dataset.action = a.id;
    b.onclick = () => void run(a.id);
    chipRow.appendChild(b);
  }

  // client builds a proxy client scoped to the current company. Rebuilt on demand
  // so a company change takes effect immediately.
  function client(): ProxyClient {
    return createProxyClient({ companyId: companyEl.value.trim() });
  }

  loadBtn.onclick = () => void loadProject();
  projectEl.onchange = () => {
    currentProjectId = projectEl.value;
  };
  companyEl.onchange = () => void populateProjects();

  runBtn.onclick = () => {
    const prompt = promptEl.value.trim();
    if (prompt) void ask(prompt);
  };
  stopBtn.onclick = () => controller?.abort();
  replyBtn.onclick = () => void postReply();
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

  // If we launched with a company, list its projects; if we also launched with a
  // project, load it straight away.
  if (launch.companyId) {
    void populateProjects().then(() => {
      if (launch.projectId) {
        projectEl.value = launch.projectId;
        currentProjectId = launch.projectId;
        void loadProject();
      }
    });
  }

  // populateProjects fills the project picker from the proxy for the current
  // company. A company with no id (or an auth failure) leaves the picker empty
  // with a status hint.
  async function populateProjects(): Promise<void> {
    const company = companyEl.value.trim();
    if (!company) {
      setStatus('Enter your Procore company id to list projects.', 'warn');
      return;
    }
    setStatus('Loading projects…');
    try {
      const { items } = await client().listProjects({ perPage: 100 });
      fillProjects(items);
      setStatus(items.length ? `Loaded ${items.length} projects.` : 'No projects visible.', items.length ? 'ok' : 'warn');
    } catch (e: any) {
      setStatus(e?.message || 'Could not load projects — is the app connected? (Connect on procore.hanzo.ai)', 'error');
    }
  }

  // loadProject pulls the scoped project's records and assembles the context the
  // actions run over. RFIs and submittals and documents and observations are
  // fetched in parallel; each failure is tolerated so a project missing one tool
  // still yields a usable context.
  async function loadProject(): Promise<void> {
    const projectId = projectEl.value || currentProjectId;
    if (!projectId) {
      setStatus('Pick a project first.', 'warn');
      return;
    }
    currentProjectId = projectId;
    setStatus('Loading project records…');
    const c = client();
    const [rfis, submittals, documents, observations] = await Promise.all([
      c.listRFIs(projectId, { perPage: 100 }).then((r) => r.items).catch(() => [] as Rfi[]),
      c.listSubmittals(projectId, { perPage: 100 }).then((r) => r.items).catch(() => []),
      c.listDocuments(projectId, { perPage: 100 }).then((r) => r.items).catch(() => []),
      c.listObservations(projectId, { perPage: 100 }).then((r) => r.items).catch(() => []),
    ]);

    firstOpenRfi = rfis.find((r) => r.status.toLowerCase() !== 'closed') ?? rfis[0] ?? null;

    ctx = buildProjectContext([
      rfiSection(rfis),
      submittalSection(submittals),
      documentSection(documents),
      observationSection(observations),
    ]);
    const chosen = projectSummary(projectId);
    meta = { name: chosen?.displayName || undefined };

    recordsEl.textContent =
      `${rfis.length} RFIs · ${submittals.length} submittals · ${documents.length} documents · ${observations.length} observations`;
    replyBtn.disabled = !firstOpenRfi;
    replyBtn.title = firstOpenRfi
      ? `Post the result as a reply to RFI ${firstOpenRfi.number || firstOpenRfi.id}`
      : 'No open RFI to reply to';
    setStatus(contextNote(ctx));
  }

  // run executes one of the named actions over the loaded project context.
  async function run(actionId: string): Promise<void> {
    if (!isActionId(actionId)) return;
    await execute((c, m, opts) => runAction(actionId, c, m, opts));
  }

  // ask executes a freeform question over the loaded project context.
  async function ask(prompt: string): Promise<void> {
    await execute((c, m, opts) => askHanzo(prompt, c, m, opts));
  }

  // execute is the shared runner: require a loaded context, call the model, show
  // the result. Both the chips and freeform ask funnel through here (one path).
  async function execute(
    call: (
      c: ProjectContext,
      m: ProjectMeta,
      opts: { token: string; model: string; signal: AbortSignal },
    ) => Promise<string>,
  ): Promise<void> {
    if (!ctx || ctx.totalBlocks === 0) {
      setStatus('Load a project first (pick one and press Load).', 'warn');
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

  // postReply writes the current output back to Procore as a reply on the first
  // open RFI — the explicit, documented write-back. Guarded: it never posts an
  // empty body and always confirms which RFI it targeted.
  async function postReply(): Promise<void> {
    const body = outputEl.value.trim();
    if (!firstOpenRfi) return setStatus('No open RFI to reply to.', 'warn');
    if (!body) return setStatus('Nothing to post — run an action or write a reply first.', 'warn');
    if (!confirm(`Post this as a reply to RFI ${firstOpenRfi.number || firstOpenRfi.id}?`)) return;
    setBusy(true);
    setStatus('Posting reply to Procore…');
    try {
      await client().createReply(currentProjectId, firstOpenRfi.id, body);
      setStatus(`Reply posted to RFI ${firstOpenRfi.number || firstOpenRfi.id}.`, 'ok');
    } catch (e: any) {
      setStatus(e?.message || 'Reply failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- small DOM helpers ----------------------------------------------------

  let projects: ProjectSummary[] = [];
  function projectSummary(id: string): ProjectSummary | undefined {
    return projects.find((p) => String(p.id) === String(id));
  }
  function fillProjects(items: ProjectSummary[]): void {
    projects = items;
    projectEl.innerHTML = '';
    for (const p of items) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.displayName || p.name;
      projectEl.appendChild(opt);
    }
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
      : 'No key saved — using public models. Paste an sk-… key for your org models.';
  }

  function setBusy(b: boolean): void {
    runBtn.disabled = b;
    stopBtn.disabled = !b;
    loadBtn.disabled = b;
    for (const c of Array.from(chipRow.querySelectorAll('button'))) (c as HTMLButtonElement).disabled = b;
    replyBtn.disabled = b || !firstOpenRfi;
  }

  function setStatus(msg: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
    statusEl.textContent = msg;
    statusEl.className = `status${kind ? ' ' + kind : ''}`;
  }
});
