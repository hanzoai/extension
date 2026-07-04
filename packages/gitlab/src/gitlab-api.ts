/**
 * Thin GitLab REST v4 wrappers — the ONLY place this package talks to a GitLab
 * host. Each function is a one-liner over {@link GitlabClient.request}, named for
 * what it does (getMRChanges, listLabels, createNote, addLabels) so call sites
 * read as intent and the `/api/v4/...` route strings live in exactly one place.
 *
 * `/api/v4` is GitLab's own API path — correct and unavoidable. The Hanzo rule
 * against an `/api/` prefix applies only to the Hanzo gateway (api.hanzo.ai/v1),
 * which this package reaches solely through `@hanzo/ai` in `hanzo.ts`.
 *
 * Auth: GitLab accepts a Personal/Project Access Token via the `PRIVATE-TOKEN`
 * header, or an OAuth token via `Authorization: Bearer`. We send `PRIVATE-TOKEN`
 * — the token surface every self-managed instance and gitlab.com support.
 */

import type { FileChange } from './review.js';

/** The `fetch` surface these wrappers need. Injectable for tests. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** A GitLab project coordinate: numeric id or URL-encoded `namespace/project`. */
export type ProjectRef = number | string;

/** Config for a {@link GitlabClient}. */
export interface GitlabClientConfig {
  /** Instance base URL, e.g. `https://gitlab.com` (no trailing `/api/v4`). */
  baseURL: string;
  /** Personal/Project/Group access token with `api` scope. */
  token: string;
  /** Injected fetch (tests). Defaults to global `fetch`. */
  fetch?: FetchLike;
}

/** URL-encode a project ref for a path segment (numeric ids pass through). */
export function encodeProject(project: ProjectRef): string {
  return typeof project === 'number' ? String(project) : encodeURIComponent(project);
}

/**
 * A minimal GitLab REST v4 client. Owns the base URL + token and exposes one
 * `request` method; the exported wrappers below build on it. Nothing else in the
 * package constructs a URL or sets an auth header.
 */
export class GitlabClient {
  private readonly base: string;
  private readonly token: string;
  private readonly doFetch: FetchLike;

  constructor(config: GitlabClientConfig) {
    // Normalize: strip a trailing slash and any accidental `/api/v4` suffix.
    this.base = config.baseURL.replace(/\/+$/, '').replace(/\/api\/v4$/, '');
    this.token = config.token;
    this.doFetch = config.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  /**
   * Issue a request against `<base>/api/v4<path>` and return the parsed JSON.
   * `path` MUST start with `/`. Non-2xx throws with the status and body so
   * callers surface the real GitLab error rather than a silent failure.
   */
  async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const url = new URL(`${this.base}/api/v4${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { 'PRIVATE-TOKEN': this.token };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await this.doFetch(url.toString(), { method, headers, body, signal: opts.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GitLab ${method} ${path} failed: ${res.status} ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Raw shape of GitLab's MR changes response. */
interface MRChangesResponse {
  changes?: FileChange[];
}

/**
 * Fetch a merge request's file changes (the input to the review pipeline).
 * `GET /projects/{id}/merge_requests/{iid}/changes` returns the MR with a
 * `changes[]` array of per-file diffs; review reconstructs a unified diff from
 * them.
 */
export async function getMRChanges(
  client: GitlabClient,
  project: ProjectRef,
  iid: number,
  signal?: AbortSignal,
): Promise<FileChange[]> {
  const res = await client.request<MRChangesResponse>(
    'GET',
    `/projects/${encodeProject(project)}/merge_requests/${iid}/changes`,
    { signal },
  );
  return Array.isArray(res.changes) ? res.changes : [];
}

/**
 * Post a note on a merge request. GitLab keeps MR and issue notes on separate
 * endpoints, so review and MR-mention replies use this one.
 */
export async function createMRNote(
  client: GitlabClient,
  project: ProjectRef,
  iid: number,
  body: string,
  signal?: AbortSignal,
): Promise<void> {
  await client.request(
    'POST',
    `/projects/${encodeProject(project)}/merge_requests/${iid}/notes`,
    { body: { body }, signal },
  );
}

/** Post a note on an issue. Used by triage and issue mentions. */
export async function createIssueNote(
  client: GitlabClient,
  project: ProjectRef,
  iid: number,
  body: string,
  signal?: AbortSignal,
): Promise<void> {
  await client.request(
    'POST',
    `/projects/${encodeProject(project)}/issues/${iid}/notes`,
    { body: { body }, signal },
  );
}

/**
 * Add labels to an issue. No-op when `labels` is empty so callers do not have to
 * guard. GitLab's `PUT /issues/{iid}` with `add_labels` appends without clobbering
 * existing labels. Callers must pass labels already intersected with the
 * project's real labels (see `triage.parseLabelLine`) — GitLab creates an
 * unknown label otherwise.
 */
export async function addIssueLabels(
  client: GitlabClient,
  project: ProjectRef,
  iid: number,
  labels: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (labels.length === 0) return;
  await client.request(
    'PUT',
    `/projects/${encodeProject(project)}/issues/${iid}`,
    { query: { add_labels: labels.join(',') }, signal },
  );
}

/** A label as returned by the labels list endpoint. */
interface LabelData {
  name?: string;
}

/**
 * List a project's defined labels (names only). Used by triage so the model
 * picks from labels that actually exist. Fetches a single page of 100, which
 * covers the vast majority of projects; more than that is a signal a maintainer
 * should curate, not that we should apply unknown labels.
 */
export async function listLabels(
  client: GitlabClient,
  project: ProjectRef,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await client.request<LabelData[]>(
    'GET',
    `/projects/${encodeProject(project)}/labels`,
    { query: { per_page: 100 }, signal },
  );
  const data = Array.isArray(res) ? res : [];
  return data.map((l) => l.name).filter((n): n is string => typeof n === 'string');
}

/** A note as returned by the notes list endpoint. */
interface NoteData {
  system?: boolean;
  author?: { username?: string } | null;
  body?: string | null;
}

/** The noteable resource kind for {@link getNotes}. */
export type Noteable = 'merge_requests' | 'issues';

/**
 * Fetch the recent note thread on an MR/issue as flat text, so an `@hanzo` answer
 * has the surrounding conversation as context. System notes (label changes, etc.)
 * are dropped; results are oldest-first (`sort=asc`).
 */
export async function getNotes(
  client: GitlabClient,
  project: ProjectRef,
  noteable: Noteable,
  iid: number,
  limit = 30,
  signal?: AbortSignal,
): Promise<Array<{ author: string; body: string }>> {
  const res = await client.request<NoteData[]>(
    'GET',
    `/projects/${encodeProject(project)}/${noteable}/${iid}/notes`,
    { query: { per_page: Math.min(limit, 100), sort: 'asc', order_by: 'created_at' }, signal },
  );
  const data = Array.isArray(res) ? res : [];
  return data
    .filter((n) => n.system !== true)
    .map((n) => ({ author: n.author?.username ?? 'unknown', body: n.body ?? '' }))
    .filter((n) => n.body.trim().length > 0);
}
