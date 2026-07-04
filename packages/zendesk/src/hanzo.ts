// The Hanzo layer for Zendesk: turn a quick action + ticket context into ONE
// streamed completion, and validate a pasted key. Composition, not copies —
// every call goes through the published headless client `@hanzo/ai`; this app
// never speaks raw HTTP to the gateway. Message shaping and the quick-action
// catalog are PURE and unit-tested; only `complete`/`stream` touch the network.

import {
  createAiClient,
  type AiClient,
  type ChatCompletionMessage,
  type ChatCompletionContentPart,
} from '@hanzo/ai';
import { API_BASE_URL, DEFAULT_MODEL } from './config.js';
import type { TicketContext } from './ticket.js';
import { contextNote } from './ticket.js';

/** The support-agent persona. Grounded in the ticket, writes in the agent's
 *  voice, never invents facts, flags when a human must verify. */
export const SYSTEM_PROMPT =
  'You are Hanzo AI, embedded in a Zendesk support agent\'s ticket sidebar. You ' +
  'help the agent resolve the ticket faster. Work ONLY from the ticket context ' +
  'provided — if the answer is not there, say so plainly rather than guessing. ' +
  'When drafting a reply, write in the agent\'s voice: warm, clear, professional, ' +
  'and ready to send with no placeholders. Be concise. Never promise anything ' +
  'the ticket does not support, and note where the agent should verify before sending.';

/** The catalog of quick actions. Each is a prompt template applied to the ticket
 *  context. `id` is the stable key used by the panel; `label` is the button text.
 *  Content/config, not logic — the one place actions are defined. */
export const QUICK_ACTIONS = {
  summarize: {
    label: 'Summarize ticket',
    prompt:
      'Summarize this support ticket for the agent: the customer\'s problem, what ' +
      'has been tried, the current state, and what is blocking resolution. Tight ' +
      'bullets, no preamble.',
  },
  draft_reply: {
    label: 'Draft reply',
    prompt:
      'Draft the next reply to the customer, in the support agent\'s voice, ' +
      'addressing their most recent message. Return ONLY the reply text, ready to ' +
      'send — no greeting placeholders, no "[your name]".',
  },
  next_steps: {
    label: 'Suggest next steps',
    prompt:
      'Suggest the next steps to resolve this ticket: concrete actions for the ' +
      'agent, and if a macro or canned response fits, name the kind of macro to ' +
      'apply. Short checklist, no preamble.',
  },
  explain: {
    label: 'Explain the issue',
    prompt:
      'Explain the underlying issue in this ticket in plain language for an agent ' +
      'picking it up cold: what the customer wants, why it is happening if the ' +
      'thread says, and what a good resolution looks like. No preamble.',
  },
} as const;

/** A quick-action id from the catalog. */
export type QuickActionId = keyof typeof QUICK_ACTIONS;

/** True when `id` names a known quick action. Boundary guard. */
export function isQuickActionId(id: string): id is QuickActionId {
  return Object.prototype.hasOwnProperty.call(QUICK_ACTIONS, id);
}

/** Resolve a quick-action id to its prompt template. Throws on unknown id. */
export function quickActionPrompt(id: string): string {
  if (!isQuickActionId(id)) throw new Error(`Unknown quick action: ${id}`);
  return QUICK_ACTIONS[id].prompt;
}

/** buildMessages assembles the OpenAI-compatible message list from the task and
 *  the windowed ticket context. The context is fenced and preceded by the honest
 *  scope note so the model treats it as data (never instructions) and knows what
 *  it can and cannot see. Pure — unit-tested. */
export function buildMessages(task: string, ctx: TicketContext): ChatCompletionMessage[] {
  const parts = [contextNote(ctx), '', ctx.text, '', '---- task ----', task];
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

/** Inputs shared by {@link stream} and {@link complete}. */
export interface RunInput {
  /** The instruction (a quick-action template or a freeform "Ask"). */
  task: string;
  /** The windowed ticket context. */
  ctx: TicketContext;
  /** Model id to route to. */
  model?: string;
  /** Bearer credential for the gateway: the pasted `hk-…` key. Empty is allowed
   *  (the gateway serves anonymous/limited models). */
  token: string;
  /** Injected client (tests). Defaults to a real `createAiClient`. */
  client?: AiClient;
  /** Abort the run. */
  signal?: AbortSignal;
}

/** Build the client for a run. Centralised so base URL + token wiring is in ONE
 *  place and tests can inject a fake. */
function clientFor(input: RunInput): AiClient {
  return input.client ?? createAiClient({ baseUrl: API_BASE_URL, token: input.token });
}

/** Run ONE streaming completion, invoking `onDelta` with each text chunk as it
 *  arrives, and resolve with the full concatenated text. This is the single path
 *  from the panel to the model — every quick action and the freeform ask funnel
 *  here. */
export async function stream(
  input: RunInput,
  onDelta: (text: string) => void,
): Promise<string> {
  const client = clientFor(input);
  const chunks = await client.chat.completions.create(
    { model: input.model || DEFAULT_MODEL, messages: buildMessages(input.task, input.ctx), stream: true },
    { signal: input.signal },
  );
  let full = '';
  for await (const chunk of chunks) {
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}

/** Flatten an assistant message's content to plain text. The gateway may return
 *  a string or OpenAI content parts; we concatenate the text parts. Pure —
 *  unit-tested. */
export function messageText(content: string | ChatCompletionContentPart[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('');
}

/** Run ONE non-streaming completion and return the assistant text. Used where a
 *  stream is not wanted (and by tests). */
export async function complete(input: RunInput): Promise<string> {
  const client = clientFor(input);
  const res = await client.chat.completions.create(
    { model: input.model || DEFAULT_MODEL, messages: buildMessages(input.task, input.ctx), stream: false },
    { signal: input.signal },
  );
  return messageText(res.choices?.[0]?.message?.content);
}

/** Validate a pasted key by listing models with it — a key that can't list
 *  models is rejected before it's used. Returns the model ids on success so the
 *  caller can populate the picker in one round-trip. */
export async function validateKey(token: string): Promise<string[]> {
  const t = token.trim();
  if (!t) throw new Error('Enter a Hanzo API key (hk-…).');
  const client = createAiClient({ baseUrl: API_BASE_URL, token: t });
  const models = await client.models.list();
  return models.map((m) => m.id).filter((id) => typeof id === 'string' && id.length > 0);
}

/** List model ids available to `token` (empty lists public models). Never
 *  throws to the caller of the panel — returns [] on failure so the picker can
 *  fall back to the default. */
export async function listModels(token: string): Promise<string[]> {
  try {
    const client = createAiClient({ baseUrl: API_BASE_URL, token: token.trim() });
    const models = await client.models.list();
    return models.map((m) => m.id).filter((id) => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}
