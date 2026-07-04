/**
 * Thin Octokit wrappers — the ONLY place this package talks to GitHub's REST
 * API. Each function is a one-liner over `octokit.request(...)`, named for what
 * it does (getPRDiff, createReview, comment, addLabels) so call sites read as
 * intent and the route strings live in exactly one place.
 *
 * The installation Octokit from `@octokit/app` is a plain `@octokit/core`
 * instance exposing `.request(route, params)`. We depend only on that surface
 * ({@link RequestOctokit}), which makes these wrappers trivially mockable in
 * tests without constructing a real client.
 */

/** The minimal Octokit surface these wrappers use — just `.request`. */
export interface RequestOctokit {
  request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>;
}

/** A repository coordinate. */
export interface Repo {
  owner: string;
  repo: string;
}

/**
 * Fetch a pull request's unified diff. GitHub returns the raw diff when the
 * `diff` media type is requested; the response `data` is the diff string. This
 * is the input to the review pipeline.
 */
export async function getPRDiff(
  octokit: RequestOctokit,
  { owner, repo }: Repo,
  pull_number: number,
): Promise<string> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner,
    repo,
    pull_number,
    mediaType: { format: 'diff' },
  });
  // With the diff media type Octokit yields the raw string in `data`.
  return typeof res.data === 'string' ? res.data : String(res.data);
}

/**
 * Post a pull request review. `event` COMMENT posts the body without approving
 * or requesting changes — the right default for an automated summary review.
 */
export async function createReview(
  octokit: RequestOctokit,
  { owner, repo }: Repo,
  pull_number: number,
  body: string,
  event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' = 'COMMENT',
): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner,
    repo,
    pull_number,
    body,
    event,
  });
}

/**
 * Post a comment on an issue or pull request. In GitHub's model a PR is an
 * issue, so this one route serves triage replies, `@hanzo` answers, and PR
 * summary comments alike.
 */
export async function comment(
  octokit: RequestOctokit,
  { owner, repo }: Repo,
  issue_number: number,
  body: string,
): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner,
    repo,
    issue_number,
    body,
  });
}

/**
 * Add labels to an issue or PR. No-op when `labels` is empty so callers do not
 * have to guard. GitHub creates a label that does not exist, so callers must
 * pass labels already intersected with the repo's real labels
 * (see `triage.parseLabelLine`).
 */
export async function addLabels(
  octokit: RequestOctokit,
  { owner, repo }: Repo,
  issue_number: number,
  labels: string[],
): Promise<void> {
  if (labels.length === 0) return;
  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
    owner,
    repo,
    issue_number,
    labels,
  });
}

/** A label as returned by the labels list endpoint. */
interface LabelData {
  name: string;
}

/**
 * List a repository's defined labels (names only). Used by triage so the model
 * picks from labels that actually exist. Paginates a single page of 100, which
 * covers the vast majority of repos; more than that is a signal a maintainer
 * should curate, not that we should apply unknown labels.
 */
export async function listRepoLabels(
  octokit: RequestOctokit,
  { owner, repo }: Repo,
): Promise<string[]> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/labels', {
    owner,
    repo,
    per_page: 100,
  });
  const data = Array.isArray(res.data) ? (res.data as LabelData[]) : [];
  return data.map((l) => l.name).filter((n): n is string => typeof n === 'string');
}

/** A comment as returned by the issue-comments endpoint. */
interface IssueCommentData {
  user?: { login?: string; type?: string } | null;
  body?: string | null;
}

/**
 * Fetch the recent comment thread on an issue/PR as flat text, so an `@hanzo`
 * answer has the surrounding conversation as context. Bot comments are dropped
 * to keep our own prior replies out of the context. Returns oldest-first.
 */
export async function getIssueComments(
  octokit: RequestOctokit,
  { owner, repo }: Repo,
  issue_number: number,
  limit = 30,
): Promise<Array<{ author: string; body: string }>> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner,
    repo,
    issue_number,
    per_page: Math.min(limit, 100),
  });
  const data = Array.isArray(res.data) ? (res.data as IssueCommentData[]) : [];
  return data
    .filter((c) => c.user?.type !== 'Bot')
    .map((c) => ({ author: c.user?.login ?? 'unknown', body: c.body ?? '' }))
    .filter((c) => c.body.trim().length > 0);
}
