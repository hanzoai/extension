// The PDF workspace glue: open a PDF, render/navigate pages, extract text, and
// drive the Hanzo AI panel. Everything logic-heavy (chat shaping, context
// windowing, text flattening, auth) lives in its own tested modules; this file
// binds them to the DOM. It is the one impure, browser-only entry point.

import { PdfDocument, configureWorker } from './pdf-view.js';
import { askStream, listModels } from './chat.js';
import { buildContext, contextNote, CONTEXT_CHAR_BUDGET, DEFAULT_MODEL, type PageText } from './config.js';
import { getApiKey, setApiKey, clearApiKey, hasApiKey, bearer, validateKey } from './auth.js';

// The worker file is emitted next to app.js by build.js.
configureWorker(new URL('./pdf.worker.mjs', import.meta.url).toString());

// Law-office quick actions. Each is a self-contained instruction; the document
// context and selection are attached by chat.buildMessages. Kept here (not in a
// tested module) because they are content/config, not logic.
const QUICK_ACTIONS: { label: string; task: string }[] = [
  { label: 'Summarize', task: 'Summarize this document: its purpose, the parties, the key terms, and the overall structure. Cite pages.' },
  { label: 'Parties, dates & obligations', task: 'Extract, as a structured list with page citations: (1) every party and their role, (2) every date and deadline, (3) every obligation and who owes it.' },
  { label: 'Risky clauses', task: 'Identify clauses a lawyer should scrutinize — indemnification, limitation of liability, auto-renewal, unilateral termination, governing law/venue, non-compete, unusual or one-sided terms. For each, quote it, cite the page, and explain the risk plainly.' },
  { label: 'Explain the selection', task: 'Explain the highlighted selection in plain, non-jargon language, and note any obligations or risks it creates. If nothing is highlighted, explain the current page.' },
  { label: 'Summary memo', task: 'Draft a concise internal summary memo of this document for a supervising attorney: what it is, the parties, key obligations and dates, notable risks, and open questions. Cite pages.' },
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let doc: PdfDocument | null = null;
let pages: PageText[] = []; // per-page extracted text for the open document
let current = 1; // 1-based current page
let controller: AbortController | null = null;
let renderToken = 0; // guards against a stale async render landing after a newer one

window.addEventListener('DOMContentLoaded', () => {
  const fileInput = $<HTMLInputElement>('file');
  const canvas = $<HTMLCanvasElement>('page');
  const viewerScroll = $('viewer-scroll');
  const prevBtn = $<HTMLButtonElement>('prev');
  const nextBtn = $<HTMLButtonElement>('next');
  const pageLabel = $('pagelabel');
  const docStatus = $('docstatus');

  const promptEl = $<HTMLTextAreaElement>('prompt');
  const runBtn = $<HTMLButtonElement>('run');
  const stopBtn = $<HTMLButtonElement>('stop');
  const outputEl = $('output');
  const statusEl = $('status');
  const scopeEl = $<HTMLSelectElement>('scope');
  const modelEl = $<HTMLSelectElement>('model');
  const chipRow = $('chips');
  const apiKeyEl = $<HTMLInputElement>('apikey');
  const saveKeyBtn = $<HTMLButtonElement>('savekey');
  const authHint = $('authhint');

  // ── quick-action chips ───────────────────────────────────────────────────
  for (const a of QUICK_ACTIONS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.onclick = () => { promptEl.value = a.task; void run(a.task); };
    chipRow.appendChild(b);
  }

  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();

  // ── open a PDF ───────────────────────────────────────────────────────────
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    doc?.destroy();
    doc = null;
    pages = [];
    outputEl.textContent = '';
    setDocStatus(`Opening ${file.name}…`);
    try {
      const buf = await file.arrayBuffer();
      doc = await PdfDocument.open(buf);
      current = 1;
      await renderCurrent(canvas, viewerScroll);
      updatePager(prevBtn, nextBtn, pageLabel);
      setDocStatus(`Extracting text from ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}…`);
      pages = await doc.allText((done, total) => setDocStatus(`Extracting text… ${done}/${total}`));
      const chars = pages.reduce((n, p) => n + p.text.length, 0);
      setDocStatus(
        chars === 0
          ? `${file.name} — no selectable text found (scanned image?). AI answers need text; OCR is not available here.`
          : `${file.name} — ${doc.numPages} pages, ${chars.toLocaleString()} chars of text. Ready.`,
        chars === 0 ? 'warn' : 'ok',
      );
    } catch (e: any) {
      setDocStatus(errMessage(e), 'error');
    }
  };

  // ── page navigation ──────────────────────────────────────────────────────
  prevBtn.onclick = () => void goto(current - 1);
  nextBtn.onclick = () => void goto(current + 1);
  window.addEventListener('keydown', (e) => {
    if (!doc) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return; // don't hijack typing
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); void goto(current - 1); }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); void goto(current + 1); }
  });

  async function goto(n: number) {
    if (!doc) return;
    const clamped = Math.min(Math.max(n, 1), doc.numPages);
    if (clamped === current) return;
    current = clamped;
    await renderCurrent(canvas, viewerScroll);
    updatePager(prevBtn, nextBtn, pageLabel);
  }

  // Re-render on resize so the page always fits the (possibly resized) viewer.
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (doc) void renderCurrent(canvas, viewerScroll); }, 150);
  });

  // ── run an AI task ───────────────────────────────────────────────────────
  runBtn.onclick = () => void run(promptEl.value.trim());
  stopBtn.onclick = () => controller?.abort();

  async function run(task: string) {
    if (!task) { setStatus('Type a question or pick an action.', 'warn'); return; }
    if (!doc || pages.length === 0) {
      setStatus('Open a PDF with selectable text first.', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    outputEl.textContent = '';

    // Scope: whole document (windowed from page 1) or the current page only.
    const scope = scopeEl.value;
    const ctx = scope === 'page'
      ? buildContext(pages, CONTEXT_CHAR_BUDGET, current)
      : buildContext(pages, CONTEXT_CHAR_BUDGET, 1);
    const selection = readSelection();

    setStatus(contextNote(ctx));
    try {
      await askStream(
        task, ctx, bearer(),
        (delta) => { outputEl.textContent += delta; outputEl.scrollTop = outputEl.scrollHeight; },
        selection,
        { model: modelEl.value || DEFAULT_MODEL, signal: controller.signal },
      );
      setStatus(outputEl.textContent ? 'Done.' : 'No content returned.', outputEl.textContent ? 'ok' : 'warn');
    } catch (e: any) {
      if (e?.name === 'AbortError') { setStatus('Stopped.', 'warn'); return; }
      setStatus(errMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  // The user's text selection inside the rendered page's text layer, if any.
  function readSelection(): string {
    const sel = window.getSelection?.();
    return sel ? sel.toString().trim() : '';
  }

  // ── auth (pasted key) ────────────────────────────────────────────────────
  saveKeyBtn.onclick = async () => {
    const key = apiKeyEl.value.trim();
    if (!key) {
      clearApiKey();
      reflectAuth();
      void populateModels();
      setStatus('API key cleared.', 'ok');
      return;
    }
    setStatus('Validating key…');
    try {
      const models = await validateKey(key); // real /v1/models call — rejects a dead key
      setApiKey(key);
      fillModels(models);
      reflectAuth();
      setStatus(`Key saved — ${models.length} model${models.length === 1 ? '' : 's'} available.`, 'ok');
    } catch (e: any) {
      setStatus(`Key rejected: ${errMessage(e)}`, 'error');
    }
  };

  function reflectAuth() {
    authHint.textContent = hasApiKey()
      ? 'Ready — using your Hanzo API key.'
      : 'Paste a Hanzo API key (sk-…) to use your models. Anonymous public models may also work.';
  }

  async function populateModels() {
    try {
      fillModels(await listModels(bearer()));
    } catch {
      modelEl.innerHTML = `<option value="${DEFAULT_MODEL}">${DEFAULT_MODEL}</option>`;
    }
  }
  function fillModels(ids: string[]) {
    const sorted = [...ids].sort();
    if (!sorted.length) { modelEl.innerHTML = `<option value="${DEFAULT_MODEL}">${DEFAULT_MODEL}</option>`; return; }
    modelEl.innerHTML = '';
    for (const id of sorted) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      modelEl.appendChild(opt);
    }
    modelEl.value = sorted.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : sorted[0];
  }

  // ── render + UI helpers ──────────────────────────────────────────────────
  async function renderCurrent(canvas: HTMLCanvasElement, scroll: HTMLElement) {
    if (!doc) return;
    const token = ++renderToken;
    const width = Math.max(scroll.clientWidth - 24, 200); // padding allowance
    await doc.render(current, canvas, width);
    if (token !== renderToken) return; // a newer render superseded us
    scroll.scrollTop = 0;
  }
  function updatePager(prev: HTMLButtonElement, next: HTMLButtonElement, label: HTMLElement) {
    const n = doc?.numPages ?? 0;
    label.textContent = n ? `${current} / ${n}` : '—';
    prev.disabled = !doc || current <= 1;
    next.disabled = !doc || current >= n;
  }
  function setBusy(busy: boolean) {
    runBtn.disabled = busy;
    stopBtn.style.display = busy ? '' : 'none';
    for (const c of Array.from(document.querySelectorAll<HTMLButtonElement>('.chip'))) c.disabled = busy;
  }
  function setStatus(msg: string, kind: 'ok' | 'warn' | 'error' | '' = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + kind;
  }
  function setDocStatus(msg: string, kind: 'ok' | 'warn' | 'error' | '' = '') {
    docStatus.textContent = msg;
    docStatus.className = 'docstatus ' + kind;
  }
});

function errMessage(e: any): string {
  return e?.message ? String(e.message) : String(e);
}
