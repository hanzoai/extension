// The Hanzo call and its request/response shaping over a DOCUMENT / MATTER context
// — thin over the published `@hanzo/ai` headless client, host-agnostic, and fully
// unit-testable (no iManage SDK, no DOM). The panel and the server are the glue
// that read a document's profile + content and hand them here. Speaks the
// OpenAI-compatible /v1 wire protocol the whole Hanzo suite uses (identical to
// @hanzo/procore) so the gateway sees one shape from every surface.
//
// @hanzo/ai@^0.2.0 IS the headless client: createAiClient({ baseUrl, token })
// → .chat.completions.create({ model, messages }) + .models.list(). We import it
// and do NOT reimplement the transport. This module adds only the document-aware
// prompt assembly + the single `ask` primitive the actions layer on.

import {
  createAiClient,
  type AiClient,
  type ChatCompletion,
  type ChatCompletionMessage,
} from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from './config.js';
import { contextNote, type DocumentContext } from './documents.js';

// SYSTEM_PROMPT grounds every answer in the iManage records. It forbids inventing
// clauses, dates, parties, or terms that nobody wrote (the failure mode that makes
// a legal assistant dangerous), asks it to cite the document name/number, and
// stays honest about truncated context. It states plainly that the output is
// informational and NOT legal advice — a review tool that pretends otherwise is a
// liability — and reinforces the confidentiality posture (work only from what is
// shown; do not restate more of the privileged text than the task needs).
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant that helps legal and professional teams work ' +
  'with documents in their iManage Work matter — contracts, correspondence, ' +
  'pleadings, and memos. Work ONLY from the document content and profile records ' +
  'provided below — never invent clauses, dates, parties, defined terms, dollar ' +
  'amounts, or facts that are not supported by the text. Cite the document name or ' +
  'number when the text carries it, and quote exact contract language when a clause ' +
  'or figure matters. Be precise, neutral, and concise. If the records are marked ' +
  'truncated and a complete answer needs the omitted part, say so plainly rather ' +
  'than guessing. These are confidential, potentially privileged materials: reveal ' +
  'no more of the text than the task requires. You provide informational document ' +
  'review support, NOT legal advice, and you do not create an attorney-client ' +
  'relationship.';

// ---- Prompt assembly ------------------------------------------------------

// Optional structured context about the matter (workspace name, matter number,
// client) the iManage records supply. Attached as a short header above the records
// so answers can reference the matter without the model guessing.
export interface MatterMeta {
  workspaceName?: string;
  matterNumber?: string;
  client?: string;
}

function matterHeader(meta: MatterMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.workspaceName) parts.push(`Workspace: ${meta.workspaceName}`);
  if (meta.matterNumber) parts.push(`Matter #: ${meta.matterNumber}`);
  if (meta.client) parts.push(`Client: ${meta.client}`);
  return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
}

// buildMessages turns a task (the user's question, or one of the action prompts)
// plus the windowed document context + optional matter metadata into the
// OpenAI-compatible message list. The records are fenced so the model treats them
// as data, not instructions, and the honest context note rides inside the user
// turn so it is never lost. Pure — unit-tested.
export function buildMessages(
  task: string,
  ctx: DocumentContext,
  meta?: MatterMeta,
): ChatCompletionMessage[] {
  const system: ChatCompletionMessage = { role: 'system', content: SYSTEM_PROMPT };
  const header = matterHeader(meta);
  const user: ChatCompletionMessage = {
    role: 'user',
    content:
      `${header}${contextNote(ctx)}\n\n` +
      `---- document records ----\n${ctx.text}\n---- end document records ----\n\n` +
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

// client resolves the @hanzo/ai client for a call: an injected one (tests) or a
// fresh createAiClient pointed at the gateway with the caller's bearer.
function client(opts: AskOptions): AiClient {
  return (
    opts.client ??
    createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL })
  );
}

// ask runs ONE non-streaming completion over a document/matter context and returns
// the answer. This is the single path from every iManage surface to the model —
// the actions, a freeform question, and any server-side call all funnel here. token
// may be empty (the gateway serves anonymous/limited models).
export async function ask(
  task: string,
  ctx: DocumentContext,
  meta: MatterMeta | undefined,
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
