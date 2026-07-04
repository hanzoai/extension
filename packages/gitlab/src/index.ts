/**
 * `@hanzo/gitlab` — Hanzo AI on GitLab.
 *
 * A GitLab webhook service (Project/Group webhooks + REST API v4): it reviews
 * merge requests, triages new issues, and answers `@hanzo` mentions in issue/MR
 * notes — powered by the shared foundation `@hanzo/ai` (headless model client)
 * and `@hanzo/iam` (identity). Run it with `server.ts`; embed the pieces via the
 * exports below.
 *
 * The cores (`review`, `triage`, `mention`, `webhook`) are PURE and independent
 * of the REST client and the network; `app`, `gitlab-api`, and `server` are the
 * impure edges that compose them.
 */

export {
  loadConfig,
  HANZO_API_BASE_URL,
  DEFAULT_GITLAB_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_MAX_DIFF_CHARS,
  GITLAB_TOKEN_SCOPES,
  GITLAB_WEBHOOK_TRIGGERS,
  type Config,
  type GitLabConfig,
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
  changesToDiff,
  splitDiffByFile,
  windowDiff,
  diffTruncationNote,
  assembleReview,
  buildReviewPrompt,
  formatReviewNote,
  reviewSystemPrompt,
  type FileChange,
  type WindowedDiff,
  type MergeRequestContext,
} from './review.js';

export {
  buildTriagePrompt,
  parseTriage,
  parseLabelLine,
  formatTriageNote,
  triageSystemPrompt,
  isSeverity,
  SEVERITIES,
  type Triage,
  type IssueContext,
  type Severity,
} from './triage.js';

export {
  buildMentionPrompt,
  formatMentionNote,
  mentionSystemPrompt,
  type MentionContext,
  type ThreadNote,
} from './mention.js';

export {
  verifyToken,
  parseMention,
  routeEvent,
  TOKEN_HEADER,
  EVENT_HEADER,
  MENTION_RE,
  type Intent,
  type RoutablePayload,
} from './webhook.js';

export {
  GitlabClient,
  getMRChanges,
  createMRNote,
  createIssueNote,
  addIssueLabels,
  listLabels,
  getNotes,
  encodeProject,
  type GitlabClientConfig,
  type ProjectRef,
  type Noteable,
  type FetchLike,
} from './gitlab-api.js';

export {
  createService,
  makeClient,
  makeRunModel,
  dispatch,
  handleMergeRequest,
  handleIssue,
  handleMention,
  type AppDeps,
  type RunModel,
  type Service,
  type MergeRequestPayload,
  type IssuePayload,
  type NotePayload,
} from './app.js';

export { createWebhookServer, handleRequest, start, WEBHOOK_PATH } from './server.js';
