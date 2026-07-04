// The Hanzo call and its request/response shaping over FINANCIAL data — thin
// over the published @hanzo/ai SDK, pure prompt assembly, fully unit-testable.
// The panel and the server proxy read QBO JSON, turn it into analysis text via
// finance.ts, and hand the FinanceContext here. Speaks the OpenAI-compatible /v1
// wire protocol the whole Hanzo suite uses (identical to @hanzo/docusign and
// @hanzo/pdf) so the gateway sees one shape from every surface.
//
// We import `createAiClient` from @hanzo/ai — the published headless client — and
// do NOT reimplement it. `ask`/`listModels` accept an injected AiClient so tests
// drive them without a network; production passes a real client built from the
// pasted key (panel) or the server's HANZO_API_KEY (proxy).

import { createAiClient, type AiClient, type ChatCompletion } from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from './config.js';
import type { FinanceContext } from './finance.js';
import { contextNote } from './finance.js';

// SYSTEM_PROMPT grounds every answer in the financial data provided. It forbids
// inventing figures nobody reported (the failure mode that makes an accounting
// assistant dangerous), asks the model to reference the specific line/account,
// stays honest about a truncated statement, and states plainly that the output
// is informational — not tax, audit, or accounting advice.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant that helps people understand their ' +
  'QuickBooks Online books — financial reports, invoices, bills, customers, ' +
  'accounts, and transactions. Work ONLY from the financial data provided ' +
  'below — never invent accounts, amounts, dates, or trends that are not ' +
  'supported by the data. Reference the specific line item or account by name ' +
  'when you cite a figure. Be concise, precise, and neutral, and keep monetary ' +
  'amounts in the reported currency. If the data is marked truncated and a ' +
  'complete answer needs the omitted part, say so plainly rather than ' +
  'guessing. You provide informational analysis, not tax, audit, or accounting ' +
  'advice.';

// ---- Prompt assembly ------------------------------------------------------

// A ChatMessage in the OpenAI-compatible schema. Local alias so call sites and
// tests do not depend on the SDK's exported member name.
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// buildMessages turns a task (the user's question, or one of the action prompts)
// plus the assembled financial context into the OpenAI-compatible message list.
// The data is fenced so the model treats it as data, not instructions, and the
// honest context note rides inside the user turn so scope is never lost. Pure —
// unit-tested. Mirrors @hanzo/docusign's buildMessages exactly (one prompt shape
// across the suite).
export function buildMessages(task: string, ctx: FinanceContext): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };
  const user: ChatMessage = {
    role: 'user',
    content:
      `${contextNote(ctx)}\n\n` +
      `---- financial data ----\n${ctx.text}\n---- end financial data ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
}

// extractContent pulls the assistant text out of an OpenAI-compatible completion,
// throwing on an empty/error body so callers surface the real gateway message.
// Pure — unit-tested. (The SDK's create() rejects on non-2xx; this guards a 2xx
// body that carries no usable content.)
export function extractContent(res: ChatCompletion): string {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// ---- The single call path -------------------------------------------------

export interface AskOptions {
  model?: string;
  temperature?: number;
  /** Bearer credential: an `hk-…` key or an IAM token. Empty → anonymous. */
  token?: string;
  baseURL?: string;
  /** Injected client (tests). Defaults to a real createAiClient. */
  client?: AiClient;
  signal?: AbortSignal;
}

// buildClient returns the injected client or a real one from @hanzo/ai bound to
// the gateway + bearer. One place constructs the SDK client so token/baseURL
// handling lives in a single spot.
function buildClient(opts: AskOptions): AiClient {
  return (
    opts.client ??
    createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL })
  );
}

// ask runs ONE non-streaming completion over financial data and returns the
// answer. This is the single path from every QuickBooks surface to the model —
// the actions, a freeform question, and the server proxy all funnel here. token
// may be empty (the gateway serves anonymous/limited models).
export async function ask(task: string, ctx: FinanceContext, opts: AskOptions = {}): Promise<string> {
  const client = buildClient(opts);
  const res = await client.chat.completions.create(
    {
      model: opts.model ?? DEFAULT_MODEL,
      messages: buildMessages(task, ctx),
      stream: false,
      temperature: opts.temperature,
    },
    { signal: opts.signal },
  );
  return extractContent(res);
}

// listModels returns the model ids the caller may route to, from /v1/models via
// the SDK client. The endpoint is org-scoped by the bearer; an empty token lists
// public models.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const client = buildClient(opts);
  const models = await client.models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}
