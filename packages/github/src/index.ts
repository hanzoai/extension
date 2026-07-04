/**
 * `@hanzo/github` — Hanzo AI on GitHub.
 *
 * A GitHub App (webhooks + Octokit): it reviews pull requests, triages new
 * issues, and answers `@hanzo` mentions in issue/PR comments — powered by the
 * shared foundation `@hanzo/ai` (headless model client) and `@hanzo/iam`
 * (identity). Run it with `server.ts`; embed the pieces via the exports below.
 *
 * The cores (`review`, `triage`, `mention`, `webhook`) are PURE and independent
 * of Octokit and the network; `app`, `github-api`, and `server` are the impure
 * edges that compose them.
 */

export {
  loadConfig,
  normalizePrivateKey,
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_MAX_DIFF_CHARS,
  GITHUB_APP_PERMISSIONS,
  GITHUB_APP_EVENTS,
  type Config,
  type GitHubConfig,
  type HanzoConfig,
} from './config.js';

export {
  complete,
  buildMessages,
  extractContent,
  validateHanzoToken,
  type ChatMessage,
  type CompleteInput,
} from './hanzo.js';

export {
  splitDiffByFile,
  windowDiff,
  diffTruncationNote,
  assembleReview,
  buildReviewPrompt,
  formatReviewComment,
  reviewSystemPrompt,
  type WindowedDiff,
  type PullRequestContext,
} from './review.js';

export {
  buildTriagePrompt,
  parseTriage,
  parseLabelLine,
  formatTriageComment,
  triageSystemPrompt,
  isSeverity,
  SEVERITIES,
  type Triage,
  type IssueContext,
  type Severity,
} from './triage.js';

export {
  buildMentionPrompt,
  formatMentionComment,
  mentionSystemPrompt,
  type MentionContext,
  type ThreadComment,
} from './mention.js';

export {
  verifySignature,
  sign,
  parseMention,
  routeEvent,
  SIGNATURE_HEADER,
  MENTION_RE,
  type Intent,
  type RoutablePayload,
} from './webhook.js';

export {
  getPRDiff,
  createReview,
  comment,
  addLabels,
  listRepoLabels,
  getIssueComments,
  type RequestOctokit,
  type Repo,
} from './github-api.js';

export {
  createApp,
  registerHandlers,
  dispatch,
  makeRunModel,
  handlePullRequest,
  handleIssue,
  handleMention,
  type AppDeps,
  type RunModel,
} from './app.js';

export { createWebhookServer, start, WEBHOOK_PATH_PREFIX } from './server.js';
