// The panel glue: bind the pure Hanzo/ticket logic to the ticket-sidebar DOM and
// the ZAF host. Everything logic-heavy (message shaping, ticket windowing) lives
// in the pure, tested modules; this file is the one impure, browser-only entry.
//
// The Hanzo key is a SECURE installation setting, so model traffic goes through
// the Zendesk proxy (zaf.secureFetch) — the key never reaches the browser. We
// build ONE @hanzo/ai client over that fetch and run every quick action through
// it. The result is inserted back into the reply editor on demand.

import { createAiClient } from '@hanzo/ai';
import { QUICK_ACTIONS, complete, isQuickActionId, quickActionPrompt } from './hanzo.js';
import { buildContext, contextNote } from './ticket.js';
import {
  initZaf,
  getTicketContext,
  getModel,
  hasApiKey,
  appendReply,
  setCommentType,
  secureFetch,
  GATEWAY_BASE_URL,
  type ZafClient,
} from './zaf.js';
import { CONTEXT_CHAR_BUDGET } from './config.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let client: ZafClient;
let model = '';
let lastOutput = '';
let running = false;

window.addEventListener('DOMContentLoaded', () => {
  client = initZaf();
  void boot();

  const chipRow = $('chips');
  const promptEl = $<HTMLTextAreaElement>('prompt');
  const askBtn = $<HTMLButtonElement>('ask');
  const insertBtn = $<HTMLButtonElement>('insert');
  const noteBtn = $<HTMLButtonElement>('note');

  // Quick-action chips, in catalog order.
  for (const [id, action] of Object.entries(QUICK_ACTIONS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = action.label;
    b.dataset.action = id;
    b.onclick = () => void runAction(id);
    chipRow.appendChild(b);
  }

  askBtn.onclick = () => {
    const q = promptEl.value.trim();
    if (q) void run(q);
  };

  // Write-back: append the last output into the reply editor (public reply) or as
  // an internal note.
  insertBtn.onclick = async () => {
    if (!lastOutput) return;
    await setCommentType(client, 'publicReply');
    await appendReply(client, lastOutput);
    setStatus('Inserted into the reply editor.', 'ok');
  };
  noteBtn.onclick = async () => {
    if (!lastOutput) return;
    await setCommentType(client, 'internalNote');
    await appendReply(client, lastOutput);
    setStatus('Added as an internal note.', 'ok');
  };
});

/** Resolve the model + key state once the iframe loads. */
async function boot(): Promise<void> {
  model = await getModel(client);
  $('model').textContent = model;
  if (!(await hasApiKey(client))) {
    setStatus(
      'No Hanzo API key configured. An admin must set the Hanzo API key in this app’s settings (Admin → Apps).',
      'warn',
    );
  } else {
    setStatus('Ready. Pick an action or ask a question about this ticket.', 'ok');
  }
}

/** Run a quick action by id. */
async function runAction(id: string): Promise<void> {
  if (!isQuickActionId(id)) return;
  await run(quickActionPrompt(id));
}

/** The single path from the panel to the model: read the ticket, window it,
 *  complete through the secure-proxied @hanzo/ai client, and render. */
async function run(task: string): Promise<void> {
  if (running) return;
  running = true;
  setBusy(true);
  const outputEl = $('output');
  outputEl.textContent = '';
  lastOutput = '';
  try {
    const input = await getTicketContext(client);
    const ctx = buildContext(input, CONTEXT_CHAR_BUDGET);
    setStatus(contextNote(ctx));
    // ONE client, built over the secure proxy fetch so the key stays server-side.
    const ai = createAiClient({ baseUrl: GATEWAY_BASE_URL, fetch: secureFetch(client) });
    const text = await complete({ task, ctx, model, token: '', client: ai });
    lastOutput = text;
    outputEl.textContent = text || '(no content returned)';
    setStatus(text ? 'Done. Insert it into the reply, or add it as a note.' : 'No content returned.', text ? 'ok' : 'warn');
  } catch (e: unknown) {
    setStatus(errMessage(e), 'error');
  } finally {
    running = false;
    setBusy(false);
  }
}

function setBusy(busy: boolean): void {
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.chip, #ask'))) b.disabled = busy;
  $('spinner').style.display = busy ? '' : 'none';
}

function setStatus(msg: string, kind: 'ok' | 'warn' | 'error' | '' = ''): void {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
}

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
