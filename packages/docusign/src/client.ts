/**
 * Headless OpenAI-compatible Hanzo client — the `createAiClient` contract.
 *
 * The app talks to the model gateway through ONE shape:
 *
 * ```ts
 * const ai = createAiClient({ token });
 * const res = await ai.chat.completions.create({ model, messages });
 * const models = await ai.models.list();
 * ```
 *
 * Defaults to `https://api.hanzo.ai` and `/v1/...`. Non-streaming: the DocuSign
 * panel renders the FINAL text, and the webhook stores a finished summary — no
 * surface streams. Pure over `fetch` (injectable), so request shaping and
 * response parsing are unit-testable without a network.
 *
 * This mirrors the `@hanzo/ai` headless-client surface so the rest of the app is
 * written against the client interface, not against raw `fetch`. Swapping in the
 * published `@hanzo/ai` `createAiClient` is a one-import change — the call sites
 * do not move. (The npm `@hanzo/ai@latest` is currently the React UI, not the
 * headless client, so we ship this thin implementation of the exact contract,
 * identical to @hanzo/slack and @hanzo/teams.)
 */

import { HANZO_API_BASE_URL } from './config.js';

/** A single chat message in the OpenAI-compatible schema. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Parameters for a chat completion. `model` and `messages` are required. */
export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  /** Sampling temperature. Omitted from the wire body when undefined. */
  temperature?: number;
  /** Hard cap on generated tokens. Omitted when undefined. */
  max_tokens?: number;
  /** Abort the request. */
  signal?: AbortSignal;
}

/** OpenAI-compatible completion response (only the fields we read). */
export interface ChatCompletion {
  id?: string;
  model?: string;
  choices: Array<{
    index?: number;
    message?: { role: string; content: string };
    text?: string;
    finish_reason?: string;
  }>;
}

/** A model entry from `/v1/models`. */
export interface ModelInfo {
  id: string;
  /** Friendly display name when the gateway provides one. */
  fullName?: string;
  owned_by?: string;
}

/** Options for {@link createAiClient}. */
export interface AiClientOptions {
  /**
   * Bearer credential: an `sk-…` Hanzo API key or an IAM access token. Empty
   * means anonymous — the gateway serves its public/limited models.
   */
  token?: string;
  /** Gateway base URL. Defaults to `https://api.hanzo.ai`. */
  baseURL?: string;
  /** Injected fetch (tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

/** The headless client surface. */
export interface AiClient {
  chat: {
    completions: {
      create(params: ChatCompletionParams): Promise<ChatCompletion>;
    };
  };
  models: {
    list(signal?: AbortSignal): Promise<ModelInfo[]>;
  };
}

/** Build the JSON body sent to `/v1/chat/completions`. Pure — unit-tested. */
export function chatRequestBody(params: ChatCompletionParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: false,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
  return body;
}

/**
 * Extract assistant text from an OpenAI-compatible completion, tolerating the
 * shapes the gateway returns (choices[].message.content or choices[].text).
 * Throws on an error payload or empty content so callers surface the real
 * gateway message. Pure — unit-tested.
 */
export function extractContent(data: unknown): string {
  const d = data as {
    error?: unknown;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    content?: string;
  };
  if (d && d.error) {
    const e = d.error as { message?: string } | string;
    const msg = typeof e === 'string' ? e : e?.message || 'unknown error';
    throw new Error(`Hanzo API error: ${msg}`);
  }
  const choice = d?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? d?.content ?? '';
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

/**
 * Parse `/v1/models` into a {@link ModelInfo}[]. Reads the OpenAI-compatible
 * `data[]`, falling back to `models[]` or a bare array. Pure — unit-tested.
 */
export function parseModels(data: unknown): ModelInfo[] {
  const d = data as { data?: unknown[]; models?: unknown[] };
  const items: unknown[] = Array.isArray(d?.data)
    ? d.data
    : Array.isArray(d?.models)
      ? d.models
      : Array.isArray(data)
        ? (data as unknown[])
        : [];
  const out: ModelInfo[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push({ id: item });
      continue;
    }
    const m = item as { id?: unknown; fullName?: unknown; owned_by?: unknown };
    if (typeof m?.id === 'string' && m.id.length > 0) {
      out.push({
        id: m.id,
        fullName: typeof m.fullName === 'string' ? m.fullName : undefined,
        owned_by: typeof m.owned_by === 'string' ? m.owned_by : undefined,
      });
    }
  }
  return out;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Create a headless Hanzo AI client. Non-streaming completions + model listing
 * over the OpenAI-compatible `/v1` gateway.
 */
export function createAiClient(opts: AiClientOptions = {}): AiClient {
  const baseURL = (opts.baseURL ?? HANZO_API_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const token = opts.token;

  return {
    chat: {
      completions: {
        async create(params: ChatCompletionParams): Promise<ChatCompletion> {
          const resp = await doFetch(`${baseURL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
            body: JSON.stringify(chatRequestBody(params)),
            signal: params.signal,
          });
          const text = await resp.text();
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(`Hanzo API ${resp.status}: ${text.slice(0, 200)}`);
          }
          if (!resp.ok) {
            const err = (data as { error?: { message?: string } | string })?.error;
            const m =
              (typeof err === 'string' ? err : err?.message) || `HTTP ${resp.status}`;
            throw new Error(`Hanzo API ${resp.status}: ${m}`);
          }
          return data as ChatCompletion;
        },
      },
    },
    models: {
      async list(signal?: AbortSignal): Promise<ModelInfo[]> {
        const resp = await doFetch(`${baseURL}/v1/models`, {
          headers: authHeaders(token),
          signal,
        });
        if (!resp.ok) {
          throw new Error(`Hanzo API ${resp.status}: model list failed`);
        }
        return parseModels(await resp.json());
      },
    },
  };
}
