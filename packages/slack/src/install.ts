/**
 * OAuth installation storage — per-workspace Slack bot token + per-workspace
 * Hanzo credential, stored SERVER-SIDE only.
 *
 * Bolt drives the `/slack/install` + `/slack/oauth_redirect` flow and calls this
 * store to persist/fetch a workspace's `Installation`. We keep a small,
 * dependency-free file-backed store (one JSON file, keyed by team/enterprise id)
 * that also holds the Hanzo API token bound to each workspace, so a completion
 * runs under that workspace's own Hanzo identity. Swap the backend (KMS-backed,
 * Postgres, Valkey) by implementing {@link HanzoInstallationStore}.
 *
 * Tokens never leave the server and are never logged.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { Installation, InstallationQuery, InstallationStore } from '@slack/bolt';

/** The Hanzo credential bound to one workspace. */
export interface HanzoWorkspaceToken {
  /** `hk-…` API key or IAM bearer used as the gateway credential. */
  token: string;
  /** Org/owner the token belongs to, when known (from IAM validation). */
  owner?: string;
}

/** Installation store that also holds a per-workspace Hanzo token. */
export interface HanzoInstallationStore extends InstallationStore {
  /** Bind a Hanzo credential to a workspace. */
  setHanzoToken(teamId: string, token: HanzoWorkspaceToken): Promise<void>;
  /** Get the Hanzo credential for a workspace, or undefined. */
  getHanzoToken(teamId: string): Promise<HanzoWorkspaceToken | undefined>;
}

interface StoreFile {
  installations: Record<string, Installation>;
  hanzo: Record<string, HanzoWorkspaceToken>;
}

/** The identity fields we key on. A structural subset of `InstallationQuery`. */
export interface InstallKeyQuery {
  isEnterpriseInstall?: boolean;
  enterpriseId?: string;
  teamId?: string;
}

/** Key an installation query/record by enterprise (org install) or team id. */
export function installKey(q: InstallKeyQuery): string {
  if (q.isEnterpriseInstall && q.enterpriseId) return `E:${q.enterpriseId}`;
  if (q.teamId) return `T:${q.teamId}`;
  throw new Error('Installation query missing team/enterprise id');
}

/** Key an installation RECORD (from a completed OAuth) the same way. */
export function installKeyFromInstallation(installation: Installation): string {
  if (installation.isEnterpriseInstall && installation.enterprise?.id) {
    return `E:${installation.enterprise.id}`;
  }
  if (installation.team?.id) return `T:${installation.team.id}`;
  throw new Error('Installation missing team/enterprise id');
}

/**
 * File-backed {@link HanzoInstallationStore}. Reads the whole file per op — fine
 * for the small workspace counts a single Slack app has; move to a shared store
 * for horizontal scale. Named distinctly from Bolt's own `FileInstallationStore`
 * (which does not carry the Hanzo token).
 */
export class HanzoFileInstallationStore implements HanzoInstallationStore {
  constructor(private readonly path: string) {}

  private async read(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { installations: {}, hanzo: {} };
      }
      throw err;
    }
    // An empty or whitespace-only file (fresh/truncated store) is an empty store.
    if (!raw.trim()) return { installations: {}, hanzo: {} };
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return {
      installations: parsed.installations ?? {},
      hanzo: parsed.hanzo ?? {},
    };
  }

  private async write(data: StoreFile): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async storeInstallation(installation: Installation): Promise<void> {
    const data = await this.read();
    data.installations[installKeyFromInstallation(installation)] = installation;
    await this.write(data);
  }

  async fetchInstallation(query: InstallationQuery<boolean>): Promise<Installation> {
    const data = await this.read();
    const found = data.installations[installKey(query)];
    if (!found) throw new Error('Installation not found');
    return found;
  }

  async deleteInstallation(query: InstallationQuery<boolean>): Promise<void> {
    const data = await this.read();
    const key = installKey(query);
    delete data.installations[key];
    delete data.hanzo[teamOf(key)];
    await this.write(data);
  }

  async setHanzoToken(teamId: string, token: HanzoWorkspaceToken): Promise<void> {
    const data = await this.read();
    data.hanzo[teamId] = token;
    await this.write(data);
  }

  async getHanzoToken(teamId: string): Promise<HanzoWorkspaceToken | undefined> {
    const data = await this.read();
    return data.hanzo[teamId];
  }
}

function teamOf(key: string): string {
  return key.startsWith('T:') || key.startsWith('E:') ? key.slice(2) : key;
}

/**
 * Resolve the gateway bearer for a workspace: the workspace's own Hanzo token if
 * bound, else the app-default `HANZO_API_KEY`. Pure over the store lookup so the
 * precedence (workspace override wins) is unit-testable.
 */
export function resolveBearer(
  workspaceToken: HanzoWorkspaceToken | undefined,
  defaultApiKey: string,
): string {
  const ws = workspaceToken?.token?.trim();
  return ws || defaultApiKey.trim() || '';
}
