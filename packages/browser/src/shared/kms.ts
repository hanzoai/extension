/**
 * KMS (Key Management / Secrets) client — shared across all browser targets.
 *
 * Lightweight fetch-based client for Hanzo KMS (kms.hanzo.ai).
 * Uses IAM bearer tokens for auth — no separate KMS credentials needed.
 *
 * API path. Hanzo convention is `/v1/<service>/<endpoint>` — but the KMS
 * upstream is an Infisical fork that publishes its v3 API under the root
 * `${KMS_PATH_PREFIX}/secrets/raw`. The kms.hanzo.ai gateway currently passes that
 * through unchanged (verified: `kms.hanzo.ai/api/v3/secrets/raw` → 401 JSON,
 * `/v1/kms/...` → SPA HTML). We centralise the path in `KMS_PATH_PREFIX`
 * so the day the gateway adds the rewrite we update one constant.
 *
 *   GET    {KMS_PATH_PREFIX}/secrets/raw         → list
 *   GET    {KMS_PATH_PREFIX}/secrets/raw/:name   → get
 *   POST   {KMS_PATH_PREFIX}/secrets/raw/:name   → create
 *   PATCH  {KMS_PATH_PREFIX}/secrets/raw/:name   → update
 *   DELETE {KMS_PATH_PREFIX}/secrets/raw/:name   → delete
 */

import { KMS_API_URL } from './config.js';

/** Prefix for every KMS request. See file header. */
const KMS_PATH_PREFIX = '/api/v3';

// ── Types ───────────────────────────────────────────────────────────────

export interface KmsSecret {
  secretKey: string;
  secretValue?: string;
  version?: number;
  type?: string;
  environment?: string;
  secretPath?: string;
}

export interface KmsListParams {
  workspaceId: string;
  environment: string;
  secretPath?: string;
}

export interface KmsSecretParams extends KmsListParams {
  secretName: string;
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

function buildQuery(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  if (!entries.length) return '';
  return '?' + new URLSearchParams(entries).toString();
}

// ── API Functions ───────────────────────────────────────────────────────

/** List secrets in a workspace/environment */
export async function kmsListSecrets(
  token: string,
  params: KmsListParams,
  baseUrl?: string,
): Promise<KmsSecret[]> {
  const query = buildQuery({
    workspaceId: params.workspaceId,
    environment: params.environment,
    secretPath: params.secretPath,
  });
  const resp = await fetch(kmsUrl(`${KMS_PATH_PREFIX}/secrets/raw${query}`, baseUrl), {
    headers: kmsHeaders(token),
  });
  if (!resp.ok) throw new Error(`KMS list failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.secrets || data;
}

/** Get a single secret by name */
export async function kmsGetSecret(
  token: string,
  params: KmsSecretParams,
  baseUrl?: string,
): Promise<KmsSecret> {
  const query = buildQuery({
    workspaceId: params.workspaceId,
    environment: params.environment,
    secretPath: params.secretPath,
  });
  const resp = await fetch(
    kmsUrl(`${KMS_PATH_PREFIX}/secrets/raw/${encodeURIComponent(params.secretName)}${query}`, baseUrl),
    { headers: kmsHeaders(token) },
  );
  if (!resp.ok) throw new Error(`KMS get failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.secret || data;
}

/** Create a new secret */
export async function kmsCreateSecret(
  token: string,
  params: KmsSecretParams,
  value: string,
  baseUrl?: string,
): Promise<KmsSecret> {
  const resp = await fetch(
    kmsUrl(`${KMS_PATH_PREFIX}/secrets/raw/${encodeURIComponent(params.secretName)}`, baseUrl),
    {
      method: 'POST',
      headers: kmsHeaders(token),
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        environment: params.environment,
        secretPath: params.secretPath,
        secretValue: value,
        type: 'shared',
      }),
    },
  );
  if (!resp.ok) throw new Error(`KMS create failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.secret || data;
}

/** Update an existing secret */
export async function kmsUpdateSecret(
  token: string,
  params: KmsSecretParams,
  value: string,
  baseUrl?: string,
): Promise<KmsSecret> {
  const resp = await fetch(
    kmsUrl(`${KMS_PATH_PREFIX}/secrets/raw/${encodeURIComponent(params.secretName)}`, baseUrl),
    {
      method: 'PATCH',
      headers: kmsHeaders(token),
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        environment: params.environment,
        secretPath: params.secretPath,
        secretValue: value,
      }),
    },
  );
  if (!resp.ok) throw new Error(`KMS update failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.secret || data;
}

/** Delete a secret */
export async function kmsDeleteSecret(
  token: string,
  params: KmsSecretParams,
  baseUrl?: string,
): Promise<void> {
  const resp = await fetch(
    kmsUrl(`${KMS_PATH_PREFIX}/secrets/raw/${encodeURIComponent(params.secretName)}`, baseUrl),
    {
      method: 'DELETE',
      headers: kmsHeaders(token),
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        environment: params.environment,
        secretPath: params.secretPath,
      }),
    },
  );
  if (!resp.ok) throw new Error(`KMS delete failed: ${resp.status} ${await resp.text()}`);
}
