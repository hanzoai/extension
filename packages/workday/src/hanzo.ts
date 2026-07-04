// The Hanzo call and its request/response shaping over Workday PEOPLE records —
// thin over the published `@hanzo/ai` headless client, host-agnostic, and fully
// unit-testable (no Workday SDK, no DOM). The panel and the server are the glue
// that read a tenant's records and hand them here. Speaks the OpenAI-compatible
// /v1 wire protocol the whole Hanzo suite uses (identical to @hanzo/procore) so
// the gateway sees one shape from every surface.
//
// @hanzo/ai@^0.2.0 IS the headless client: createAiClient({ baseUrl, token })
// → .chat.completions.create({ model, messages }) + .models.list(). We import it
// and do NOT reimplement the transport. This module adds only the people-aware
// prompt assembly + the single `ask` primitive the actions layer on.

import {
  createAiClient,
  type AiClient,
  type ChatCompletion,
  type ChatCompletionMessage,
} from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from './config.js';
import { contextNote, type PeopleContext } from './people.js';

// SYSTEM_PROMPT grounds every answer in the Workday records and, critically for
// HR, guards the personal data they contain. It forbids inventing facts nobody
// recorded, forbids inferring protected characteristics / health / performance
// beyond the records, and states plainly that the output is informational support
// for HR professionals — not an employment, compensation, legal, or disciplinary
// decision. A people tool that pretends otherwise is a liability.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant that helps HR and people teams work with their ' +
  'Workday tenant — worker profiles, organizations, headcount, time off, and job ' +
  'requisitions. Work ONLY from the Workday records provided below — never invent ' +
  'people, titles, dates, compensation, or facts that are not supported by the ' +
  'records. These records contain personal employee data: handle it discreetly, ' +
  'never infer or output protected characteristics, health, or performance ' +
  'conclusions that are not present, and reference workers only as the records ' +
  'name them. Be concise, precise, and neutral. If the records are marked ' +
  'truncated and a complete answer needs the omitted part, say so plainly rather ' +
  'than guessing. You provide informational support to HR professionals — not ' +
  'employment, compensation, legal, or disciplinary decisions, which require human ' +
  'judgment and review.';

// ---- Prompt assembly ------------------------------------------------------

// Optional structured context about the scope (tenant, organization, subject
// worker) the Workday API supplies. Attached as a short header above the records
// so answers can reference the scope without the model guessing.
export interface PeopleMeta {
  tenant?: string;
  organization?: string;
  subject?: string;
}

function peopleHeader(meta: PeopleMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.subject) parts.push(`Subject: ${meta.subject}`);
  if (meta.organization) parts.push(`Organization: ${meta.organization}`);
  if (meta.tenant) parts.push(`Tenant: ${meta.tenant}`);
  return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
}

// buildMessages turns a task (the user's question, or one of the action prompts)
// plus the windowed people context + optional metadata into the OpenAI-compatible
// message list. The records are fenced so the model treats them as data, not
// instructions, and the honest context note rides inside the user turn so it is
// never lost. Pure — unit-tested.
export function buildMessages(
  task: string,
  ctx: PeopleContext,
  meta?: PeopleMeta,
): ChatCompletionMessage[] {
  const system: ChatCompletionMessage = { role: 'system', content: SYSTEM_PROMPT };
  const header = peopleHeader(meta);
  const user: ChatCompletionMessage = {
    role: 'user',
    content:
      `${header}${contextNote(ctx)}\n\n` +
      `---- workday records ----\n${ctx.text}\n---- end workday records ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
}

// extractContent pulls the assistant text out of a @hanzo/ai ChatCompletion,
// tolerating the string-or-parts content shape the OpenAI schema allows. Throws
// on empty content so callers surface the real gateway state. Pure — unit-tested.
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

// client resolves the @hanzo/ai client for a call: an injected one (tests) or a
// fresh createAiClient pointed at the gateway with the caller's bearer.
function client(opts: AskOptions): AiClient {
  return (
    opts.client ??
    createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL })
  );
}

// ask runs ONE non-streaming completion over the people context and returns the
// answer. This is the single path from every Workday surface to the model — the
// actions, a freeform question, and any server-side call all funnel here. token
// may be empty (the gateway serves anonymous/limited models).
export async function ask(
  task: string,
  ctx: PeopleContext,
  meta: PeopleMeta | undefined,
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

// listModels returns the model ids the caller may route to, from /v1/models via
// the headless client. The endpoint is org-scoped by the bearer; an empty token
// lists public models.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const models = await client(opts).models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}
