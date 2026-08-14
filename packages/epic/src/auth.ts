// The HANZO-gateway credential for the web panel — the zero-setup pasted-key
// path. This is ONLY the Hanzo model-gateway bearer (an `sk-…` key or an IAM
// token); it is emphatically NOT the FHIR/PHI token. The FHIR access token lives
// server-side (server.ts) and is never handled here — the panel holds only the
// opaque server session cookie for FHIR reads. So a leaked localStorage key
// exposes a Hanzo gateway key, never PHI.
//
// Mirrors @hanzo/docusign / @hanzo/pdf exactly (one way to hold a Hanzo key): a
// key pasted into the panel, validated by a real /v1/models call so a bad key is
// rejected at paste time.

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

export function hasApiKey(): boolean {
  return !!getApiKey();
}

// bearer is the credential the chat call sends to the HANZO gateway: the pasted
// key, else empty (anonymous public models). When Hanzo IAM OAuth lands it slots
// in as the second argument to pickBearer with no change to callers.
export function bearer(): string {
  return pickBearer(getApiKey(), '');
}

// validateKey confirms a pasted key works by listing models with it. Returns the
// model ids on success so the caller populates the picker in one round-trip;
// throws with the gateway's message on failure. Empty key → clear message.
export async function validateKey(key: string): Promise<string[]> {
  const k = key.trim();
  if (!k) throw new Error('Enter a Hanzo API key (sk-…).');
  return listModels({ token: k });
}
