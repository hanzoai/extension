/**
 * KMS (Key Management / Secrets) client — shared across all browser targets.
 *
 * Lightweight fetch-based client for Hanzo Cloud's embedded KMS (`/v1/kms`).
 * Uses IAM bearer tokens for auth — the tenant org is bound from the validated
 * token claim (`principal.Acting`), with optional `X-Hanzo-Org` header when
 * acting across orgs as superadmin.
 *
 *   GET    /v1/kms/secrets?path=&env=        → list names & metadata
 *   GET    /v1/kms/secrets/{path}/{name}?env= → read one value ({ value })
 *   POST   /v1/kms/secrets                    → create or replace (upsert)
 *   DELETE /v1/kms/secrets/{path}/{name}?env= → delete
 */

import { KMS_API_URL } from './config.js';

// ── Types ───────────────────────────────────────────────────────────────

/** Where a secret lives. `path` groups secrets; `name` identifies one. */
export interface KmsRef {
  /** Org scope (sent as X-Hanzo-Org when present; token claim is authoritative). */
  org?: string;
  /** Environment slug (`default` / `dev` / `production` / `main`). Defaults to `default`. */
  env?: string;
  /** Grouping path, e.g. `social` or `gateway`. Omit to address the org root. */
  path?: string;
}

/** A ref plus the name of a single secret. */
export interface KmsSecretRef extends KmsRef {
  name: string;
}

export interface KmsSecretMeta {
  name: string;
  path?: string;
  env?: string;
  scheme?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function kmsHeaders(token: string, org?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (org) headers['X-Hanzo-Org'] = org;
  return headers;
}

function kmsUrl(path: string, baseUrl?: string): string {
  return `${(baseUrl || KMS_API_URL).replace(/\/+$/, '')}${path}`;
}

/** The collection URL for the caller's org, with `path`/`env` as query. */
function collectionUrl(ref: KmsRef, baseUrl?: string): string {
  const q = new URLSearchParams();
  if (ref.path) q.set('path', ref.path);
  q.set('env', ref.env || 'default');
  return kmsUrl(`/v1/kms/secrets?${q}`, baseUrl);
}

/**
 * The URL of one secret. The server splits the trailing `{+1}` at its LAST
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
  return kmsUrl(`/v1/kms/secrets/${segs}?${q}`, baseUrl);
}

async function fail(op: string, resp: Response): Promise<never> {
  throw new Error(`KMS ${op} failed: ${resp.status} ${await resp.text()}`);
}

// ── API Functions ───────────────────────────────────────────────────────

/** List the names of the secrets under a path. */
export async function kmsListSecrets(
  token: string,
  ref: KmsRef = {},
  baseUrl?: string,
): Promise<string[]> {
  const resp = await fetch(collectionUrl(ref, baseUrl), { headers: kmsHeaders(token, ref.org) });
  if (!resp.ok) return fail('list', resp);
  const data = await resp.json();
  if (Array.isArray(data)) return data.map((s) => (typeof s === 'string' ? s : String(s?.name ?? s?.secretKey ?? ''))).filter(Boolean);
  return data.names ?? [];
}

/** Read one secret's value (only for internal worker egress/injection — never return to LLM). */
export async function kmsGetSecret(
  token: string,
  ref: KmsSecretRef,
  baseUrl?: string,
): Promise<string> {
  const resp = await fetch(secretUrl(ref, baseUrl), { headers: kmsHeaders(token, ref.org) });
  if (!resp.ok) return fail('get', resp);
  const data = await resp.json();
  return data.value ?? data.secret?.value ?? '';
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
    kmsUrl('/v1/kms/secrets', baseUrl),
    {
      method: 'POST',
      headers: kmsHeaders(token, ref.org),
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
    headers: kmsHeaders(token, ref.org),
  });
  if (!resp.ok) return fail('delete', resp);
}
