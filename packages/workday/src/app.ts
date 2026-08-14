// The Workday panel glue: the embedded/linked-app page that opens over a tenant
// (optionally deep-linked to a worker or organization) and drives the AI actions
// over the tenant's live people records. All the logic-heavy work (action prompts,
// context windowing, chat shaping, proxy request shaping, auth) lives in its own
// tested modules; this file binds them to the DOM. It is the one impure,
// browser-only entry point.
//
// Data flow: the panel reads Workday ONLY through the same-origin server proxy
// (createProxyClient), which holds the OAuth token + tenant address server-side.
// It pulls the selected worker's profile + direct reports + organizations +
// requisitions (+ eligible absence types), assembles a windowed context
// (buildPeopleContext), and runs an action or a freeform question against
// api.hanzo.ai with the pasted Hanzo key. v1 is read-only — there is no write-back.

import { actionList, isActionId, runAction } from './actions.js';
import { ask as askHanzo, listModels, type PeopleMeta } from './hanzo.js';
import {
  buildPeopleContext,
  contextNote,
  workerSection,
  directReportSection,
  organizationSection,
  requisitionSection,
  absenceTypeSection,
  type PeopleContext,
} from './people.js';
import { DEFAULT_MODEL } from './config.js';
import { getApiKey, setApiKey, hasApiKey, bearer, validateKey } from './auth.js';
import { createProxyClient, parseLaunchContext, type ProxyClient } from './panel.js';
import type { Worker } from './workday-api.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let controller: AbortController | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const launch = parseLaunchContext(window.location.search);

  const workerEl = $<HTMLSelectElement>('worker');
  const loadBtn = $<HTMLButtonElement>('load');
  const refreshBtn = $<HTMLButtonElement>('refresh');
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

  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();

  // Loaded people state: the records that make up the current context, plus the
  // worker we're scoped to.
  let ctx: PeopleContext | null = null;
  let meta: PeopleMeta = {};

  // Action chips — derived from the catalog so UI and logic never drift.
  for (const a of actionList()) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.dataset.action = a.id;
    b.onclick = () => void run(a.id);
    chipRow.appendChild(b);
  }

  // client builds a proxy client over the same-origin server proxy.
  function client(): ProxyClient {
    return createProxyClient();
  }

  loadBtn.onclick = () => void loadWorker();
  refreshBtn.onclick = () => void populateWorkers();
  runBtn.onclick = () => {
    const prompt = promptEl.value.trim();
    if (prompt) void ask(prompt);
  };
  stopBtn.onclick = () => controller?.abort();
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

  // List the tenant's workers on open; if we launched with a worker, load it.
  void populateWorkers().then(() => {
    if (launch.workerId) {
      workerEl.value = launch.workerId;
      void loadWorker();
    }
  });

  // populateWorkers fills the worker picker from the proxy. An auth failure (the
  // app isn't connected) leaves the picker empty with a status hint.
  async function populateWorkers(): Promise<void> {
    setStatus('Loading workers…');
    try {
      const { items, total } = await client().listWorkers({ limit: 100 });
      fillWorkers(items);
      setStatus(
        items.length
          ? `Loaded ${items.length}${total > items.length ? ` of ${total}` : ''} workers.`
          : 'No workers visible.',
        items.length ? 'ok' : 'warn',
      );
    } catch (e: any) {
      setStatus(
        e?.message || 'Could not load workers — is the app connected? (Connect on workday.hanzo.ai)',
        'error',
      );
    }
  }

  // loadWorker pulls the selected worker + direct reports + organizations +
  // requisitions + eligible absence types and assembles the context the actions
  // run over. Each secondary fetch is tolerated so a worker missing one facet
  // still yields a usable context.
  async function loadWorker(): Promise<void> {
    const workerId = workerEl.value;
    if (!workerId) {
      setStatus('Pick a worker first.', 'warn');
      return;
    }
    setStatus('Loading Workday records…');
    const c = client();
    const [worker, reports, orgs, reqs, absence] = await Promise.all([
      c.getWorker(workerId).catch(() => null),
      c.listDirectReports(workerId, { limit: 100 }).then((r) => r.items).catch(() => [] as Worker[]),
      c.listOrganizations({ limit: 100 }).then((r) => r.items).catch(() => []),
      c.listRequisitions({ limit: 100 }).then((r) => r.items).catch(() => []),
      c.listAbsenceTypes(workerId, { limit: 100 }).then((r) => r.items).catch(() => []),
    ]);

    ctx = buildPeopleContext([
      workerSection(worker ? [worker] : []),
      directReportSection(reports),
      organizationSection(orgs),
      requisitionSection(reqs),
      absenceTypeSection(absence),
    ]);
    meta = {
      subject: worker?.name || undefined,
      organization: worker?.organization || undefined,
    };

    recordsEl.textContent =
      `${worker ? '1 worker' : 'no worker'} · ${reports.length} direct reports · ${orgs.length} orgs · ${reqs.length} requisitions · ${absence.length} absence types`;
    setStatus(contextNote(ctx));
  }

  // run executes one of the named actions over the loaded people context.
  async function run(actionId: string): Promise<void> {
    if (!isActionId(actionId)) return;
    await execute((c, m, opts) => runAction(actionId, c, m, opts));
  }

  // ask executes a freeform question over the loaded people context.
  async function ask(prompt: string): Promise<void> {
    await execute((c, m, opts) => askHanzo(prompt, c, m, opts));
  }

  // execute is the shared runner: require a loaded context, call the model, show
  // the result. Both the chips and freeform ask funnel through here (one path).
  async function execute(
    call: (
      c: PeopleContext,
      m: PeopleMeta,
      opts: { token: string; model: string; signal: AbortSignal },
    ) => Promise<string>,
  ): Promise<void> {
    if (!ctx || ctx.totalBlocks === 0) {
      setStatus('Load a worker first (pick one and press Load).', 'warn');
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

  // ---- small DOM helpers ----------------------------------------------------

  function fillWorkers(items: Worker[]): void {
    workerEl.innerHTML = '';
    for (const w of items) {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = w.businessTitle ? `${w.name} — ${w.businessTitle}` : w.name || w.id;
      workerEl.appendChild(opt);
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
    refreshBtn.disabled = b;
    for (const c of Array.from(chipRow.querySelectorAll('button'))) (c as HTMLButtonElement).disabled = b;
  }

  function setStatus(msg: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
    statusEl.textContent = msg;
    statusEl.className = `status${kind ? ' ' + kind : ''}`;
  }
});
