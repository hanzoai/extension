// The single call path to the model — a THIN wrapper over the PUBLISHED headless
// client `@hanzo/ai` (createAiClient). We do NOT reimplement the transport. This
// module owns only client construction (token + baseURL wiring) and the two
// primitives the panel needs: run a built message list to text, and list models.
// The design-aware layer (context, prompts, parsing) is entirely in
// design-core.ts; the Canva-aware layer (read selection, insert text) is in
// canva.ts. Both are pure of the SDK; this is the only place the SDK is called.

import { createAiClient, type AiClient } from '@hanzo/ai';
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from './config.js';
import type { ChatMessage } from './design-core.js';

export interface AskOptions {
  model?: string;
  temperature?: number;
  /** Hanzo `hk-` key pasted by the user; sent as the bearer. */
  token?: string;
  baseURL?: string;
  /** Injected client (tests). Defaults to a real createAiClient. */
  client?: AiClient;
  signal?: AbortSignal;
}

// client resolves an AiClient: the injected one (tests) or a real published
// @hanzo/ai client pointed at the gateway with the caller's bearer. One place
// constructs it so the token/baseURL wiring is identical for every call.
function client(opts: AskOptions): AiClient {
  return opts.client ?? createAiClient({ token: opts.token, baseUrl: opts.baseURL ?? HANZO_API_BASE_URL });
}

// runChat is the single path from a built message list to the model. Every Canva
// surface (every action) funnels here. Non-streaming: the panel renders the
// final text and inserts it. token may be empty (the gateway serves anonymous/
// limited models), but the panel gates on a valid `hk-` key first.
export async function runChat(messages: ChatMessage[], opts: AskOptions = {}): Promise<string> {
  const res = await client(opts).chat.completions.create(
    {
      model: opts.model ?? DEFAULT_MODEL,
      messages,
      temperature: opts.temperature,
      stream: false,
    },
    { signal: opts.signal },
  );
  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// listModels returns the model ids the caller may route to, from /v1/models via
// the headless client. Org-scoped by the bearer; an empty token lists public
// models.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const models = await client(opts).models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}
