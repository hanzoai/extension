// The QuickBooks panel glue: the web page (hosted behind hanzoai/ingress at
// quickbooks.hanzo.ai) that drives the AI actions over pasted financials. All the
// logic-heavy work (action prompts, report/entity rendering, context windowing,
// chat shaping, auth) lives in its own tested modules; this file binds them to
// the DOM. It is the one impure, browser-only entry point.
//
// How the panel gets the data: the user pastes a QBO report JSON (P&L, Balance
// Sheet), a query response, or plain financial text into the box; the panel
// interprets it (buildContextFromPaste) and runs actions over the windowed
// context straight against the api.hanzo.ai gateway with the pasted Hanzo key.
// The panel never holds the Intuit secret — server-side reads (qbo-analysis) are
// the deployment's proxy path; the standalone panel is paste-driven so it works
// with zero backend. The interpret + windowing logic is pure (panel.ts,
// finance.ts), unit-tested.

import { actionList, isActionId, runAction } from './actions.js';
import { ask as askHanzo, listModels } from './hanzo.js';
import { contextNote } from './finance.js';
import { DEFAULT_MODEL } from './config.js';
import { getApiKey, setApiKey, hasApiKey, bearer, validateKey } from './auth.js';
import { buildContextFromPaste, panelTitle, parseLaunchContext } from './panel.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let controller: AbortController | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const ctx = parseLaunchContext(window.location.search);

  const titleEl = $('company-title');
  const dataEl = $<HTMLTextAreaElement>('data');
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

  titleEl.textContent = panelTitle(ctx);

  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();

  // Action chips — derived from the catalog so UI and logic never drift.
  for (const a of actionList()) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.dataset.action = a.id;
    b.onclick = () => void run(a.id);
    chipRow.appendChild(b);
  }

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

  // run executes one of the named actions over the current financial data.
  async function run(actionId: string): Promise<void> {
    if (!isActionId(actionId)) return;
    await execute((financeCtx, opts) => runAction(actionId, financeCtx, opts));
  }

  // ask executes a freeform question over the financial data.
  async function ask(prompt: string): Promise<void> {
    await execute((financeCtx, opts) => askHanzo(prompt, financeCtx, opts));
  }

  // execute is the shared runner: interpret the pasted data, call the model, show
  // the result. Both the chips and freeform ask funnel through here (one path).
  async function execute(
    call: (
      financeCtx: ReturnType<typeof buildContextFromPaste>,
      opts: { token: string; model: string; signal: AbortSignal },
    ) => Promise<string>,
  ): Promise<void> {
    const financeCtx = buildContextFromPaste(dataEl.value);
    if (financeCtx.text.length === 0) {
      setStatus('Paste a QuickBooks report (P&L / Balance Sheet JSON), a query response, or figures.', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    setStatus(contextNote(financeCtx));
    outputEl.value = '';
    try {
      const text = await call(financeCtx, {
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
    for (const c of Array.from(chipRow.querySelectorAll('button'))) (c as HTMLButtonElement).disabled = b;
  }

  function setStatus(msg: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
    statusEl.textContent = msg;
    statusEl.className = `status${kind ? ' ' + kind : ''}`;
  }
});
