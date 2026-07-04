// The Hanzo call and its request/response shaping over a COURSE — thin over the
// published `@hanzo/ai` headless client, host-agnostic, and fully unit-testable (no
// Canvas SDK, no DOM). The panel and the server are the glue that read a course's
// records and hand them here. Speaks the OpenAI-compatible /v1 wire protocol the
// whole Hanzo suite uses (identical to @hanzo/procore) so the gateway sees one shape
// from every surface.
//
// @hanzo/ai@^0.2.0 IS the headless client: createAiClient({ baseUrl, token }) →
// .chat.completions.create({ model, messages }) + .models.list(). We import it and
// do NOT reimplement the transport. This module adds only the course-aware prompt
// assembly + the single `ask` primitive the actions layer on.

import {
  createAiClient,
  type AiClient,
  type ChatCompletion,
  type ChatCompletionMessage,
} from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from './config.js';
import { contextNote, type CourseContext } from './course.js';

// SYSTEM_PROMPT grounds every answer in the course records. It forbids inventing
// facts nobody recorded (the failure mode that makes a teaching assistant
// untrustworthy), keeps student data handled respectfully, and stays honest about
// truncated context. It states plainly that the output is a DRAFT for an educator to
// review — not an authoritative grade, decision, or the final word to a student.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant that helps instructors and teaching staff work ' +
  'with their Canvas course — the syllabus, modules, assignments, pages, ' +
  'discussions, and student submissions. Work ONLY from the course records provided ' +
  'below — never invent assignments, due dates, grades, submissions, or facts that ' +
  'are not supported by the text. Be concise, precise, and constructive; when you ' +
  'reference student work, be specific and fair. If the records are marked truncated ' +
  'and a complete answer needs the omitted part, say so plainly rather than guessing. ' +
  'Everything you produce — feedback, questions, announcements, summaries — is a ' +
  'DRAFT for an educator to review and edit before it reaches a student; it is not an ' +
  'authoritative grade or decision.';

// ---- Prompt assembly ------------------------------------------------------

// Optional structured context about the course (name, code, term) the Canvas API
// supplies. Attached as a short header above the records so answers can reference the
// course without the model guessing.
export interface CourseMeta {
  name?: string;
  courseCode?: string;
  term?: string;
}

function courseHeader(meta: CourseMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.name) parts.push(`Course: ${meta.name}`);
  if (meta.courseCode) parts.push(`Code: ${meta.courseCode}`);
  if (meta.term) parts.push(`Term: ${meta.term}`);
  return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
}

// buildMessages turns a task (the user's question, or one of the action prompts)
// plus the windowed course context + optional metadata into the OpenAI-compatible
// message list. The records are fenced so the model treats them as data, not
// instructions, and the honest context note rides inside the user turn so it is never
// lost. Pure — unit-tested.
export function buildMessages(
  task: string,
  ctx: CourseContext,
  meta?: CourseMeta,
): ChatCompletionMessage[] {
  const system: ChatCompletionMessage = { role: 'system', content: SYSTEM_PROMPT };
  const header = courseHeader(meta);
  const user: ChatCompletionMessage = {
    role: 'user',
    content:
      `${header}${contextNote(ctx)}\n\n` +
      `---- course records ----\n${ctx.text}\n---- end course records ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
}

// extractContent pulls the assistant text out of a @hanzo/ai ChatCompletion,
// tolerating the string-or-parts content shape the OpenAI schema allows. Throws on
// empty content so callers surface the real gateway state. Pure — unit-tested.
export function extractContent(res: ChatCompletion): string {
  const msg = res?.choices?.[0]?.message;
  const content = msg?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map((part) => (part?.type === 'text' ? part.text : '')).join('');
  }
  if (text.length === 0) throw new Error('Hanzo API returned no content');
  return text;
}

// ---- The single call path -------------------------------------------------

export interface AskOptions {
  model?: string;
  temperature?: number;
  token?: string;
  baseURL?: string;
  /** Injected client (tests). Defaults to a real createAiClient. */
  client?: AiClient;
  signal?: AbortSignal;
}

// client resolves the @hanzo/ai client for a call: an injected one (tests) or a fresh
// createAiClient pointed at the gateway with the caller's bearer.
function client(opts: AskOptions): AiClient {
  return (
    opts.client ?? createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL })
  );
}

// ask runs ONE non-streaming completion over a course and returns the answer. This
// is the single path from every Canvas surface to the model — the actions, a freeform
// question, and any server-side call all funnel here. token may be empty (the gateway
// serves anonymous/limited models).
export async function ask(
  task: string,
  ctx: CourseContext,
  meta: CourseMeta | undefined,
  opts: AskOptions = {},
): Promise<string> {
  const res = await client(opts).chat.completions.create(
    {
      model: opts.model ?? DEFAULT_MODEL,
      messages: buildMessages(task, ctx, meta),
      stream: false,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
    { signal: opts.signal },
  );
  return extractContent(res);
}

// listModels returns the model ids the caller may route to, from /v1/models via the
// headless client. The endpoint is org-scoped by the bearer; an empty token lists
// public models.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const models = await client(opts).models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}
