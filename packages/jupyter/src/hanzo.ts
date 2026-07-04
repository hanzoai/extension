// Thin layer over the published @hanzo/ai headless client plus the pure action
// catalog. The extension talks to the model gateway through ONE shape:
//
//   const client = createHanzoClient(settings);
//   const text = await runAction('explain', { cell }, client, settings);
//   for await (const chunk of streamChat(messages, client, settings)) { … }
//
// The prompt builders (buildMessages, actionMessages) and the request-shaping
// (completionParams) are PURE and unit-tested. The two async edges are the
// model calls (chat.completions.create), delegated to @hanzo/ai — never raw
// fetch. Defaults to https://api.hanzo.ai and /v1/... (never /api/).

import {
  createAiClient,
  type AiClient,
  type ChatCompletionMessage,
  type ChatCompletionCreateParams,
} from '@hanzo/ai';
import { HANZO_API_BASE_URL, type HanzoSettings } from './config';
import {
  cellContext,
  notebookContext,
  truncate,
  MAX_CONTEXT_CHARS,
  type CellData,
  type NotebookData,
} from './notebook';

/** The OpenAI-compatible message shape @hanzo/ai consumes. Re-exported so
 * call sites do not import from the SDK directly. */
export type ChatMessage = ChatCompletionMessage;

/**
 * createHanzoClient builds the @hanzo/ai client from resolved settings. The
 * `hk-` key (or empty for anonymous) becomes the bearer token; the base URL
 * defaults to api.hanzo.ai. This is the SINGLE place the SDK client is
 * constructed. `fetchImpl` is injectable for tests.
 */
export function createHanzoClient(
  settings: Pick<HanzoSettings, 'apiKey' | 'baseUrl'>,
  fetchImpl?: typeof fetch,
): AiClient {
  return createAiClient({
    baseUrl: settings.baseUrl || HANZO_API_BASE_URL,
    token: settings.apiKey || undefined,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

// ── System frame + message shaping (pure) ────────────────────────────────────

export const SYSTEM_PROMPT =
  'You are Hanzo AI, a data-science pair programmer embedded in a JupyterLab ' +
  'notebook. You are given notebook cells (Python source, and sometimes their ' +
  'outputs or error tracebacks) and a task. Work only from the provided ' +
  'content — never invent APIs, columns, or variables not present in it. When ' +
  'asked for code, return ONLY runnable Python with no prose and no code ' +
  'fences. When asked for an explanation, return clean prose with no preamble ' +
  'and no "Here is".';

/**
 * buildMessages composes the system frame + a fenced context block (data, so
 * the model treats notebook content as data not instructions — a prompt-
 * injection boundary) + the task. When context is empty (a bare "generate from
 * prompt" with no cell), the task stands alone. Pure — unit-tested.
 */
export function buildMessages(task: string, context: string): ChatMessage[] {
  const trimmed = context.trim();
  const user: ChatMessage = {
    role: 'user',
    content: trimmed
      ? `${task}\n\n---- notebook context ----\n${trimmed}\n---- end ----`
      : task,
  };
  return [{ role: 'system', content: SYSTEM_PROMPT }, user];
}

// ── The action catalog (pure) ────────────────────────────────────────────────

/**
 * The five cell actions. `generate` produces a new cell from a prompt (no
 * source cell required); the other four operate on the active cell.
 */
export type ActionId =
  | 'explain'
  | 'fix'
  | 'document'
  | 'optimize'
  | 'generate';

/** Whether an action returns code (inserted as a cell) or prose (shown to read). */
export function actionReturnsCode(id: ActionId): boolean {
  return id === 'fix' || id === 'document' || id === 'optimize' || id === 'generate';
}

/** Whether an action needs the cell's error output (only the fix action does). */
export function actionNeedsOutputs(id: ActionId): boolean {
  return id === 'fix';
}

/**
 * actionTask maps an action id (+ optional user detail) to its task
 * instruction. `generate` takes the user's prompt as detail; the rest are fixed
 * task strings that operate on the supplied cell context. Pure — unit-tested.
 */
export function actionTask(id: ActionId, detail = ''): string {
  switch (id) {
    case 'explain':
      return (
        'Explain what this cell does, step by step, in clear prose for a data ' +
        'scientist. Note any non-obvious behavior, assumptions, or side effects. ' +
        'No preamble.'
      );
    case 'fix':
      return (
        'This cell raised the error shown below its source. Diagnose the root ' +
        'cause and return a CORRECTED version of the cell. Return ONLY the fixed ' +
        'Python source — no explanation, no prose, no code fences. Keep the ' +
        "cell's intent; change only what is needed to make it run correctly."
      );
    case 'document':
      return (
        'Add a concise docstring and inline comments to this code. Preserve the ' +
        'code exactly — only add documentation. Return ONLY the full documented ' +
        'Python source, no prose, no code fences.'
      );
    case 'optimize':
      return (
        'Rewrite this cell to be faster and more idiomatic (vectorize where it ' +
        'helps, remove redundant work) WITHOUT changing its observable behavior ' +
        'or outputs. Return ONLY the optimized Python source, no prose, no code ' +
        'fences.'
      );
    case 'generate':
      return detail.trim()
        ? `Write a single Python notebook cell that does the following: ${detail.trim()}. ` +
            'Return ONLY the Python source, no prose, no code fences.'
        : 'Write a single useful Python notebook cell that continues this ' +
            'notebook. Return ONLY the Python source, no prose, no code fences.';
  }
}

/**
 * actionMessages builds the full message array for a cell action: the task for
 * the id, plus the cell rendered to context (with outputs when the action needs
 * them — only `fix` does). `generate` with no cell yields task-only messages.
 * Pure — unit-tested.
 */
export function actionMessages(
  id: ActionId,
  cell: CellData | undefined,
  detail = '',
): ChatMessage[] {
  const task = actionTask(id, detail);
  const context = cell
    ? cellContext(cell, { includeOutputs: actionNeedsOutputs(id) })
    : '';
  return buildMessages(task, truncate(context, MAX_CONTEXT_CHARS));
}

/**
 * chatMessages builds the message array for the free-form side-panel chat: the
 * user's prompt, plus an optional notebook/cell context block the user chose to
 * attach ('cell', 'selection', 'notebook', or 'none'). Pure — unit-tested.
 */
export function chatMessages(prompt: string, context = ''): ChatMessage[] {
  return buildMessages(prompt, truncate(context, MAX_CONTEXT_CHARS));
}

// ── Request shaping (pure) ────────────────────────────────────────────────────

/**
 * completionParams shapes the exact body handed to
 * `client.chat.completions.create`. Centralizing it keeps model/stream/
 * temperature consistent across every call and makes the wire shape testable.
 * The `stream` literal is preserved in the type (generic over S) so the SDK's
 * discriminated create() overload resolves to the right return shape.
 * Pure — unit-tested.
 */
export function completionParams<S extends boolean>(
  messages: ChatMessage[],
  model: string,
  stream: S,
): ChatCompletionCreateParams & { stream: S } {
  return { model, messages, stream, temperature: 0.2 };
}

// ── The two async model edges ─────────────────────────────────────────────────

/**
 * extractContent pulls the assistant text out of a non-streaming completion,
 * throwing on an empty/malformed response so the caller surfaces a real error
 * rather than inserting a blank cell. Pure — unit-tested.
 */
export function extractContent(res: {
  choices?: Array<{ message?: { content?: string | unknown } }>;
}): string {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Hanzo AI returned no content');
  }
  return content;
}

/**
 * runAction runs one cell action end to end: build messages, call the model
 * (non-streaming — a cell action inserts/shows a final result, not a stream),
 * and return the assistant text. The SINGLE path from an action to the model.
 */
export async function runAction(
  id: ActionId,
  args: { cell?: CellData; detail?: string },
  client: AiClient,
  settings: Pick<HanzoSettings, 'model'>,
  signal?: AbortSignal,
): Promise<string> {
  const messages = actionMessages(id, args.cell, args.detail);
  const res = await client.chat.completions.create(
    completionParams(messages, settings.model, false),
    { signal },
  );
  return extractContent(res);
}

/**
 * streamChat streams a free-form chat completion, yielding text deltas as they
 * arrive so the side panel renders progressively. Delegates the SSE decoding to
 * @hanzo/ai's streaming generator; this just projects each chunk to its text
 * delta and drops empties.
 */
export async function* streamChat(
  messages: ChatMessage[],
  client: AiClient,
  settings: Pick<HanzoSettings, 'model'>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const stream = await client.chat.completions.create(
    completionParams(messages, settings.model, true),
    { signal },
  );
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) yield delta;
  }
}

/** Re-export the pure notebook context builder for panel context modes. */
export { cellContext, notebookContext };
export type { CellData, NotebookData };
