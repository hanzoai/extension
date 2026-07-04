// The shared assistant panel — host-agnostic DOM wiring over @hanzo/ai. Both the
// Zoom App (zoom/main.ts) and the Google Meet add-on (meet/main.ts) mount THIS
// with a PanelHost; the panel never imports a platform SDK. It renders: a model
// picker (populated from /v1/models when a key is present), quick-action chips
// (Summarize / Action items / Follow-up email), a prompt box, and a streaming
// output area. Same UX language as the Office task pane and the PDF workspace.
//
// This module is the DOM glue; all the testable logic (windowing, prompt
// assembly, request shaping, streaming parse) lives in hanzo.ts and is unit-
// tested there. The panel just binds it to the page.

import { DEFAULT_MODEL } from '../config.js';
import {
  buildTranscriptContext,
  contextNote,
  askStream,
  listModels,
  QUICK_ACTIONS,
  type TranscriptContext,
  type MeetingContext,
} from '../hanzo.js';
import { bearer, getApiKey, setApiKey, validateKey } from '../auth.js';
import type { PanelHost } from './host.js';

// $ is a tiny typed getElementById. The panel HTML (panel.html) guarantees these
// ids exist, so a missing one is a programming error, not a user error.
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`panel: #${id} missing from the page`);
  return el as T;
}

function setStatus(el: HTMLElement, text: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
  el.textContent = text;
  el.className = kind ? `status ${kind}` : 'status';
}

// populateModels fills the picker from /v1/models (org-scoped by the bearer).
// Falls back to the default model when unauthenticated or the list fails — the
// panel is always usable.
async function populateModels(select: HTMLSelectElement, token: string): Promise<void> {
  let ids: string[] = [];
  try {
    ids = token ? await listModels(token) : [];
  } catch {
    ids = [];
  }
  if (ids.length === 0) ids = [DEFAULT_MODEL];
  const current = select.value;
  select.innerHTML = '';
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  }
  select.value = ids.includes(current) ? current : ids[0];
}

// gatherContext pulls the transcript + meeting metadata from the host and windows
// the transcript to the budget. Shown to the user as an honest scope note.
async function gatherContext(host: PanelHost): Promise<{ ctx: TranscriptContext; meta: MeetingContext }> {
  const [segments, meta] = await Promise.all([host.getTranscript(), host.getMeetingContext()]);
  return { ctx: buildTranscriptContext(segments), meta };
}

// run executes one streaming completion for `task` and types the result into the
// output area. Shared by the chips and the "Ask" button.
async function run(host: PanelHost, task: string, els: PanelEls): Promise<void> {
  const trimmed = task.trim();
  if (!trimmed) {
    setStatus(els.status, 'Type a question or pick a quick action.', 'warn');
    return;
  }
  els.run.disabled = true;
  els.output.value = '';
  try {
    const { ctx, meta } = await gatherContext(host);
    setStatus(els.status, contextNote(ctx));
    const token = bearer();
    const model = els.model.value || DEFAULT_MODEL;
    await askStream(
      trimmed,
      ctx,
      token,
      (delta) => {
        els.output.value += delta;
        els.output.scrollTop = els.output.scrollHeight;
      },
      meta,
      { model },
    );
    setStatus(els.status, contextNote(ctx), 'ok');
  } catch (e: any) {
    setStatus(els.status, e?.message || 'Request failed.', 'error');
  } finally {
    els.run.disabled = false;
  }
}

interface PanelEls {
  model: HTMLSelectElement;
  prompt: HTMLTextAreaElement;
  output: HTMLTextAreaElement;
  run: HTMLButtonElement;
  status: HTMLElement;
  apikey: HTMLInputElement;
  savekey: HTMLButtonElement;
  authhint: HTMLElement;
  hostname: HTMLElement;
}

// The quick-action chips map their data-task to a QUICK_ACTIONS prompt (or their
// own inline text). Named actions keep the panel and the webhook summary in sync.
const CHIP_TASKS: Record<string, string> = {
  summary: QUICK_ACTIONS.summary,
  'action-items': QUICK_ACTIONS.actionItems,
  'followup-email': QUICK_ACTIONS.followupEmail,
};

// mountPanel wires the DOM to a host. Call once on DOMContentLoaded from each
// platform entry after the host is ready.
export function mountPanel(host: PanelHost): void {
  const els: PanelEls = {
    model: $('model'),
    prompt: $('prompt'),
    output: $('output'),
    run: $('run'),
    status: $('status'),
    apikey: $('apikey'),
    savekey: $('savekey'),
    authhint: $('authhint'),
    hostname: $('hostname'),
  };
  els.hostname.textContent = host.name;

  // Reflect the current auth state and populate models.
  const refreshAuth = async (): Promise<void> => {
    const key = getApiKey();
    els.authhint.textContent = key ? 'Using your saved Hanzo API key.' : 'Paste a Hanzo API key (hk-…) to use your models.';
    await populateModels(els.model, bearer());
  };
  void refreshAuth();

  // Save / validate a pasted key.
  els.savekey.addEventListener('click', async () => {
    const key = els.apikey.value.trim();
    try {
      const models = await validateKey(key);
      setApiKey(key);
      els.apikey.value = '';
      setStatus(els.status, 'Key saved.', 'ok');
      els.authhint.textContent = `Saved. ${models.length} model${models.length === 1 ? '' : 's'} available.`;
      await populateModels(els.model, bearer());
    } catch (e: any) {
      setStatus(els.status, e?.message || 'That key did not work.', 'error');
    }
  });

  // Quick-action chips.
  for (const chip of Array.from(document.querySelectorAll<HTMLButtonElement>('.chip'))) {
    chip.addEventListener('click', () => {
      const key = chip.getAttribute('data-action') || '';
      const task = CHIP_TASKS[key];
      if (task) void run(host, task, els);
    });
  }

  // Ask button + Ctrl/Cmd-Enter in the prompt.
  els.run.addEventListener('click', () => void run(host, els.prompt.value, els));
  els.prompt.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run(host, els.prompt.value, els);
    }
  });
}
