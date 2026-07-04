/**
 * `@hanzo` mention core — PURE. Assemble the prompt that answers a question
 * asked in an issue or merge-request note, using the issue/MR body plus the
 * surrounding note thread as context. No network; the thread is fetched by
 * `gitlab-api.getNotes` and the answer posted by `gitlab-api.createNote`.
 */

/** A note in the thread, oldest-first. */
export interface ThreadNote {
  author: string;
  body: string;
}

/** Context for answering an `@hanzo` mention. */
export interface MentionContext {
  /** `namespace/project` path. */
  project: string;
  /** Issue or MR internal id. */
  iid: number;
  /** Whether the thread is a merge request (vs a plain issue). */
  isMergeRequest: boolean;
  /** Issue/MR title. */
  title: string;
  /** Issue/MR body. May be empty. */
  body: string;
  /** The note thread, oldest-first, system + bot notes already removed. */
  notes: ThreadNote[];
}

const SYSTEM_PROMPT =
  'You are Hanzo AI, answering a question a user asked by mentioning @hanzo in a ' +
  'GitLab issue or merge request note. Answer the question directly and helpfully ' +
  'using the thread as context. Be concise, use GitLab-flavored Markdown, and say ' +
  'so plainly when the thread lacks the information to answer. Do not invent facts ' +
  'about the code or the project beyond what the thread provides.';

/** System prompt for a mention answer. Exported for test assertions. */
export function mentionSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Render the thread as attributed lines. Pure. */
function renderThread(notes: ThreadNote[]): string {
  if (notes.length === 0) return '(no prior notes)';
  return notes.map((n) => `@${n.author}: ${n.body.trim()}`).join('\n\n');
}

/**
 * Assemble the user prompt for an `@hanzo` answer. When the question is empty
 * (a bare `@hanzo`), the task becomes "summarize and offer help". The thread is
 * fenced so the model treats it as data, not instructions. Pure.
 */
export function buildMentionPrompt(ctx: MentionContext, question: string): string {
  const kind = ctx.isMergeRequest ? 'merge request' : 'issue';
  const task = question.trim()
    ? `A user asked, in a note: "${question.trim()}"\n\nAnswer it using the thread below.`
    : 'A user mentioned you with no specific question. Summarize the thread and ' +
      'offer a concrete next step.';
  return (
    `${kind} ${ctx.project}!${ctx.iid}: ${ctx.title}\n\n` +
    `Description:\n${ctx.body.trim() || '(empty)'}\n\n` +
    `Thread:\n${renderThread(ctx.notes)}\n\n` +
    task
  );
}

/** Format a mention answer for posting. Pure. */
export function formatMentionNote(answer: string, model: string): string {
  return `${answer.trim()}\n\n---\n_Answered by Hanzo AI (\`${model}\`)._`;
}
