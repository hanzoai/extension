/**
 * Thin Hanzo layer: turn a system+user prompt into ONE completion, and validate
 * an inbound Hanzo user token for owner-scoping.
 *
 * Composition, not copies: the actual call goes through the published headless
 * {@link createAiClient} from `@hanzo/ai` — this package never speaks raw HTTP to
 * the gateway, and there is exactly one code path to the model (`complete`). PR
 * review and issue triage both funnel here.
 */

import { createAiClient, type AiClient, type ChatCompletionMessage } from '@hanzo/ai';
import { validateToken, type AuthResult } from '@hanzo/iam';
import type { HanzoConfig } from './config.js';

/** A chat message in the OpenAI-compatible schema `@hanzo/ai` speaks. */
export type ChatMessage = ChatCompletionMessage;

/**
 * Build the message list for a run: a system prompt that frames the assistant
 * and a user prompt carrying the task + fenced context. Pure — unit-tested.
 * Keeping this separate from the network call is what makes prompt assembly
 * (review.ts, triage.ts) testable end-to-end without a gateway.
 */
export function buildMessages(system: string, user: string): ChatMessage[] {
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Extract assistant text from a `@hanzo/ai` completion. The SDK types `content`
 * as `string | ContentPart[] | undefined`; reviews are text, so we read the
 * string form and join text parts, throwing on an empty/absent body so callers
 * surface the real gateway state rather than posting an empty review. Pure.
 */
export function extractContent(res: {
  choices: Array<{ message: { content?: string | Array<{ type: string; text?: string }> } }>;
}): string {
  const content = res.choices[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
            .join('')
        : '';
  if (!text.trim()) throw new Error('Hanzo API returned no content');
  return text;
}

/** Inputs for {@link complete}. */
export interface CompleteInput {
  /** System prompt framing the assistant. */
  system: string;
  /** User prompt: task + fenced context. */
  user: string;
  /** Model id to route to. */
  model: string;
  /** Bearer credential for the gateway (`hk-…` key or IAM bearer). May be ''. */
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
 * single path from GitHub to the model — PR review, issue triage, and `@hanzo`
 * mentions all reach the gateway through here.
 */
export async function complete(input: CompleteInput): Promise<string> {
  const client =
    input.client ??
    createAiClient({ baseUrl: input.baseURL, token: input.token || undefined });
  const res = await client.chat.completions.create(
    { model: input.model, messages: buildMessages(input.system, input.user), stream: false },
    { signal: input.signal },
  );
  return extractContent(res);
}

/**
 * Validate an inbound Hanzo user token against IAM and return the auth result
 * ({ ok, owner, claims } or { ok:false, reason }). Used to owner-scope a request
 * when a GitHub user has linked their Hanzo identity. Delegates to `@hanzo/iam`.
 */
export function validateHanzoToken(token: string, hanzo: HanzoConfig): Promise<AuthResult> {
  return validateToken(token, {
    serverUrl: hanzo.iamServerUrl,
    clientId: hanzo.iamClientId,
  });
}
