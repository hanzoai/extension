// The IFRAME half of the plugin. It owns the DOM and the network: it renders the
// panel and is the ONLY place the model is called (via design-core over the
// published @hanzo/ai client). It never touches the document — instead it posts
// TextEdit[] / inserted text to the main thread (code.ts), which mutates nodes.
//
// Flow for one action:
//   chip click → design-core.stream(action, snapshot, note) [network]
//             → live tokens rendered in the output pane
//             → design-core.parseResult(action, snapshot, fullText)
//             → rewrite/rename: postMessage apply-edits  → code.ts writes nodes
//               variants:        render list, each with an "Insert" button
//               readonly:        the prose IS the result (critique / a11y)
//
// The panel logic is deliberately thin over design-core (all pure parsing +
// prompt building + request shaping is unit-tested there); this file is glue:
// state, event wiring, and postMessage.

import { DEFAULT_MODEL } from './config.js';
import {
  ACTIONS,
  getAction,
  parseResult,
  stream,
  listModels,
  validateKey,
  type ActionId,
} from './design-core.js';
import {
  isMainToUi,
  type MainToUi,
  type UiToMain,
  type SelectionSnapshot,
  type TextEdit,
} from './messaging.js';

// ---------------------------------------------------------------------------
// Tiny DOM helpers (no framework — one obvious way).
// ---------------------------------------------------------------------------

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

/** Post a typed message to the main thread. */
function toMain(msg: UiToMain): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

// ---------------------------------------------------------------------------
// Panel state.
// ---------------------------------------------------------------------------

const state = {
  apiKey: '',
  model: DEFAULT_MODEL,
  models: [] as string[],
  snapshot: { rootCount: 0, texts: [], nodes: [], truncated: false, editorType: 'figma' } as SelectionSnapshot,
  running: null as AbortController | null,
};

// ---------------------------------------------------------------------------
// Elements.
// ---------------------------------------------------------------------------

const keyGate = $('key-gate');
const panel = $('panel');
const keyInput = $('key-input') as HTMLInputElement;
const keySave = $('key-save') as HTMLButtonElement;
const keyStatus = $('key-status');
const modelSelect = $('model') as HTMLSelectElement;
const chips = $('chips');
const noteInput = $('note') as HTMLTextAreaElement;
const output = $('output');
const contextLine = $('context');
const cancelBtn = $('cancel') as HTMLButtonElement;
const signOut = $('sign-out') as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

function showKeyGate(show: boolean): void {
  keyGate.hidden = !show;
  panel.hidden = show;
}

function renderModels(): void {
  modelSelect.replaceChildren();
  const ids = state.models.length ? state.models : [state.model];
  for (const id of ids) {
    modelSelect.append(el('option', { value: id, textContent: id, selected: id === state.model }));
  }
}

function renderContext(): void {
  const s = state.snapshot;
  if (s.rootCount === 0) {
    contextLine.textContent = 'Select layers or a frame to begin.';
    return;
  }
  const parts = [`${s.rootCount} selected`];
  if (s.texts.length) parts.push(`${s.texts.length} text`);
  if (s.nodes.length) parts.push(`${s.nodes.length} other`);
  contextLine.textContent = parts.join(' · ') + (s.truncated ? ' · truncated to fit' : '');
}

/** A chip is disabled when its action needs text and the selection has none, or
 *  when nothing is selected at all — the panel never fires a useless request. */
function chipDisabled(action: ReturnType<typeof getAction>): boolean {
  if (state.snapshot.rootCount === 0) return true;
  if (action.needsText && state.snapshot.texts.length === 0) return true;
  return false;
}

function renderChips(): void {
  chips.replaceChildren();
  for (const id of Object.keys(ACTIONS) as ActionId[]) {
    const action = getAction(id);
    const btn = el('button', {
      className: 'chip',
      disabled: chipDisabled(action),
      title: action.hint,
      textContent: action.label,
      onclick: () => run(id),
    });
    chips.append(btn);
  }
}

function setBusy(busy: boolean): void {
  cancelBtn.hidden = !busy;
  for (const c of Array.from(chips.children)) (c as HTMLButtonElement).disabled = busy;
  if (!busy) renderChips();
}

/** Append the readonly prose / streamed text into the output pane. */
function writeOutput(text: string): void {
  output.textContent = text;
  output.scrollTop = output.scrollHeight;
}

/** Render variant options with an Insert button each (insert action). */
function renderVariants(variants: string[]): void {
  output.replaceChildren();
  if (variants.length === 0) {
    output.textContent = 'No variants returned.';
    return;
  }
  for (const v of variants) {
    const row = el('div', { className: 'variant' }, [
      el('span', { className: 'variant-text', textContent: v }),
      el('button', {
        className: 'variant-insert',
        textContent: 'Insert',
        onclick: () => toMain({ type: 'insert-text', text: v }),
      }),
    ]);
    output.append(row);
  }
}

// ---------------------------------------------------------------------------
// The one run funnel for every action.
// ---------------------------------------------------------------------------

async function run(actionId: ActionId): Promise<void> {
  if (state.running) return;
  const action = getAction(actionId);
  const controller = new AbortController();
  state.running = controller;
  setBusy(true);
  writeOutput('');

  try {
    const full = await stream(
      {
        actionId,
        snapshot: state.snapshot,
        note: noteInput.value,
        model: state.model,
        token: state.apiKey,
        signal: controller.signal,
      },
      // readonly actions stream live into the pane; write-back actions emit JSON
      // that would look like noise mid-stream, so we show a working line and
      // render the parsed result at the end.
      action.apply === 'readonly'
        ? (delta) => writeOutput(output.textContent + delta)
        : () => writeOutput('Working…'),
    );

    const result = parseResult(actionId, state.snapshot, full);
    if (result.variants) {
      renderVariants(result.variants);
    } else if (result.edits) {
      applyEdits(result.edits, action.label);
    } else {
      writeOutput(full);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      writeOutput('Cancelled.');
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      writeOutput(msg);
      toMain({ type: 'notify', message: msg, error: true });
    }
  } finally {
    state.running = null;
    setBusy(false);
  }
}

/** Hand the parsed edits to the main thread and summarize in the pane. */
function applyEdits(edits: TextEdit[], label: string): void {
  if (edits.length === 0) {
    writeOutput(`${label}: the model returned no applicable edits.`);
    return;
  }
  toMain({ type: 'apply-edits', edits });
  writeOutput(`${label}: applying ${edits.length} edit${edits.length === 1 ? '' : 's'}…`);
}

// ---------------------------------------------------------------------------
// Key gate.
// ---------------------------------------------------------------------------

async function saveKey(): Promise<void> {
  const key = keyInput.value.trim();
  keyStatus.textContent = 'Checking…';
  keySave.disabled = true;
  try {
    const models = await validateKey(key);
    state.apiKey = key;
    state.models = models;
    if (!models.includes(state.model)) state.model = models[0] ?? DEFAULT_MODEL;
    toMain({ type: 'save-key', key });
    toMain({ type: 'save-model', model: state.model });
    keyStatus.textContent = '';
    renderModels();
    showKeyGate(false);
  } catch (err) {
    keyStatus.textContent = err instanceof Error ? err.message : 'Key rejected.';
  } finally {
    keySave.disabled = false;
  }
}

function doSignOut(): void {
  state.apiKey = '';
  state.models = [];
  keyInput.value = '';
  toMain({ type: 'save-key', key: '' });
  showKeyGate(true);
}

// ---------------------------------------------------------------------------
// Boot + main-thread message pump.
// ---------------------------------------------------------------------------

keySave.onclick = () => void saveKey();
keyInput.onkeydown = (e) => {
  if (e.key === 'Enter') void saveKey();
};
signOut.onclick = doSignOut;
cancelBtn.onclick = () => state.running?.abort();
modelSelect.onchange = () => {
  state.model = modelSelect.value;
  toMain({ type: 'save-model', model: state.model });
};

window.onmessage = (event: MessageEvent) => {
  const msg: unknown = event.data?.pluginMessage;
  if (!isMainToUi(msg)) return;
  handle(msg);
};

async function handle(msg: MainToUi): Promise<void> {
  switch (msg.type) {
    case 'init': {
      state.apiKey = msg.apiKey;
      state.model = msg.model || DEFAULT_MODEL;
      if (state.apiKey) {
        showKeyGate(false);
        state.models = await listModels(state.apiKey);
        if (state.models.length && !state.models.includes(state.model)) state.model = state.models[0];
        renderModels();
      } else {
        showKeyGate(true);
      }
      break;
    }
    case 'selection':
      state.snapshot = msg.snapshot;
      renderContext();
      renderChips();
      break;
    case 'applied':
      writeOutput(msg.count > 0 ? `Applied ${msg.count} edit${msg.count === 1 ? '' : 's'}.` : 'No edits applied.');
      break;
  }
}

renderModels();
renderChips();
renderContext();
toMain({ type: 'ui-ready' });
