/**
 * `@hanzo` mention core — PURE. Assemble the prompt that answers a question
 * asked in an issue or PR comment, using the issue/PR body plus the surrounding
 * comment thread as context. No network; the thread is fetched by
 * `github-api.getIssueComments` and the answer posted by `github-api.comment`.
 */

/** A comment in the thread, oldest-first. */
export interface ThreadComment {
  author: string;
  body: string;
}

/** Context for answering an `@hanzo` mention. */
export interface MentionContext {
  /** `owner/repo`. */
  repo: string;
  /** Issue or PR number. */
  number: number;
  /** Whether the thread is a pull request (vs a plain issue). */
  isPullRequest: boolean;
  /** Issue/PR title. */
  title: string;
  /** Issue/PR body. May be empty. */
  body: string;
  /** The comment thread, oldest-first, bot comments already removed. */
  comments: ThreadComment[];
}

const SYSTEM_PROMPT =
  'You are Hanzo AI, answering a question a user asked by mentioning @hanzo in a ' +
  'GitHub issue or pull request. Answer the question directly and helpfully using ' +
  'the thread as context. Be concise, use GitHub-flavored Markdown, and say so ' +
  'plainly when the thread lacks the information to answer. Do not invent facts ' +
  'about the code or the project beyond what the thread provides.';

/** System prompt for a mention answer. Exported for test assertions. */
export function mentionSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Render the thread as fenced, attributed lines. Pure. */
function renderThread(comments: ThreadComment[]): string {
  if (comments.length === 0) return '(no prior comments)';
  return comments.map((c) => `@${c.author}: ${c.body.trim()}`).join('\n\n');
}

/**
 * Assemble the user prompt for an `@hanzo` answer. When the question is empty
 * (a bare `@hanzo`), the task becomes "summarize and offer help". The thread is
 * fenced so the model treats it as data, not instructions. Pure.
 */
export function buildMentionPrompt(ctx: MentionContext, question: string): string {
  const kind = ctx.isPullRequest ? 'pull request' : 'issue';
  const task = question.trim()
    ? `A user asked, in a comment: "${question.trim()}"\n\nAnswer it using the thread below.`
    : 'A user mentioned you with no specific question. Summarize the thread and ' +
      'offer a concrete next step.';
  return (
    `${kind} ${ctx.repo}#${ctx.number}: ${ctx.title}\n\n` +
    `Description:\n${ctx.body.trim() || '(empty)'}\n\n` +
    `Thread:\n${renderThread(ctx.comments)}\n\n` +
    task
  );
}

/** Format a mention answer for posting. Pure. */
export function formatMentionComment(answer: string, model: string): string {
  return `${answer.trim()}\n\n---\n_Answered by Hanzo AI (\`${model}\`)._`;
}
