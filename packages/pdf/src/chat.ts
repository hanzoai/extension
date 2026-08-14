// The Hanzo chat call and its request/response shaping — pure, DOM-free, fully
// unit-testable (no pdf.js, no browser). app.ts is the thin glue that extracts
// the PDF text via pdf-view.ts and hands the windowed context here. The wire
// contract (endpoints, request body, SSE parse) is identical to
// @hanzo/office-addin so both surfaces speak to the gateway the same way; only
// the system prompt and message assembly differ (analysis over a document,
// vs. drafting edits into one).

import { chatCompletionsURL, modelsURL, DEFAULT_MODEL } from './config.js';
import type { DocumentContext } from './config.js';
import { contextNote } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The analyst persona: Hanzo reading a PDF (a filing, a contract, a discovery
// document) for a legal professional. Grounded, cites page numbers, never
// invents facts not in the provided text. This is the one place the PDF surface
// diverges from office's "return only the text to insert" drafting persona.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, a careful legal-document analyst reading a PDF for a ' +
  'professional (a lawyer reviewing filings, discovery, or executed contracts). ' +
  'Answer ONLY from the document text provided — if the answer is not in the ' +
  'text, say so plainly rather than guessing. Cite the page number (e.g. "(p. 3)") ' +
  'for every fact, date, party, or clause you rely on. Be precise and concise; ' +
  'this is not legal advice, and note where a human lawyer should verify.';

// buildMessages assembles the OpenAI-compatible message list from the user's
// task, the windowed document context, and an optional user-highlighted
// selection. The document text is fenced and preceded by the honest context note
// so the model knows its scope; a selection, when present, is called out as the
// specific passage the task is about. All document text is data, never
// instructions.
export function buildMessages(
  task: string,
  ctx: DocumentContext,
  selection: string = '',
): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };

  const parts: string[] = [contextNote(ctx)];
  const sel = selection.trim();
  if (sel) {
    parts.push(`\n---- highlighted selection ----\n${sel}`);
  }
  if (ctx.text) {
    parts.push(`\n---- document text ----\n${ctx.text}`);
  }
  parts.push(`\n---- task ----\n${task}`);

  return [system, { role: 'user', content: parts.join('\n') }];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  /** Request an SSE stream. Defaults to false (one-shot completion). */
  stream?: boolean;
  signal?: AbortSignal;
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
// tolerating the shapes the gateway returns. Throws on an error payload so the
// panel surfaces the real gateway message.
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

// ask runs one non-streaming completion and returns the answer. token may be
// empty (the gateway serves anonymous/limited models); when present it is the
// bearer (an `sk-` key or an IAM access token).
export async function ask(
  task: string,
  ctx: DocumentContext,
  token: string,
  selection: string = '',
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, ctx, selection), opts)),
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

// streamDelta pulls the incremental text out of one OpenAI-compatible SSE frame
// payload (the JSON after `data: `). Pure, so the SSE parse is unit-testable.
export function streamDelta(payload: string): string {
  const json = JSON.parse(payload);
  return json?.choices?.[0]?.delta?.content ?? '';
}

// askStream runs a streaming completion, invoking onDelta with each text chunk
// as it arrives, and resolves with the full concatenated text.
export async function askStream(
  task: string,
  ctx: DocumentContext,
  token: string,
  onDelta: (text: string) => void,
  selection: string = '',
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, ctx, selection), { ...opts, stream: true })),
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
// The endpoint is org-scoped by the bearer; an empty token lists public models.
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
