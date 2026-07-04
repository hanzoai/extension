// The Hanzo call and its request/response shaping over a CRM RECORD — pure,
// host-agnostic, and fully unit-testable (no HubSpot runtime, no DOM). The card
// and the serverless function are the thin glue that read a record + its
// associations and hand them here. Speaks to the Hanzo gateway through the
// PUBLISHED `@hanzo/ai` headless client (createAiClient) — we do NOT reimplement
// a client; the whole suite routes through one `/v1` shape.
//
// This module is the record-aware core: the record-context windowing/truncation
// and prompt assembly a *CRM* surface adds on top of a generic chat call, kept
// pure so it is tested and reused. The four AI actions (their prompt templates)
// live below, layered on `complete`.

import { createAiClient, type AiClient, type ChatCompletionMessage } from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL, RECORD_CHAR_BUDGET } from './config.js';

// SYSTEM_PROMPT grounds every answer in the record. It forbids inventing facts
// not present in the record data (the failure mode that makes a CRM assistant
// dangerous — a fabricated deal amount or a made-up contact detail), keeps the
// tone appropriate for a sales/CS rep, and stays honest about truncated context.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, an assistant embedded in a HubSpot CRM record for a sales, ' +
  'marketing, or customer-success team. You are given a CRM record (a contact, ' +
  'company, or deal) with its properties and associated records, plus a task. ' +
  'Work ONLY from the record data provided — never invent contacts, amounts, ' +
  'dates, or history that is not in the data. Be concise, specific, and ' +
  'actionable. If the data is marked truncated and a complete answer needs the ' +
  'omitted part, say so plainly rather than guessing.';

// ── Record-context assembly / truncation (pure) ─────────────────────────────
//
// A record arrives as its own properties plus, optionally, ordered blocks of
// associated records (its deals, its companies, recent notes). We render them in
// order and cap the whole at a character budget — associations carry meaning in
// order (the primary record first, then its context), so we never reorder, and
// the record's own block always survives.

// One labeled block of the assembled context (the record itself, or one group of
// associated records already rendered to text by the caller).
export interface ContextBlock {
  label: string;
  text: string;
}

// The result of assembling a record's context down to what we'll attach: the
// rendered text, and whether anything was dropped (so the prompt and card can
// say so honestly).
export interface RecordContext {
  text: string;
  truncated: boolean;
}

// renderProperties turns a record's property map into stable `key: value` lines,
// dropping empty values (an empty property is noise, not signal) and sorting
// keys so the rendering is deterministic (testable, and stable across calls).
// Pure.
export function renderProperties(properties: Record<string, string>): string {
  return Object.keys(properties)
    .sort()
    .map((k) => [k, properties[k]] as const)
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

// assembleRecordContext renders ordered blocks into the single fenced string
// handed to Hanzo, capped at `budget` characters. It walks blocks IN ORDER and
// stops when adding the next block would exceed the budget — always including at
// least the first block (hard-cut to the budget if that one block is over).
// `truncated` is true whenever not every block made it in. Pure and total:
// deterministic, no I/O. (Same "fit ordered text to a budget" contract as
// @hanzo/notion's page windowing — one algorithm, reused.)
export function assembleRecordContext(
  blocks: ContextBlock[],
  budget: number = RECORD_CHAR_BUDGET,
): RecordContext {
  if (blocks.length === 0) return { text: '', truncated: false };

  const rendered: string[] = [];
  let used = 0;
  let hardCut = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const block = b.text.trim() ? `### ${b.label}\n${b.text.trim()}` : `### ${b.label}`;
    const addition = (rendered.length === 0 ? '' : '\n\n') + block;
    if (used + addition.length > budget) {
      if (rendered.length === 0) {
        rendered.push(block.slice(0, budget));
        used = budget;
        hardCut = true;
      }
      break;
    }
    rendered.push(addition);
    used += addition.length;
  }

  const includedBlocks = hardCut ? 1 : rendered.length;
  const truncated = includedBlocks < blocks.length || hardCut;
  return { text: rendered.join(''), truncated };
}

// contextNote is the one honest sentence prepended so the model (and, echoed in
// the card, the user) knows the scope of what it sees. Never claim the whole
// record context was sent when it wasn't.
export function contextNote(ctx: RecordContext): string {
  if (ctx.text.length === 0) return 'No record data was available.';
  return ctx.truncated
    ? 'Record data (truncated to fit — answer only from what is shown and say so if the omitted part is needed).'
    : 'Record data (complete).';
}

// buildMessages turns a task (one of the action prompts, or a freeform question)
// plus the assembled record context into the OpenAI-compatible message list the
// published client sends. The record is fenced so the model treats it as data,
// not instructions (a prompt-injection boundary), and the honest context note
// rides inside the user turn so it is never lost. Pure — unit-tested.
export function buildMessages(task: string, ctx: RecordContext): ChatCompletionMessage[] {
  const system: ChatCompletionMessage = { role: 'system', content: SYSTEM_PROMPT };
  const user: ChatCompletionMessage = {
    role: 'user',
    content:
      `${contextNote(ctx)}\n\n` +
      `---- record ----\n${ctx.text}\n---- end record ----\n\n` +
      `---- task ----\n${task}`,
  };
  return [system, user];
}

// extractContent pulls the assistant text out of a published-client ChatCompletion.
// The gateway returns choices[0].message.content; we throw on an empty/missing
// content so the caller surfaces a real failure rather than writing back nothing.
// Pure — unit-tested against the published response shape.
export function extractContent(res: { choices?: Array<{ message?: { content?: unknown } }> }): string {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// ── The single call path ────────────────────────────────────────────────────

export interface CompleteOptions {
  model?: string;
  temperature?: number;
  /** Hanzo bearer: an `hk-…` API key or IAM token. Held server-side only. */
  token?: string;
  baseURL?: string;
  /** Injected client (tests). Defaults to a real createAiClient. */
  client?: AiClient;
  signal?: AbortSignal;
}

// complete runs ONE non-streaming completion over a record and returns the
// answer. This is the SINGLE path from every HubSpot surface to the model — the
// four actions and a freeform question all funnel here. Built directly on the
// published `@hanzo/ai` createAiClient: no bespoke transport, one `/v1` shape.
// `token` may be empty (the gateway serves anonymous/limited models); when set,
// it is the portal's Hanzo key read from the serverless env, never the frontend.
export async function complete(
  task: string,
  ctx: RecordContext,
  opts: CompleteOptions = {},
): Promise<string> {
  const client =
    opts.client ??
    createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL });
  const res = await client.chat.completions.create(
    {
      model: opts.model ?? DEFAULT_MODEL,
      messages: buildMessages(task, ctx),
      temperature: opts.temperature,
      stream: false,
    },
    { signal: opts.signal },
  );
  return extractContent(res);
}

// listModels returns the model ids the caller may route to, from /v1/models via
// the published client. The catalog is org-scoped by the bearer; an empty token
// lists public models. Powers the card's model picker.
export async function listModels(opts: CompleteOptions = {}): Promise<string[]> {
  const client =
    opts.client ??
    createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL });
  const models = await client.models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}

// ── The four action definitions (pure task strings) ─────────────────────────

export type ActionId = 'summarize' | 'draft' | 'nextSteps' | 'ask';

// actionTask maps an action id (+ optional user detail) to its task instruction.
// `draft` and `ask` take a user-supplied detail (what to write about / the
// question); `summarize` and `nextSteps` are fixed. Pure — unit-tested.
export function actionTask(id: ActionId, detail = ''): string {
  switch (id) {
    case 'summarize':
      return (
        'Summarize this record for a rep about to engage. Lead with a one-line ' +
        'overview (who/what this is and where it stands), then 3–6 tight bullets ' +
        'covering the key facts, the relationship, and any open items. No preamble.'
      );
    case 'draft': {
      const about = detail.trim() || 'a friendly, professional follow-up appropriate to where this relationship stands';
      return (
        `Draft an email to this contact about ${about}. Use the record data to ` +
        'personalize it (name, company, recent activity). Keep it short, warm, and ' +
        'specific. Return ONLY the email body — no subject line unless asked, no ' +
        'preamble, no placeholders like [Name] when the data gives the real value.'
      );
    }
    case 'nextSteps':
      return (
        'Recommend the next steps for this record. Return a short prioritized list ' +
        '(3–5 items); each is a concrete action a rep can take, grounded in the ' +
        'record data. No preamble.'
      );
    case 'ask':
      return detail.trim() || 'What should I know about this record before reaching out?';
  }
}
