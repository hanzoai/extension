// Task-pane orchestration: wire the UI to read the selection, call Hanzo, and
// insert the result. The logic-heavy parts (chat shaping, host read/insert,
// auth) live in their own tested modules; this is the glue that binds them to
// the DOM once Office is ready.

/* global Office, document */

import { askStream, listModels } from './chat.js';
import { readSelection, insertResult, currentHost, type InsertMode } from './host.js';
import { bearer, getApiKey, setApiKey, clearApiKey, signIn, clearToken, getToken } from './auth.js';
import { DEFAULT_MODEL } from './config.js';

Office.onReady((info) => {
  if (
    info.host !== Office.HostType.Word &&
    info.host !== Office.HostType.Excel &&
    info.host !== Office.HostType.PowerPoint
  ) {
    return; // not a supported host — the pane shows its static "unsupported" note
  }
  const $ = (id: string) => document.getElementById(id) as HTMLElement;

  const promptEl = $('prompt') as HTMLTextAreaElement;
  const runBtn = $('run') as HTMLButtonElement;
  const statusEl = $('status');
  const outputEl = $('output') as HTMLTextAreaElement;
  const insertBtn = $('insert') as HTMLButtonElement;
  const modeEl = $('mode') as HTMLSelectElement;
  const modelEl = $('model') as HTMLSelectElement;
  const signInBtn = $('signin') as HTMLButtonElement;
  const signOutBtn = $('signout') as HTMLButtonElement;
  const apiKeyEl = $('apikey') as HTMLInputElement;
  const saveKeyBtn = $('savekey') as HTMLButtonElement;
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip'));

  $('hostname').textContent = hostLabel(currentHost());
  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();

  let controller: AbortController | null = null;

  // One code path for the Ask button AND the quick-action chips: read the
  // selection, stream the completion into the output, enable Insert.
  async function runTask(task: string) {
    if (!task) {
      setStatus('Type an instruction or pick an action first.', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true, 'Reading selection…');
    outputEl.value = '';
    insertBtn.disabled = true;
    try {
      const selection = await readSelection();
      setStatus('Asking Hanzo…');
      await askStream(
        task,
        selection,
        bearer(),
        (delta) => { outputEl.value += delta; outputEl.scrollTop = outputEl.scrollHeight; },
        { model: modelEl.value || DEFAULT_MODEL, signal: controller.signal },
      );
      insertBtn.disabled = !outputEl.value;
      setStatus(outputEl.value ? 'Done — review, then Insert.' : 'No content returned.', outputEl.value ? 'ok' : 'warn');
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
      const ids = (await listModels(bearer())).sort();
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
      await insertResult(text, (modeEl.value as InsertMode) || 'after');
      setStatus('Inserted into the document.', 'ok');
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
    // Signed-in state is either an OAuth token or a saved API key.
    const authed = !!bearer();
    const oauth = !!getToken();
    signInBtn.style.display = oauth ? 'none' : '';
    signOutBtn.style.display = oauth ? '' : 'none';
    $('authhint').textContent = authed
      ? 'Ready — using ' + (getApiKey() ? 'your API key.' : 'your Hanzo sign-in.')
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

function hostLabel(h: string): string {
  return { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' }[h] || 'Office';
}
function errMessage(e: any): string {
  return e?.message ? String(e.message) : String(e);
}
