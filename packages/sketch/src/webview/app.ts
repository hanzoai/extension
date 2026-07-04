// The assistant WebView. It renders the action bar, runs the selected design
// action through @hanzo/ai (the model call happens HERE — the WebView has
// `fetch`; the plugin CocoaScript runtime does not), and posts results back to
// the plugin over the sketch-module-web-view bridge for write-back.
//
// All prompt shaping, context assembly, and response parsing come from the PURE
// design-core; this file is only glue + DOM.

import {
  runAction,
  parseLayerEdits,
  resultNote,
  isPerLayer,
  ACTIONS,
  DEFAULT_MODEL,
  type ActionId,
  type Selection,
  type LayerEdit,
} from '../design-core.js';

// The bridge injected by sketch-module-web-view: `window.postMessage(name, arg)`
// invokes the matching `webContents.on(name, …)` handler in command.cjs.
declare global {
  interface Window {
    postMessage(name: string, payload?: unknown): void;
    __hanzoSeed?: (payload: SeedPayload) => void;
    __hanzoApplied?: (count: number) => void;
  }
}

interface SeedPayload {
  selection: Selection;
  action: ActionId;
  key: string;
  model: string;
}

const LABELS: Record<ActionId, string> = {
  critique: 'Critique',
  rewrite: 'Rewrite',
  translate: 'Translate',
  contentfill: 'Content fill',
  ask: 'Ask',
};

// Per-action label + placeholder for the detail field (empty label hides it).
const DETAIL: Record<ActionId, { label: string; placeholder: string } | null> = {
  critique: null,
  rewrite: { label: 'How to rewrite (optional)', placeholder: 'e.g. shorter, more confident' },
  translate: { label: 'Target language', placeholder: 'e.g. Spanish, Japanese' },
  contentfill: null,
  ask: { label: 'Your question', placeholder: 'What is this selection communicating?' },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  sel: $<HTMLSpanElement>('sel'),
  actionBar: $<HTMLDivElement>('actionBar'),
  detailWrap: $<HTMLDivElement>('detailWrap'),
  detailLabel: $<HTMLLabelElement>('detailLabel'),
  detail: $<HTMLTextAreaElement>('detail'),
  run: $<HTMLButtonElement>('run'),
  err: $<HTMLDivElement>('err'),
  result: $<HTMLDivElement>('result'),
  edits: $<HTMLDivElement>('edits'),
  editActions: $<HTMLDivElement>('editActions'),
  apply: $<HTMLButtonElement>('apply'),
  discard: $<HTMLButtonElement>('discard'),
  noteActions: $<HTMLDivElement>('noteActions'),
  insert: $<HTMLButtonElement>('insert'),
  key: $<HTMLInputElement>('key'),
  model: $<HTMLInputElement>('model'),
  save: $<HTMLButtonElement>('save'),
};

const state = {
  selection: { layers: [], totalCount: 0 } as Selection,
  action: 'critique' as ActionId,
  key: '',
  model: '',
  pendingEdits: null as LayerEdit[] | null,
  pendingNote: null as { heading: string; body: string } | null,
};

// ── Rendering ────────────────────────────────────────────────────────────────

function renderActions() {
  el.actionBar.textContent = '';
  for (const id of ACTIONS) {
    const b = document.createElement('button');
    b.textContent = LABELS[id];
    b.className = id === state.action ? 'active' : '';
    b.onclick = () => {
      state.action = id;
      renderActions();
      renderDetail();
      clearOutput();
    };
    el.actionBar.appendChild(b);
  }
}

function renderDetail() {
  const d = DETAIL[state.action];
  if (!d) {
    el.detailWrap.classList.add('hidden');
    return;
  }
  el.detailWrap.classList.remove('hidden');
  el.detailLabel.textContent = d.label;
  el.detail.placeholder = d.placeholder;
}

function renderSelection() {
  const n = state.selection.layers.length;
  const total = state.selection.totalCount;
  el.sel.textContent = total
    ? `${n} text layer${n === 1 ? '' : 's'} of ${total} selected`
    : 'no selection';
}

function clearOutput() {
  state.pendingEdits = null;
  state.pendingNote = null;
  hide(el.err, el.result, el.edits, el.editActions, el.noteActions);
}

function hide(...nodes: HTMLElement[]) {
  for (const n of nodes) n.classList.add('hidden');
}
function show(...nodes: HTMLElement[]) {
  for (const n of nodes) n.classList.remove('hidden');
}

function showError(message: string) {
  el.err.textContent = message;
  show(el.err);
}

// ── Running an action ────────────────────────────────────────────────────────

async function run() {
  clearOutput();
  if (!state.key) {
    showError('Add your Hanzo API key in “Hanzo key & model” above.');
    return;
  }
  el.run.disabled = true;
  el.run.textContent = 'Thinking…';
  try {
    const raw = await runAction({
      id: state.action,
      detail: el.detail.value,
      selection: state.selection,
      hanzoToken: state.key,
      model: state.model || DEFAULT_MODEL,
    });
    if (isPerLayer(state.action)) {
      const edits = parseLayerEdits(raw, state.selection.layers);
      renderEdits(edits);
    } else {
      renderNote(raw);
    }
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  } finally {
    el.run.disabled = false;
    el.run.textContent = 'Run';
  }
}

function renderEdits(edits: LayerEdit[]) {
  state.pendingEdits = edits;
  el.edits.textContent = '';
  const before = new Map(state.selection.layers.map((l) => [l.id, l.text]));
  for (const e of edits) {
    const card = document.createElement('div');
    card.className = 'edit';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = e.name || '(unnamed)';
    const oldText = document.createElement('div');
    oldText.className = 'before';
    oldText.textContent = before.get(e.id) ?? '';
    const newText = document.createElement('div');
    newText.textContent = e.text;
    card.append(name, oldText, newText);
    el.edits.appendChild(card);
  }
  show(el.edits, el.editActions);
}

function renderNote(raw: string) {
  const note = resultNote(state.action, raw);
  state.pendingNote = note;
  el.result.textContent = note.body;
  show(el.result, el.noteActions);
}

// ── Bridge to the plugin ─────────────────────────────────────────────────────

function applyEdits() {
  if (!state.pendingEdits) return;
  window.postMessage('applyEdits', { edits: state.pendingEdits });
}

function insertNote() {
  if (!state.pendingNote) return;
  window.postMessage('insertNote', { note: state.pendingNote });
}

function saveKey() {
  state.key = el.key.value.trim();
  state.model = el.model.value.trim();
  window.postMessage('saveKey', { key: state.key, model: state.model });
}

// The plugin calls this after it seeds/refreshes the WebView with the selection.
window.__hanzoSeed = (payload: SeedPayload) => {
  state.selection = payload.selection || { layers: [], totalCount: 0 };
  state.action = payload.action || 'critique';
  state.key = payload.key || '';
  state.model = payload.model || '';
  el.key.value = state.key;
  el.model.value = state.model;
  renderSelection();
  renderActions();
  renderDetail();
  clearOutput();
};

// Plugin confirms how many layers were written; clear the pending edits.
window.__hanzoApplied = () => {
  clearOutput();
};

// ── Wiring ───────────────────────────────────────────────────────────────────

el.run.onclick = run;
el.apply.onclick = applyEdits;
el.discard.onclick = clearOutput;
el.insert.onclick = insertNote;
el.save.onclick = saveKey;

renderActions();
renderDetail();
renderSelection();
// Ask the plugin to (re)push the current selection in case we opened before seed.
window.postMessage('refreshSelection');
