/**
 * Thin Hanzo AI wrapper.
 *
 * The bot talks to api.hanzo.ai through `@hanzo/ai`'s headless client
 * (`createAiClient`) — never a raw `fetch`, never an `/api/` path. Card hosts
 * are non-streaming, so we only ever request one completed message.
 *
 * This module depends on the *narrowest* slice of the client it needs
 * ({@link AiClient}), so it composes with the real client in production and a
 * plain object in tests. Everything here is pure request/response shaping; no
 * env access, no globals.
 */
/**
 * The headless-client factory from `@hanzo/ai`. Declared as the exact contract
 * this wrapper needs, then resolved from the module by name — so we stay bound
 * to the documented API surface, not to the package's full (React-heavy) type
 * exports, and this module builds regardless of unrelated churn in `@hanzo/ai`.
 */
type CreateAiClient = (opts: { apiKey: string; baseURL?: string }) => unknown;

/**
 * Resolve `createAiClient` lazily. `@hanzo/ai` is loaded only when a live client
 * is actually built (`makeClient`), never at import time — so the pure
 * request/response helpers (`complete`, `listModels`) carry no dependency on it
 * and stay unit-testable with a plain stub.
 */
function resolveFactory(): CreateAiClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@hanzo/ai') as Record<string, unknown>;
  const factory = mod.createAiClient;
  if (typeof factory !== 'function') {
    throw new Error(
      "@hanzo/ai does not export 'createAiClient'. Install a version of " +
        '@hanzo/ai that provides the headless client.',
    );
  }
  return factory as CreateAiClient;
}

/** A chat message in the OpenAI-compatible shape the client expects. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The request we send for a single non-streaming completion. */
export interface CompletionRequest {
  /** Model id, e.g. `zen-eco-3b`. */
  model: string;
  /** Conversation so far. */
  messages: ChatMessage[];
  /** Sampling temperature. Omitted when undefined. */
  temperature?: number;
  /** Hard cap on generated tokens. Omitted when undefined. */
  maxTokens?: number;
}

/** The minimal completion response we read: the first choice's message text. */
export interface CompletionChoiceMessage {
  content?: string | null;
}
export interface CompletionChoice {
  message?: CompletionChoiceMessage;
}
export interface CompletionResponse {
  choices?: CompletionChoice[];
}

/** A model entry from the catalog. */
export interface ModelEntry {
  id: string;
}
export interface ModelList {
  data?: ModelEntry[];
}

/**
 * The exact slice of `@hanzo/ai`'s client this wrapper uses. Declaring it here
 * (rather than importing the client's full type) keeps the wrapper decoupled
 * and lets tests pass a hand-built stub.
 */
export interface AiClient {
  chat: {
    completions: {
      create(req: {
        model: string;
        messages: ChatMessage[];
        temperature?: number;
        max_tokens?: number;
      }): Promise<CompletionResponse>;
    };
  };
  models: {
    list(): Promise<ModelList>;
  };
}

/** Options for {@link makeClient}. */
export interface ClientOptions {
  /** Hanzo API key (bearer token). */
  apiKey: string;
  /** Override base URL. Defaults to `@hanzo/ai`'s api.hanzo.ai. */
  baseUrl?: string;
}

/**
 * Build a Hanzo AI client bound to an API key. Delegates to `@hanzo/ai`, which
 * targets `https://api.hanzo.ai` and the `/v1/...` routes by default.
 */
export function makeClient(opts: ClientOptions): AiClient {
  const createAiClient = resolveFactory();
  return createAiClient({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
  }) as AiClient;
}

/**
 * Run one non-streaming completion and return the assistant text.
 *
 * Throws when the model returns no choices — an empty answer is a failure the
 * caller must surface, not a silent empty card.
 */
export async function complete(
  client: AiClient,
  req: CompletionRequest,
): Promise<string> {
  const res = await client.chat.completions.create({
    model: req.model,
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  });
  const text = res.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Hanzo AI returned an empty completion.');
  }
  return text;
}

/**
 * List available model ids from the catalog. Returns `[]` when the catalog is
 * empty or shaped unexpectedly — the caller falls back to the configured list.
 */
export async function listModels(client: AiClient): Promise<string[]> {
  const res = await client.models.list();
  const data = res.data;
  if (!Array.isArray(data)) return [];
  return data.map((m) => m.id).filter((id): id is string => typeof id === 'string');
}
