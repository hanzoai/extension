// Task-pane orchestration for Outlook: wire the UI to read the open message (or
// the compose draft), call Hanzo, stream the result, and either insert it into a
// compose reply or open a reply form. The logic-heavy parts (chat shaping, mail
// body extraction, auth) live in their own tested modules; this is the glue that
// binds them to the DOM once Office is ready.

/* global Office, document */

import { askStream, listModels } from './chat.js';
import { readContext, insertDraft, startReply, currentMailMode, type ReplyMode } from './outlook-host.js';
import { bearer, getApiKey, setApiKey, clearApiKey, signIn, clearToken, hasApiKey, hasSession } from './auth.js';
import { DEFAULT_MODEL } from './config.js';

Office.onReady((info) => {
  if (info.host !== Office.HostType.Outlook) {
    return; // not Outlook — the pane shows its static "unsupported" note
  }
  const $ = (id: string) => document.getElementById(id) as HTMLElement;

  const promptEl = $('prompt') as HTMLTextAreaElement;
  const runBtn = $('run') as HTMLButtonElement;
  const statusEl = $('status');
  const outputEl = $('output') as HTMLTextAreaElement;
  const insertBtn = $('insert') as HTMLButtonElement;
  const replyBtn = $('reply') as HTMLButtonElement;
  const modeEl = $('mode') as HTMLSelectElement;
  const modelEl = $('model') as HTMLSelectElement;
  const signInBtn = $('signin') as HTMLButtonElement;
  const signOutBtn = $('signout') as HTMLButtonElement;
  const apiKeyEl = $('apikey') as HTMLInputElement;
  const saveKeyBtn = $('savekey') as HTMLButtonElement;
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip'));

  const mode = currentMailMode();
  $('hostname').textContent = mode === 'compose' ? 'Compose' : 'Read';
  // In read mode there is no compose body to insert into — reply form is the
  // write path; in compose mode Insert writes the draft, reply form is N/A.
  insertBtn.style.display = mode === 'compose' ? '' : 'none';
  modeEl.style.display = mode === 'compose' ? '' : 'none';
  replyBtn.style.display = mode === 'read' ? '' : 'none';

  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();

  let controller: AbortController | null = null;

  // One code path for the Ask button AND the quick-action chips: read the open
  // message, stream the completion into the output, enable Insert/Reply.
  async function runTask(task: string) {
    if (!task) {
      setStatus('Type an instruction or pick an action first.', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true, 'Reading message…');
    outputEl.value = '';
    insertBtn.disabled = true;
    replyBtn.disabled = true;
    try {
      const context = await readContext();
      setStatus('Asking Hanzo…');
      await askStream(
        task,
        context,
        await bearer(),
        (delta) => { outputEl.value += delta; outputEl.scrollTop = outputEl.scrollHeight; },
        { model: modelEl.value || DEFAULT_MODEL, signal: controller.signal },
      );
      const has = !!outputEl.value;
      insertBtn.disabled = !has;
      replyBtn.disabled = !has;
      setStatus(has ? 'Done — review, then Insert or Draft reply.' : 'No content returned.', has ? 'ok' : 'warn');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setStatus(errMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  runBtn.onclick = () => runTask(promptEl.value.trim());

  // Quick-action chip: seed the prompt with its preset task, then run it.
  for (const chip of chips) {
    chip.onclick = () => {
      const task = chip.dataset.task ?? '';
      promptEl.value = task;
      void runTask(task);
    };
  }

  async function populateModels() {
    try {
      const ids = (await listModels(await bearer())).sort();
      if (!ids.length) return;
      modelEl.innerHTML = '';
      for (const id of ids) {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = id;
        modelEl.appendChild(opt);
      }
      modelEl.value = ids.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : ids[0];
    } catch {
      // Non-fatal — a fixed default still works; leave the picker with its default.
      modelEl.innerHTML = `<option value="${DEFAULT_MODEL}">${DEFAULT_MODEL}</option>`;
    }
  }

  insertBtn.onclick = async () => {
    const text = outputEl.value;
    if (!text) return;
    try {
      await insertDraft(text, (modeEl.value as ReplyMode) || 'prepend');
      setStatus('Inserted into the message.', 'ok');
    } catch (e: any) {
      setStatus(errMessage(e), 'error');
    }
  };

  replyBtn.onclick = () => {
    const text = outputEl.value;
    if (!text) return;
    try {
      startReply(text);
      setStatus('Reply drafted — review and send in the reply window.', 'ok');
    } catch (e: any) {
      setStatus(errMessage(e), 'error');
    }
  };

  signInBtn.onclick = async () => {
    setStatus('Opening Hanzo sign-in…');
    try {
      await signIn();
      setStatus('Signed in.', 'ok');
      reflectAuth();
      void populateModels(); // a token unlocks the caller's org-specific models
    } catch (e: any) {
      setStatus(errMessage(e), 'error');
    }
  };

  signOutBtn.onclick = async () => {
    await clearToken();
    setStatus('Signed out.', 'ok');
    reflectAuth();
  };

  saveKeyBtn.onclick = async () => {
    const key = apiKeyEl.value.trim();
    if (key) {
      await setApiKey(key);
      setStatus('API key saved — ready to use.', 'ok');
    } else {
      await clearApiKey();
      setStatus('API key cleared.', 'ok');
    }
    reflectAuth();
    void populateModels(); // the new key may unlock a different model set
  };

  function reflectAuth() {
    // Sync reflect only (no refresh/network): signed in via OAuth session or a
    // saved API key. bearer()/getToken() do the real (async) resolution at call
    // time; this just renders which credential is live.
    const oauth = hasSession();
    const keyed = hasApiKey();
    signInBtn.style.display = oauth ? 'none' : '';
    signOutBtn.style.display = oauth ? '' : 'none';
    $('authhint').textContent = (oauth || keyed)
      ? 'Ready — using ' + (keyed ? 'your API key.' : 'your Hanzo sign-in.')
      : 'Paste a Hanzo API key or sign in to use your models.';
  }
  function setBusy(busy: boolean, msg?: string) {
    runBtn.disabled = busy;
    for (const chip of chips) chip.disabled = busy;
    if (msg) setStatus(msg);
  }
  function setStatus(msg: string, kind: 'ok' | 'warn' | 'error' | '' = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + kind;
  }
});

function errMessage(e: any): string {
  return e?.message ? String(e.message) : String(e);
}
