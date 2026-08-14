// The DocuSign panel glue: the Extension-App / linked-app page that opens with an
// envelope in context and drives the four AI actions over its agreement. All the
// logic-heavy work (action prompts, document windowing, chat shaping, auth) lives
// in its own tested modules; this file binds them to the DOM. It is the one
// impure, browser-only entry point.
//
// How the panel gets the agreement text: DocuSign launches an Extension App /
// linked app with the envelope in the URL. The panel reads that context
// (parseLaunchContext), and the user pastes or the host injects the agreement
// text into the box — the panel never holds the DocuSign secret (document bytes
// are fetched server-side by the Connect service). Actions then run over the
// windowed text straight against the api.hanzo.ai gateway with the pasted Hanzo
// key. The context parsing + text→pages logic is pure (panel.ts), unit-tested.

import { actionList, isActionId, runAction } from './actions.js';
import { ask as askHanzo, buildDocumentContext, contextNote, listModels } from './hanzo.js';
import { DEFAULT_MODEL } from './config.js';
import { getApiKey, setApiKey, hasApiKey, bearer, validateKey } from './auth.js';
import { asPages, panelTitle, parseLaunchContext } from './panel.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let controller: AbortController | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const ctx = parseLaunchContext(window.location.search);

  const titleEl = $('agreement-title');
  const docEl = $<HTMLTextAreaElement>('doc');
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

  // run executes one of the four named actions over the current agreement text.
  async function run(actionId: string): Promise<void> {
    if (!isActionId(actionId)) return;
    await execute((docCtx, meta, opts) => runAction(actionId, docCtx, meta, opts));
  }

  // ask executes a freeform question over the agreement.
  async function ask(prompt: string): Promise<void> {
    await execute((docCtx, meta, opts) => askHanzo(prompt, docCtx, meta, opts));
  }

  // execute is the shared runner: window the pasted text, call the model, show
  // the result. Both the chips and freeform ask funnel through here (one path).
  async function execute(
    call: (
      docCtx: ReturnType<typeof buildDocumentContext>,
      meta: { title?: string; envelopeId?: string },
      opts: { token: string; model: string; signal: AbortSignal },
    ) => Promise<string>,
  ): Promise<void> {
    const pages = asPages(docEl.value);
    if (pages.length === 0) {
      setStatus('Paste the agreement text (or open from DocuSign with an envelope).', 'warn');
      return;
    }
    const docCtx = buildDocumentContext(pages);
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    setStatus(contextNote(docCtx));
    outputEl.value = '';
    try {
      const text = await call(
        docCtx,
        { title: ctx.title || undefined, envelopeId: ctx.envelopeId || undefined },
        { token: bearer(), model: modelEl.value || DEFAULT_MODEL, signal: controller.signal },
      );
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
