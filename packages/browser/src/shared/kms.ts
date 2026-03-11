/**
 * KMS (Key Management / Secrets) client — shared across all browser targets.
 *
 * Lightweight fetch-based client for Hanzo KMS (kms.hanzo.ai).
 * Uses IAM bearer tokens for auth — no separate KMS credentials needed.
 *
 * API surface mirrors @hanzo/kms-sdk SecretsApi:
 *   GET    /api/v3/secrets/raw              → list
 *   GET    /api/v3/secrets/raw/:name        → get
 *   POST   /api/v3/secrets/raw/:name        → create
 *   PATCH  /api/v3/secrets/raw/:name        → update
 *   DELETE /api/v3/secrets/raw/:name        → delete
 */

import { KMS_API_URL } from './config.js';

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
  const resp = await fetch(kmsUrl(`/api/v3/secrets/raw${query}`, baseUrl), {
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
    kmsUrl(`/api/v3/secrets/raw/${encodeURIComponent(params.secretName)}${query}`, baseUrl),
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
    kmsUrl(`/api/v3/secrets/raw/${encodeURIComponent(params.secretName)}`, baseUrl),
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
    kmsUrl(`/api/v3/secrets/raw/${encodeURIComponent(params.secretName)}`, baseUrl),
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
    kmsUrl(`/api/v3/secrets/raw/${encodeURIComponent(params.secretName)}`, baseUrl),
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
