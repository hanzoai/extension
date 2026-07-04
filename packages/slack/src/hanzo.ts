/**
 * Thin Hanzo layer for Slack: turn a prompt + Slack context into ONE completion,
 * and validate an inbound Hanzo user token for owner-scoping.
 *
 * Composition, not copies: message shaping is pure and unit-testable; the actual
 * call goes through the headless {@link createAiClient} — Slack never speaks raw
 * HTTP to the gateway. Quick actions are prompt templates over the same
 * `complete` primitive, so there is exactly one code path to the model.
 */

import { validateToken, type AuthResult } from '@hanzo/iam';
import { createAiClient, extractContent, type AiClient, type ChatMessage } from './client.js';
import type { HanzoConfig } from './config.js';

/**
 * The catalog of quick actions. Each is a prompt template applied to the Slack
 * context (thread text or a single message). `id` matches the `hanzo_quick_action:<id>`
 * action id from `@hanzo/cards`; `label` is the chip text.
 */
export const QUICK_ACTIONS = {
  summarize: {
    label: 'Summarize',
    style: 'primary' as const,
    prompt:
      'Summarize the following Slack conversation. Give a tight bullet list of ' +
      'the key points and any decisions reached. No preamble.',
  },
  draft_reply: {
    label: 'Draft reply',
    style: 'default' as const,
    prompt:
      'Draft a clear, professional reply to the following Slack conversation. ' +
      'Return only the reply text, ready to send.',
  },
  explain: {
    label: 'Explain',
    style: 'default' as const,
    prompt:
      'Explain the following Slack conversation in plain language for someone ' +
      'new to the thread. Define jargon. No preamble.',
  },
  action_items: {
    label: 'Action items',
    style: 'default' as const,
    prompt:
      'Extract every action item from the following Slack conversation as a ' +
      'checklist. Each line: owner (if named) then the task. No preamble.',
  },
} as const;

/** A quick-action id from the catalog. */
export type QuickActionId = keyof typeof QUICK_ACTIONS;

/** True when `id` names a known quick action. Boundary guard. */
export function isQuickActionId(id: string): id is QuickActionId {
  return Object.prototype.hasOwnProperty.call(QUICK_ACTIONS, id);
}

const SYSTEM_PROMPT =
  'You are Hanzo AI, a helpful assistant inside Slack. Be concise and use ' +
  "Slack mrkdwn (single *bold*, _italic_, `code`, and - bullets). Don't invent " +
  'facts about the conversation; work only from what is given.';

/**
 * Build the OpenAI-compatible message list for a task run against Slack context.
 * When `context` is present it is fenced so the model treats it as data, not
 * instructions. Pure — unit-tested.
 */
export function buildMessages(prompt: string, context: string): ChatMessage[] {
  const trimmed = context.trim();
  const user: ChatMessage = {
    role: 'user',
    content: trimmed
      ? `${prompt}\n\n---- Slack conversation ----\n${trimmed}\n---- end ----`
      : prompt,
  };
  return [{ role: 'system', content: SYSTEM_PROMPT }, user];
}

/** Resolve a quick action id to its prompt template. Throws on unknown id. */
export function quickActionPrompt(id: string): string {
  if (!isQuickActionId(id)) throw new Error(`Unknown quick action: ${id}`);
  return QUICK_ACTIONS[id].prompt;
}

/** Inputs for {@link complete}. */
export interface CompleteInput {
  /** The user instruction (freeform prompt or a quick-action template). */
  prompt: string;
  /** Slack context (thread/message text). Empty for a pure ask. */
  context: string;
  /** Model id to route to. */
  model: string;
  /** Bearer credential for the gateway (workspace token or default). */
  token: string;
  /** Gateway base URL. */
  baseURL: string;
  /** Injected client (tests). Defaults to a real {@link createAiClient}. */
  client?: AiClient;
  /** Abort the run. */
  signal?: AbortSignal;
}

/**
 * Run ONE non-streaming completion and return the assistant text. This is the
 * single path from Slack to the model — slash command, home submit, and quick
 * actions all funnel here.
 */
export async function complete(input: CompleteInput): Promise<string> {
  const client =
    input.client ?? createAiClient({ token: input.token, baseURL: input.baseURL });
  const res = await client.chat.completions.create({
    model: input.model,
    messages: buildMessages(input.prompt, input.context),
    signal: input.signal,
  });
  return extractContent(res);
}

/**
 * Validate an inbound Hanzo user token against IAM and return the auth result
 * ({ ok, owner, claims } or { ok:false, reason }). Used to owner-scope a request
 * when a Slack user has linked their Hanzo identity. Delegates to `@hanzo/iam`.
 */
export function validateHanzoToken(
  token: string,
  hanzo: HanzoConfig,
): Promise<AuthResult> {
  return validateToken(token, {
    serverUrl: hanzo.iamServerUrl,
    clientId: hanzo.iamClientId,
  });
}
