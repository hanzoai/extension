// Task-pane orchestration: wire the UI to read the selection, call Hanzo, and
// insert the result. The logic-heavy parts (chat shaping, host read/insert,
// auth) live in their own tested modules; this is the glue that binds them to
// the DOM once Office is ready.

/* global Office, document */

import { ask } from './chat.js';
import { readSelection, insertResult, currentHost, type InsertMode } from './host.js';
import { bearer, getApiKey, setApiKey, clearApiKey, signIn, clearToken, getToken } from './auth.js';

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
  const signInBtn = $('signin') as HTMLButtonElement;
  const signOutBtn = $('signout') as HTMLButtonElement;
  const apiKeyEl = $('apikey') as HTMLInputElement;
  const saveKeyBtn = $('savekey') as HTMLButtonElement;

  $('hostname').textContent = hostLabel(currentHost());
  apiKeyEl.value = getApiKey();
  reflectAuth();

  let controller: AbortController | null = null;

  runBtn.onclick = async () => {
    const task = promptEl.value.trim();
    if (!task) {
      setStatus('Type an instruction first.', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true, 'Reading selection…');
    try {
      const selection = await readSelection();
      setStatus('Asking Hanzo…');
      const result = await ask(task, selection, bearer(), { signal: controller.signal });
      outputEl.value = result;
      insertBtn.disabled = false;
      setStatus('Done — review, then Insert.', 'ok');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setStatus(errMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

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
