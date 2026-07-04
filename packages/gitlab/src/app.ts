/**
 * The GitLab service — composition only. Wires a single {@link GitlabClient}
 * (base URL + service token) to the PURE cores: `webhook.routeEvent` decides the
 * intent, then `review`/`triage`/`mention` assemble prompts, `hanzo.complete`
 * calls the model, and `gitlab-api` posts the result. No business logic lives
 * here beyond that plumbing.
 *
 * The one impure dependency — the model call — is injected as {@link AppDeps.run}
 * so the dispatch (which intent runs, what gets posted) is unit-testable with a
 * stub, and there is still exactly one production path through `hanzo.complete`.
 *
 * GitLab, unlike GitHub Apps, has no per-installation token dance: one access
 * token from config authenticates every REST call, so the client is built once.
 */

import type { Config } from './config.js';
import { complete, type CompleteInput } from './hanzo.js';
import {
  GitlabClient,
  getMRChanges,
  createMRNote,
  createIssueNote,
  addIssueLabels,
  listLabels,
  getNotes,
  type ProjectRef,
} from './gitlab-api.js';
import { routeEvent, type RoutablePayload } from './webhook.js';
import { assembleReview, formatReviewNote, reviewSystemPrompt } from './review.js';
import { buildTriagePrompt, parseTriage, formatTriageNote, triageSystemPrompt } from './triage.js';
import {
  buildMentionPrompt,
  formatMentionNote,
  mentionSystemPrompt,
  type ThreadNote,
} from './mention.js';

/** The model runner. Real impl calls `hanzo.complete`; tests stub it. */
export type RunModel = (input: Pick<CompleteInput, 'system' | 'user'>) => Promise<string>;

/** Injectable dependencies. */
export interface AppDeps {
  /** Model runner. Defaults to a `hanzo.complete` bound to `config`. */
  run?: RunModel;
  /** GitLab client. Defaults to one built from `config.gitlab`. */
  client?: GitlabClient;
}

/** Bind a {@link RunModel} to the Hanzo config — the single production path. */
export function makeRunModel(config: Config): RunModel {
  return ({ system, user }) =>
    complete({
      system,
      user,
      model: config.model,
      token: config.hanzo.apiKey,
      baseURL: config.hanzo.baseURL,
    });
}

/** Build the GitLab client from config — the single REST path. */
export function makeClient(config: Config): GitlabClient {
  return new GitlabClient({ baseURL: config.gitlab.baseURL, token: config.gitlab.token });
}

/** The webhook `project` block. `path_with_namespace` is the human `ns/proj`. */
interface ProjectPayload {
  id?: number;
  path_with_namespace?: string;
}

/**
 * Resolve the project ref to address in the REST API, and a human `ns/project`
 * path for prompts. Prefer the numeric id (unambiguous across renames); fall back
 * to the namespace path. Pure.
 */
function projectOf(payload: { project?: ProjectPayload }): { ref: ProjectRef; path: string } {
  const p = payload.project;
  const path = p?.path_with_namespace ?? '';
  const ref: ProjectRef = typeof p?.id === 'number' ? p.id : path;
  return { ref, path };
}

/** MR webhook payload — the subset we read. */
export interface MergeRequestPayload {
  project?: ProjectPayload;
  object_attributes?: { iid?: number; title?: string; description?: string | null };
}

/** Handle a `Merge Request Hook` open/update/reopen → post a review note. */
export async function handleMergeRequest(
  client: GitlabClient,
  payload: MergeRequestPayload,
  config: Config,
  run: RunModel,
): Promise<void> {
  const { ref, path } = projectOf(payload);
  const mr = payload.object_attributes;
  if (!path || !mr?.iid) return;

  const changes = await getMRChanges(client, ref, mr.iid);
  const { prompt } = assembleReview(
    { title: mr.title ?? '', body: mr.description ?? '', project: path, iid: mr.iid },
    changes,
    config.maxDiffChars,
  );
  const review = await run({ system: reviewSystemPrompt(), user: prompt });
  await createMRNote(client, ref, mr.iid, formatReviewNote(review, config.model));
}

/** Issue webhook payload — the subset we read. */
export interface IssuePayload {
  project?: ProjectPayload;
  object_attributes?: { iid?: number; title?: string; description?: string | null };
}

/** Handle an `Issue Hook` open/reopen → triage: note + apply labels. */
export async function handleIssue(
  client: GitlabClient,
  payload: IssuePayload,
  config: Config,
  run: RunModel,
): Promise<void> {
  const { ref, path } = projectOf(payload);
  const issue = payload.object_attributes;
  if (!path || !issue?.iid) return;

  const availableLabels = await listLabels(client, ref);
  const prompt = buildTriagePrompt({
    title: issue.title ?? '',
    body: issue.description ?? '',
    project: path,
    iid: issue.iid,
    availableLabels,
  });
  const raw = await run({ system: triageSystemPrompt(), user: prompt });
  const triage = parseTriage(raw, availableLabels);

  await createIssueNote(client, ref, issue.iid, formatTriageNote(triage, config.model));
  await addIssueLabels(client, ref, issue.iid, triage.labels);
}

/**
 * Note webhook payload — the subset we read. A note carries the noteable's own
 * `merge_request` or `issue` block (with its `iid`), so we can answer in context
 * without a second lookup for the resource itself.
 */
export interface NotePayload {
  project?: ProjectPayload;
  object_attributes?: { noteable_type?: string };
  merge_request?: { iid?: number; title?: string; description?: string | null };
  issue?: { iid?: number; title?: string; description?: string | null };
}

/** Handle a `Note Hook` with `@hanzo <question>` → answer in context. */
export async function handleMention(
  client: GitlabClient,
  payload: NotePayload,
  question: string,
  config: Config,
  run: RunModel,
): Promise<void> {
  const { ref, path } = projectOf(payload);
  const isMR = payload.object_attributes?.noteable_type === 'MergeRequest';
  const resource = isMR ? payload.merge_request : payload.issue;
  if (!path || !resource?.iid) return;

  const raw = await getNotes(client, ref, isMR ? 'merge_requests' : 'issues', resource.iid);
  const notes: ThreadNote[] = raw.map((n) => ({ author: n.author, body: n.body }));
  const prompt = buildMentionPrompt(
    {
      project: path,
      iid: resource.iid,
      isMergeRequest: isMR,
      title: resource.title ?? '',
      body: resource.description ?? '',
      notes,
    },
    question,
  );
  const answer = await run({ system: mentionSystemPrompt(), user: prompt });
  const note = formatMentionNote(answer, config.model);
  if (isMR) await createMRNote(client, ref, resource.iid, note);
  else await createIssueNote(client, ref, resource.iid, note);
}

/**
 * Dispatch a verified `(event, payload)` to its handler. Extracted so the full
 * decision→action path is unit-testable with a fake client and a stub `run`,
 * without an HTTP server or a live webhook. `event` is the `X-Gitlab-Event`
 * header value.
 */
export async function dispatch(
  event: string,
  payload: RoutablePayload & Record<string, unknown>,
  client: GitlabClient,
  config: Config,
  run: RunModel,
): Promise<void> {
  const intent = routeEvent(event, payload);
  switch (intent.kind) {
    case 'review_mr':
      return handleMergeRequest(client, payload as MergeRequestPayload, config, run);
    case 'triage_issue':
      return handleIssue(client, payload as IssuePayload, config, run);
    case 'answer_mention':
      return handleMention(client, payload as NotePayload, intent.question, config, run);
    case 'ignore':
      return; // routing decided this event is not actionable
  }
}

/** The service: the resolved config plus its bound client and model runner. */
export interface Service {
  config: Config;
  client: GitlabClient;
  run: RunModel;
}

/** Build the {@link Service} from config — the production wiring. */
export function createService(config: Config, deps: AppDeps = {}): Service {
  return {
    config,
    client: deps.client ?? makeClient(config),
    run: deps.run ?? makeRunModel(config),
  };
}
