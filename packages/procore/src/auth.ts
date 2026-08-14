// Auth for the web panel: the zero-setup pasted-key path for the Hanzo gateway.
// The Procore panel is a static web page (iframe), so the Hanzo credential lives
// in localStorage and is validated by a real /v1/models call — a key that can't
// list models is rejected before it's saved, so the user learns at paste time,
// not at first action. Mirrors @hanzo/docusign exactly (one way to hold a key).
//
// The Procore access token (for reading projects/RFIs/documents) is a SEPARATE
// credential minted server-side by the OAuth flow and held by server.ts; the
// panel reaches Procore only through the server proxy (with its session cookie),
// so it never holds the Procore token or secret. This module is only the
// Hanzo-gateway bearer.

import { APIKEY_STORAGE_KEY, pickBearer } from './config.js';
import { listModels } from './hanzo.js';

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

// bearer is the credential the chat call sends: the pasted key (or empty for
// anonymous public models). When Hanzo OAuth lands it slots in as the second
// argument to pickBearer with no change to callers.
export function bearer(): string {
  return pickBearer(getApiKey(), '');
}

// validateKey confirms a pasted key actually works by listing models with it.
// Returns the models on success so the caller populates the picker in one
// round-trip; throws with the gateway's message on failure.
export async function validateKey(key: string): Promise<string[]> {
  const k = key.trim();
  if (!k) throw new Error('Enter a Hanzo API key (sk-…).');
  return listModels({ token: k });
}
