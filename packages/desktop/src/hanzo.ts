// The single call path to the model — a THIN wrapper over the PUBLISHED headless
// client `@hanzo/ai` (createAiClient). We do NOT reimplement the transport. This
// module owns only client construction (token + baseURL wiring) and three
// primitives the app needs: run a built message list to text (quick actions),
// stream a built message list chunk-by-chunk (the assistant view), and list models
// (the picker). The action-aware layer (context, prompts, parsing) is entirely in
// actions.ts; the Tauri-aware layer (read clipboard, paste) is in clipboard.ts.
// Both are pure of the SDK; this is the only place the SDK is called.

import { createAiClient, type AiClient } from "@hanzo/ai";
import { DEFAULT_MODEL, HANZO_API_BASE_URL } from "./config.js";
import type { ChatMessage } from "./actions.js";

export interface AskOptions {
  model?: string;
  temperature?: number;
  /** Hanzo `sk-` key (from the local store); sent as the bearer. */
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
  return (
    opts.client ??
    createAiClient({
      token: opts.token,
      baseUrl: opts.baseURL ?? HANZO_API_BASE_URL,
    })
  );
}

// runChat is the single non-streaming path from a built message list to the model.
// The quick-action commands (summarize, explain, rewrite, translate, fix-grammar)
// funnel here when the app wants the whole result before it copies/pastes. token
// may be empty (the gateway serves anonymous/limited models), but the app gates on
// a valid `sk-` key first.
export async function runChat(
  messages: ChatMessage[],
  opts: AskOptions = {},
): Promise<string> {
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
  if (typeof content !== "string" || content === "") {
    throw new Error("Hanzo API returned no content");
  }
  return content;
}

// streamChat is the single streaming path — the assistant view renders the reply
// as it arrives. It calls onDelta with each text chunk and resolves with the full
// concatenated text (so the caller can parse/copy the final result). Same client
// wiring as runChat; stream:true selects the SDK's AsyncGenerator overload.
export async function streamChat(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  opts: AskOptions = {},
): Promise<string> {
  const stream = await client(opts).chat.completions.create(
    {
      model: opts.model ?? DEFAULT_MODEL,
      messages,
      temperature: opts.temperature,
      stream: true,
    },
    { signal: opts.signal },
  );
  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      full += delta;
      onDelta(delta);
    }
  }
  if (full === "") throw new Error("Hanzo API returned no content");
  return full;
}

// listModels returns the model ids the caller may route to, from /v1/models via
// the headless client. Org-scoped by the bearer; an empty token lists public
// models. Powers the settings model-picker.
export async function listModels(opts: AskOptions = {}): Promise<string[]> {
  const models = await client(opts).models.list({ signal: opts.signal });
  return models.map((m) => m.id);
}
