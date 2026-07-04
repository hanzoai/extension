// The Hanzo call and its request/response shaping over an AGREEMENT — pure,
// host-agnostic, and fully unit-testable (no DocuSign SDK, no DOM). The panel
// and the webhook server are the thin glue that read an envelope's document text
// and hand it here. Speaks the OpenAI-compatible /v1 wire protocol the whole
// Hanzo suite uses (identical to @hanzo/pdf and @hanzo/meetings) so the gateway
// sees one shape from every surface.
//
// This module is the agreement-aware core the headless client wraps: the
// document windowing/truncation and prompt assembly a *contract* surface adds on
// top of a generic chat call, kept pure so it is tested and reused by both the
// panel and the (browser-less) Connect webhook. The four AI actions (their
// prompt templates + output shaping) live in actions.ts, layered on `ask`.

import { createAiClient, extractContent, type AiClient, type ChatMessage } from './client.js';
import { DEFAULT_MODEL, DOCUMENT_CHAR_BUDGET, HANZO_API_BASE_URL } from './config.js';

// SYSTEM_PROMPT grounds every answer in the agreement text. It forbids inventing
// terms nobody agreed to (the failure mode that makes a contract assistant
// dangerous), asks for clause/section references when the text carries them, and
// stays honest about a truncated document. It also states plainly that the
// output is not legal advice — a contract tool that pretends otherwise is a
// liability.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant that helps people understand agreements and ' +
  'contracts inside DocuSign. Work ONLY from the agreement text provided below — ' +
  'never invent parties, dates, obligations, or clauses that are not supported by ' +
  'the text. Cite the clause or section number when the text carries it. Be ' +
  'concise, precise, and neutral. If the document is marked truncated and a ' +
  'complete answer needs the omitted part, say so plainly rather than guessing. ' +
  'You provide informational analysis, not legal advice.';

// ---- Document text windowing / truncation ---------------------------------
//
// A document arrives as ordered pages (one text block each, from pdf-text). A
// long contract won't fit a model window and shouldn't be sent whole. We window
// pages IN ORDER from the start and stop at the budget — order carries meaning
// in a contract (recitals, then terms, then signatures), so we never reorder,
// and we always include at least the first page.

// One page's extracted text.
export interface PageTextItem {
  page: number;
  text: string;
}

// The result of windowing a document down to what we'll attach: the rendered
// text, how many pages it covers, and whether anything was dropped (so the
// prompt and UI can say so honestly).
export interface DocumentContext {
  text: string;
  totalPages: number;
  includedPages: number;
  truncated: boolean;
}

// renderPage turns one page into a labeled block. Pure so the exact rendering
// (used to measure the budget) is what we also send.
export function renderPage(item: PageTextItem): string {
  const body = item.text.trim();
  return body ? `[Page ${item.page}]\n${body}` : `[Page ${item.page}]`;
}

// buildDocumentContext caps the rendered document at `budget` characters. It
// walks pages IN ORDER and stops when adding the next page would exceed the
// budget — always including at least the first page (hard-cut to the budget if
// that one page alone is over). `truncated` is true whenever not every page made
// it in. Pure and total: deterministic, no I/O. (Same windowing contract as
// @hanzo/meetings' transcript windowing — one algorithm for "fit ordered text
// to a budget".)
export function buildDocumentContext(
  pages: PageTextItem[],
  budget: number = DOCUMENT_CHAR_BUDGET,
): DocumentContext {
  const total = pages.length;
  if (total === 0) {
    return { text: '', totalPages: 0, includedPages: 0, truncated: false };
  }

  const blocks: string[] = [];
  let used = 0;
  let hardCut = false;

  for (let i = 0; i < total; i++) {
    const block = renderPage(pages[i]);
    const addition = (blocks.length === 0 ? '' : '\n\n') + block;
    if (used + addition.length > budget) {
      if (blocks.length === 0) {
        blocks.push(block.slice(0, budget));
        used = budget;
        hardCut = true;
      }
      break;
    }
    blocks.push(addition);
    used += addition.length;
  }

  const includedPages = hardCut ? 1 : blocks.length;
  const truncated = includedPages < total || hardCut;
  return { text: blocks.join(''), totalPages: total, includedPages, truncated };
}

// contextNote is the one honest sentence prepended to the agreement so the model
// (and, echoed in the panel, the user) knows the scope of what it sees. Never
// claim the whole agreement was sent when it wasn't.
export function contextNote(ctx: DocumentContext): string {
  if (ctx.totalPages === 0) return 'No agreement text was available.';
  return ctx.truncated
    ? `Agreement text: ${ctx.includedPages} of ${ctx.totalPages} pages (truncated to fit — answer only from what is shown and say so if the omitted part is needed).`
    : `Agreement text: the full document (${ctx.totalPages} page${ctx.totalPages === 1 ? '' : 's'}).`;
}

// ---- Prompt assembly ------------------------------------------------------

// Optional structured context about the agreement the DocuSign API supplies
// (title, status). Attached as a short header above the document so answers can
// reference the agreement without the model guessing.
export interface AgreementMeta {
  title?: string;
  status?: string;
  envelopeId?: string;
}

function agreementHeader(meta: AgreementMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.title) parts.push(`Agreement: ${meta.title}`);
  if (meta.status) parts.push(`Status: ${meta.status}`);
  return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
}

// buildMessages turns a task (the user's instruction, or one of the action
// prompts) plus the windowed document + optional metadata into the
// OpenAI-compatible message list. The agreement is fenced so the model treats it
// as data, not instructions, and the honest context note rides inside the user
// turn so it is never lost.
export function buildMessages(
  task: string,
  ctx: DocumentContext,
  meta?: AgreementMeta,
): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };
  const header = agreementHeader(meta);
  const user: ChatMessage = {
    role: 'user',
    content:
      `${header}${contextNote(ctx)}\n\n` +
      `---- agreement ----\n${ctx.text}\n---- end agreement ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
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

// ask runs ONE non-streaming completion over an agreement and returns the
// answer. This is the single path from every DocuSign surface to the model —
// the four actions, a freeform question, and the webhook auto-summary all funnel
// here. token may be empty (the gateway serves anonymous/limited models).
export async function ask(
  task: string,
  ctx: DocumentContext,
  meta: AgreementMeta | undefined,
  opts: AskOptions = {},
): Promise<string> {
  const client =
    opts.client ??
    createAiClient({ token: opts.token, baseURL: opts.baseURL ?? HANZO_API_BASE_URL });
  const res = await client.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages: buildMessages(task, ctx, meta),
    temperature: opts.temperature,
    signal: opts.signal,
  });
  return extractContent(res);
}

// listModels returns the model ids the caller may route to, from /v1/models via
// the headless client. The endpoint is org-scoped by the bearer; an empty token
// lists public models.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const client =
    opts.client ??
    createAiClient({ token: opts.token, baseURL: opts.baseURL ?? HANZO_API_BASE_URL });
  const models = await client.models.list(opts.signal);
  return models.map((m) => m.id);
}
