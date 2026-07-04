/**
 * The GitHub App — composition only. Wires the Octokit `App` (JWT → per-repo
 * installation token, webhook signature verification) to the PURE cores:
 * `webhook.routeEvent` decides the intent, then `review`/`triage`/`mention`
 * assemble prompts, `hanzo.complete` calls the model, and `github-api` posts
 * the result. No business logic lives here beyond that plumbing.
 *
 * The one impure dependency — the model call — is injected as {@link AppDeps.run}
 * so the dispatch (which intent runs, what gets posted) is unit-testable with a
 * stub, and there is still exactly one production path through `hanzo.complete`.
 */

import { App } from '@octokit/app';
import type { Config } from './config.js';
import { complete, type CompleteInput } from './hanzo.js';
import {
  createReview,
  comment,
  addLabels,
  getPRDiff,
  listRepoLabels,
  getIssueComments,
  type RequestOctokit,
  type Repo,
} from './github-api.js';
import { routeEvent, type RoutablePayload } from './webhook.js';
import { assembleReview, formatReviewComment, reviewSystemPrompt } from './review.js';
import {
  buildTriagePrompt,
  parseTriage,
  formatTriageComment,
  triageSystemPrompt,
} from './triage.js';
import {
  buildMentionPrompt,
  formatMentionComment,
  mentionSystemPrompt,
  type ThreadComment,
} from './mention.js';

/** The model runner. Real impl calls `hanzo.complete`; tests stub it. */
export type RunModel = (input: Pick<CompleteInput, 'system' | 'user'>) => Promise<string>;

/** Injectable dependencies. */
export interface AppDeps {
  /** Model runner. Defaults to a `hanzo.complete` bound to `config`. */
  run?: RunModel;
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

/** Parse `owner/repo` from a webhook repository payload. */
function repoOf(payload: { repository?: { owner?: { login?: string }; name?: string } }): Repo {
  const owner = payload.repository?.owner?.login ?? '';
  const repo = payload.repository?.name ?? '';
  return { owner, repo };
}

/** Handle a `pull_request` opened/synchronize/reopened → post a review. */
export async function handlePullRequest(
  octokit: RequestOctokit,
  payload: {
    repository?: { owner?: { login?: string }; name?: string };
    pull_request?: { number?: number; title?: string; body?: string | null };
  },
  config: Config,
  run: RunModel,
): Promise<void> {
  const repo = repoOf(payload);
  const pr = payload.pull_request;
  if (!repo.owner || !repo.repo || !pr?.number) return;

  const diff = await getPRDiff(octokit, repo, pr.number);
  const { prompt } = assembleReview(
    {
      title: pr.title ?? '',
      body: pr.body ?? '',
      repo: `${repo.owner}/${repo.repo}`,
      number: pr.number,
    },
    diff,
    config.maxDiffChars,
  );
  const review = await run({ system: reviewSystemPrompt(), user: prompt });
  await createReview(octokit, repo, pr.number, formatReviewComment(review, config.model), 'COMMENT');
}

/** Handle an `issues` opened → triage: comment + apply labels. */
export async function handleIssue(
  octokit: RequestOctokit,
  payload: {
    repository?: { owner?: { login?: string }; name?: string };
    issue?: { number?: number; title?: string; body?: string | null };
  },
  config: Config,
  run: RunModel,
): Promise<void> {
  const repo = repoOf(payload);
  const issue = payload.issue;
  if (!repo.owner || !repo.repo || !issue?.number) return;

  const availableLabels = await listRepoLabels(octokit, repo);
  const prompt = buildTriagePrompt({
    title: issue.title ?? '',
    body: issue.body ?? '',
    repo: `${repo.owner}/${repo.repo}`,
    number: issue.number,
    availableLabels,
  });
  const raw = await run({ system: triageSystemPrompt(), user: prompt });
  const triage = parseTriage(raw, availableLabels);

  await comment(octokit, repo, issue.number, formatTriageComment(triage, config.model));
  await addLabels(octokit, repo, issue.number, triage.labels);
}

/** Handle an `issue_comment` with `@hanzo <question>` → answer in context. */
export async function handleMention(
  octokit: RequestOctokit,
  payload: {
    repository?: { owner?: { login?: string }; name?: string };
    issue?: { number?: number; title?: string; body?: string | null; pull_request?: unknown };
  },
  question: string,
  config: Config,
  run: RunModel,
): Promise<void> {
  const repo = repoOf(payload);
  const issue = payload.issue;
  if (!repo.owner || !repo.repo || !issue?.number) return;

  const raw = await getIssueComments(octokit, repo, issue.number);
  const comments: ThreadComment[] = raw.map((c) => ({ author: c.author, body: c.body }));
  const prompt = buildMentionPrompt(
    {
      repo: `${repo.owner}/${repo.repo}`,
      number: issue.number,
      isPullRequest: Boolean(issue.pull_request),
      title: issue.title ?? '',
      body: issue.body ?? '',
      comments,
    },
    question,
  );
  const answer = await run({ system: mentionSystemPrompt(), user: prompt });
  await comment(octokit, repo, issue.number, formatMentionComment(answer, config.model));
}

/**
 * Dispatch a routed intent to its handler. Extracted from `registerHandlers` so
 * the full decision→action path is unit-testable with a fake octokit and a stub
 * `run`, without an `App` or a live webhook. `event` is the GitHub event name.
 */
export async function dispatch(
  event: string,
  payload: RoutablePayload & Record<string, unknown>,
  octokit: RequestOctokit,
  config: Config,
  run: RunModel,
): Promise<void> {
  const intent = routeEvent(event, payload);
  switch (intent.kind) {
    case 'review_pr':
      return handlePullRequest(octokit, payload as never, config, run);
    case 'triage_issue':
      return handleIssue(octokit, payload as never, config, run);
    case 'answer_mention':
      return handleMention(octokit, payload as never, intent.question, config, run);
    case 'ignore':
      return; // routing decided this event is not actionable
  }
}

/**
 * Register webhook handlers on an Octokit `App`. Each GitHub event routes into
 * the pure {@link routeEvent}, then {@link dispatch} runs it. The App supplies
 * the installation-authenticated `octokit` per event.
 */
export function registerHandlers(app: App, config: Config, deps: AppDeps = {}): void {
  const run = deps.run ?? makeRunModel(config);
  // One handler per subscribed event. `event.name` is the GitHub event; the
  // App supplies the installation-authenticated `octokit`. Everything else is
  // the pure route→dispatch path.
  app.webhooks.on(['pull_request', 'issues', 'issue_comment'], async (event) => {
    await dispatch(
      event.name,
      event.payload as RoutablePayload & Record<string, unknown>,
      event.octokit as unknown as RequestOctokit,
      config,
      run,
    );
  });
}

/** Build the Octokit `App` from config (JWT auth + webhook secret). */
export function createApp(config: Config, deps: AppDeps = {}): App {
  const app = new App({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
    webhooks: { secret: config.github.webhookSecret },
  });
  registerHandlers(app, config, deps);
  return app;
}
