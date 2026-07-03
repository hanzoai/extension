// The Hanzo chat call and its request/response shaping — pure, host-agnostic,
// and fully unit-testable (no Office.js, no DOM). taskpane.ts is the thin glue
// that reads the document via Office.js and hands the text here.

import { chatCompletionsURL, modelsURL, DEFAULT_MODEL } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// buildMessages turns a task (the user's instruction) plus the document
// selection into the OpenAI-compatible message list. An empty selection is a
// pure generation ("draft a NDA clause about X"); a non-empty selection is an
// operation ON the text ("rewrite this formally"), and the selection is fenced
// so the model treats it as data, not instructions.
export function buildMessages(task: string, selection: string): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content:
      'You are Hanzo AI inside a Microsoft Office document. Return ONLY the text to ' +
      'insert into the document — no preamble, no markdown fences, no "Here is". ' +
      'Match the document\'s tone. When given a selection, operate on it directly.',
  };
  const trimmed = selection.trim();
  const user: ChatMessage = {
    role: 'user',
    content: trimmed
      ? `${task}\n\n---- selected text ----\n${selection}`
      : task,
  };
  return [system, user];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  /** Request an SSE stream. Defaults to false (one-shot completion). */
  stream?: boolean;
  signal?: AbortSignal;
}

// requestBody is the exact JSON the gateway receives. Separated so a test can
// assert the wire shape (model default, stream flag, messages) without a
// network call. `stream` defaults to false — the one-shot `ask` contract.
export function requestBody(messages: ChatMessage[], opts: ChatOptions = {}): Record<string, unknown> {
  return {
    model: opts.model || DEFAULT_MODEL,
    messages,
    stream: opts.stream === true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
}

// extractContent pulls the assistant text out of an OpenAI-compatible
// completion response, tolerating the shapes the gateway returns (choices with
// message.content, or a bare content). Throws on an error payload so the pane
// surfaces the real gateway message.
export function extractContent(data: any): string {
  if (data && data.error) {
    const msg = typeof data.error === 'string' ? data.error : data.error.message || 'unknown error';
    throw new Error(`Hanzo API error: ${msg}`);
  }
  const choice = data?.choices?.[0];
  const content =
    choice?.message?.content ??
    choice?.text ??
    data?.content ??
    '';
  if (typeof content !== 'string' || content === '') {
    throw new Error('Hanzo API returned no content');
  }
  return content;
}

// ask runs one non-streaming completion and returns the text to insert. token
// may be empty (the gateway serves anonymous/limited models); when present it
// is the IAM bearer.
export async function ask(
  task: string,
  selection: string,
  token: string,
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, selection), opts)),
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
    // Prefer the structured error message; fall back to status.
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
// as it arrives, and resolves with the full concatenated text. Same inputs as
// `ask`; use it for a live-typing pane. Falls back to a thrown error on non-2xx.
export async function askStream(
  task: string,
  selection: string,
  token: string,
  onDelta: (text: string) => void,
  opts: ChatOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(chatCompletionsURL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody(buildMessages(task, selection), { ...opts, stream: true })),
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
