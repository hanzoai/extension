/**
 * KMS (Key Management / Secrets) client — shared across all browser targets.
 *
 * Lightweight fetch-based client for Hanzo KMS. Uses IAM bearer tokens for
 * auth — no separate KMS credentials needed.
 *
 * Every path is `/v1/kms/...`, which is the Hanzo `/v1/<service>/<endpoint>`
 * convention and, more importantly, what the server actually serves:
 *
 *   GET    /v1/kms/orgs/{org}/secrets?path=&env=        → list names
 *   GET    /v1/kms/orgs/{org}/secrets/{path}/{name}?env= → read one value
 *   POST   /v1/kms/orgs/{org}/secrets                    → create or replace
 *   DELETE /v1/kms/orgs/{org}/secrets/{path}/{name}?env= → delete
 *
 * This file used to speak Infisical's shape under an `/api/v3` prefix, with a
 * header comment reporting that `/v1/kms/...` had been *verified* to return SPA
 * HTML while `/api/v3/secrets/raw` returned JSON — so `/api/v3` was pinned as
 * the working path and a rewrite was awaited. The observation was real and the
 * conclusion was backwards: the KMS binary embedded a console SPA under a root
 * catch-all, so it answered EVERY unmatched path with 200 text/html. The HTML
 * was the 404. luxfi/kms 1.12.8 removed the catch-all, and the same probe now
 * reads the other way round — `/v1/kms/...` answers JSON, `/api/v3/...` is a
 * JSON 404. There is no gateway rewrite to wait for.
 *
 * Create and update are ONE call because the server has one upsert, not two
 * endpoints. Listing arrived in luxfi/kms 1.12.9; before that the HTTP surface
 * had no list at all, which is what made the Infisical prefix look necessary.
 */

import { KMS_API_URL } from './config.js';

// ── Types ───────────────────────────────────────────────────────────────

/** Where a secret lives. `path` groups secrets; `name` identifies one. */
export interface KmsRef {
  /** Org scope — also the scope of the bearer token that reads it. */
  org: string;
  /** Environment slug (`dev` / `test` / `main`). Defaults to `default`. */
  env?: string;
  /** Grouping path, e.g. `gateway`. Omit to address the org root. */
  path?: string;
}

/** A ref plus the name of a single secret. */
export interface KmsSecretRef extends KmsRef {
  name: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function kmsHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function kmsUrl(path: string, baseUrl?: string): string {
  return `${baseUrl || KMS_API_URL}${path}`;
}

/** The collection URL for an org, with `path`/`env` as query. */
function collectionUrl(ref: KmsRef, baseUrl?: string): string {
  const q = new URLSearchParams();
  if (ref.path) q.set('path', ref.path);
  q.set('env', ref.env || 'default');
  return kmsUrl(`/v1/kms/orgs/${encodeURIComponent(ref.org)}/secrets?${q}`, baseUrl);
}

/**
 * The URL of one secret. The server splits the trailing `{rest...}` at its LAST
 * slash into (path, name), so each segment is escaped on its own — escaping the
 * joined string would encode the separators and the server would read one long
 * name.
 */
function secretUrl(ref: KmsSecretRef, baseUrl?: string): string {
  const segs = [...(ref.path ? ref.path.split('/') : []), ref.name]
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join('/');
  const q = new URLSearchParams({ env: ref.env || 'default' });
  return kmsUrl(`/v1/kms/orgs/${encodeURIComponent(ref.org)}/secrets/${segs}?${q}`, baseUrl);
}

async function fail(op: string, resp: Response): Promise<never> {
  throw new Error(`KMS ${op} failed: ${resp.status} ${await resp.text()}`);
}

// ── API Functions ───────────────────────────────────────────────────────

/** List the names of the secrets under a path. */
export async function kmsListSecrets(
  token: string,
  ref: KmsRef,
  baseUrl?: string,
): Promise<string[]> {
  const resp = await fetch(collectionUrl(ref, baseUrl), { headers: kmsHeaders(token) });
  if (!resp.ok) return fail('list', resp);
  const data = await resp.json();
  return data.names ?? [];
}

/** Read one secret's value. */
export async function kmsGetSecret(
  token: string,
  ref: KmsSecretRef,
  baseUrl?: string,
): Promise<string> {
  const resp = await fetch(secretUrl(ref, baseUrl), { headers: kmsHeaders(token) });
  if (!resp.ok) return fail('get', resp);
  const data = await resp.json();
  return data.secret?.value ?? '';
}

/**
 * Create a secret, or replace it if the name already exists. One call, because
 * the server has one upsert — there is no separate create and update.
 */
export async function kmsPutSecret(
  token: string,
  ref: KmsSecretRef,
  value: string,
  baseUrl?: string,
): Promise<void> {
  const resp = await fetch(
    kmsUrl(`/v1/kms/orgs/${encodeURIComponent(ref.org)}/secrets`, baseUrl),
    {
      method: 'POST',
      headers: kmsHeaders(token),
      body: JSON.stringify({
        path: ref.path ?? '',
        name: ref.name,
        env: ref.env || 'default',
        value,
      }),
    },
  );
  if (!resp.ok) return fail('put', resp);
}

/** Delete a secret. */
export async function kmsDeleteSecret(
  token: string,
  ref: KmsSecretRef,
  baseUrl?: string,
): Promise<void> {
  const resp = await fetch(secretUrl(ref, baseUrl), {
    method: 'DELETE',
    headers: kmsHeaders(token),
  });
  if (!resp.ok) return fail('delete', resp);
}
