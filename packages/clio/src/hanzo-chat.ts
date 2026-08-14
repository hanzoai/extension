// The Hanzo chat call and its request/response shaping — pure, host-agnostic,
// unit-testable (no DOM, no Clio). Mirrors @hanzo/office-addin's chat.ts wire
// contract exactly (same api.hanzo.ai/v1 gateway, same OpenAI-compatible
// shapes) so there is ONE chat contract across every Hanzo surface. The only
// difference is the system prompt: here Hanzo is a legal assistant working over
// a Clio matter, not an in-document editor.

import { chatCompletionsURL, modelsURL, DEFAULT_MODEL } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The system prompt that frames Hanzo as a lawyer's assistant over a matter.
// Kept as a constant so actions.ts composes it with a task + matter context.
export const LEGAL_SYSTEM_PROMPT =
  'You are Hanzo AI assisting a lawyer inside their Clio practice-management ' +
  'system. You are given a matter and, where relevant, excerpts of its ' +
  'documents. Be precise, cite the parties, dates, defined terms and ' +
  'obligations from the provided context, and never invent facts not present ' +
  'in it. Return clean prose ready to save as a note or send — no markdown ' +
  'fences, no "Here is", no preamble. This is drafting assistance, not legal ' +
  'advice, and the lawyer reviews everything before it is used.';

// buildMessages composes the system frame, the matter context (as fenced data),
// and the task instruction. context is fenced so the model treats a matter's
// documents as data, never as instructions (prompt-injection boundary).
export function buildMessages(task: string, context: string, systemPrompt = LEGAL_SYSTEM_PROMPT): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: systemPrompt };
  const trimmed = context.trim();
  const user: ChatMessage = {
    role: 'user',
    content: trimmed ? `${task}\n\n---- matter context ----\n${trimmed}` : task,
  };
  return [system, user];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  system?: string;
}

// requestBody is the exact JSON the gateway receives. Separated so a test can
// assert the wire shape without a network call. `stream` defaults to false.
export function requestBody(messages: ChatMessage[], opts: ChatOptions = {}): Record<string, unknown> {
  return {
    model: opts.model || DEFAULT_MODEL,
    messages,
    stream: opts.stream === true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
}

// extractContent pulls the assistant text out of an OpenAI-compatible response,
// tolerating the shapes the gateway returns. Throws on an error payload.
export function extractContent(data: any): string {
  if (data && data.error) {
    const msg = typeof data.error === 'string' ? data.error : data.error.message || 'unknown error';
    throw new Error(`Hanzo API error: ${msg}`);
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? data?.content ?? '';
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// ask runs one non-streaming completion and returns the text. token may be
// empty (anonymous/limited); when present it is the Hanzo bearer (sk- key or
// IAM OAuth token).
export async function ask(task: string, context: string, token: string, opts: ChatOptions = {}): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, context, opts.system), opts)),
    signal: opts.signal,
  });
  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Hanzo API ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    try {
      return extractContent(data);
    } catch {
      const m = data?.error?.message || data?.error || `HTTP ${resp.status}`;
      throw new Error(`Hanzo API ${resp.status}: ${m}`);
    }
  }
  return extractContent(data);
}

// streamDelta pulls the incremental text out of one OpenAI-compatible SSE frame.
export function streamDelta(payload: string): string {
  const json = JSON.parse(payload);
  return json?.choices?.[0]?.delta?.content ?? '';
}

// askStream streams a completion, invoking onDelta per chunk, resolving with the
// full text. Same inputs as `ask`; used for the live-typing pane.
export async function askStream(
  task: string,
  context: string,
  token: string,
  onDelta: (text: string) => void,
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, context, opts.system), { ...opts, stream: true })),
    signal: opts.signal,
  });
  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Hanzo API ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const delta = streamDelta(payload);
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // partial SSE frame — wait for the next chunk
      }
    }
  }
  return full;
}

// listModels returns the model ids the caller may route to, from /v1/models.
export async function listModels(token: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(modelsURL(), { headers });
  if (!resp.ok) throw new Error(`Hanzo API ${resp.status}: model list failed`);
  const data: any = await resp.json();
  const items = data?.data ?? data?.models ?? (Array.isArray(data) ? data : []);
  return items
    .map((m: any) => (typeof m === 'string' ? m : m?.id))
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
}
