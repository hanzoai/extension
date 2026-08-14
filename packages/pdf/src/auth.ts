// Auth for the web PDF workspace: the zero-setup pasted-key path. The key lives
// in localStorage (this is a static web app, not an Office host with
// roamingSettings) and is validated by a real /v1/models call — a key that
// can't list models is rejected before it's saved, so the user learns at paste
// time, not at first question. OAuth via hanzo.id (device login) is the
// documented future upgrade; the bearer plumbing already tolerates any token,
// so adding it is additive, not a rewrite.

import { APIKEY_STORAGE_KEY, pickBearer } from './config.js';
import { listModels } from './chat.js';

export function getApiKey(): string {
  try {
    return localStorage.getItem(APIKEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    const k = key.trim();
    if (k) localStorage.setItem(APIKEY_STORAGE_KEY, k);
    else localStorage.removeItem(APIKEY_STORAGE_KEY);
  } catch {
    /* private-mode / storage disabled — the in-memory key still works this session */
  }
}

export function clearApiKey(): void {
  setApiKey('');
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

// bearer is the credential the chat call sends. Today that's the pasted key (or
// empty for anonymous public models); when OAuth lands it slots in as the second
// argument to pickBearer with no change to callers.
export function bearer(): string {
  return pickBearer(getApiKey(), '');
}

// validateKey confirms a pasted key actually works by listing models with it.
// Returns the models on success so the caller can populate the picker in one
// round-trip; throws with the gateway's message on failure.
export async function validateKey(key: string): Promise<string[]> {
  const k = key.trim();
  if (!k) throw new Error('Enter a Hanzo API key (sk-…).');
  return listModels(k);
}
