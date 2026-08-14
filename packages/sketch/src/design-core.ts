// The Hanzo AI design-action catalog — the SAME actions the @hanzo/figma and
// @hanzo/canva adapters run, expressed once as PURE functions over the
// published @hanzo/ai contract. A design action = build a task prompt + a
// selection context, ask Hanzo through createAiClient, and (for the write
// actions) parse the response into text/layer edits the host writes back.
//
// Everything here is pure and unit-tested. The two async edges — reading the
// Sketch selection (sketch/dom) and writing results back (layer.text = …) —
// live in sketch-bridge.cjs and the WebView; they call into this core so the
// prompt shaping, context assembly/truncation, and response parsing are
// testable without a Sketch runtime or a network.

import {
  createAiClient,
  type AiClient,
  type ChatCompletion,
  type ChatCompletionMessage,
} from '@hanzo/ai';

// ── Gateway defaults ─────────────────────────────────────────────────────────

/** The Hanzo model gateway. @hanzo/ai defaults here too; never an `/api/` prefix. */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when the user has not picked one. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

// ── Selection context (pure) ─────────────────────────────────────────────────

/**
 * One text-bearing layer as this adapter consumes it: the layer's id (so a
 * write-back targets the exact layer), its name, and its text. sketch-bridge.cjs
 * extracts these from `document.selectedLayers` (Text layers → `.text`); the
 * core never touches sketch/dom.
 */
export interface TextLayer {
  id: string;
  name: string;
  text: string;
}

/**
 * The design selection handed to an action: the text layers plus a coarse count
 * of everything selected (so "critique" can note non-text layers — shapes,
 * groups, symbols — without their pixels).
 */
export interface Selection {
  layers: TextLayer[];
  /** Total selected layers, including non-text ones. */
  totalCount: number;
}

// The model's context window is finite; a design file's copy can be large. Cap
// the assembled context so a big selection never blows the request. Sized to
// sit comfortably in a modern context window alongside the response.
export const MAX_CONTEXT_CHARS = 24_000;

// truncate cuts text to a max length, appending a visible marker so the model
// (and the reviewing user) know content was elided. Pure.
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

/**
 * assembleContext renders a Selection into the single string handed to Hanzo:
 * each text layer as a `[n] "Name": text` line so the model can refer back to a
 * layer by index and name. Non-text layers are summarized as a trailing count.
 * The whole thing is capped at maxChars (layers first, so leading copy survives
 * truncation). Pure — unit-tested.
 */
export function assembleContext(sel: Selection, maxChars = MAX_CONTEXT_CHARS): string {
  const lines = sel.layers.map(
    (l, i) => `[${i + 1}] ${l.name ? `"${l.name}"` : '(unnamed)'}: ${l.text}`,
  );
  const nonText = sel.totalCount - sel.layers.length;
  if (nonText > 0) {
    lines.push(
      `(+ ${nonText} non-text layer${nonText === 1 ? '' : 's'} selected: shapes/groups/symbols)`,
    );
  }
  return truncate(lines.join('\n'), maxChars);
}

// ── System frame + message shaping (pure) ────────────────────────────────────

export const SYSTEM_PROMPT =
  'You are Hanzo AI working inside Sketch, a macOS design tool used by agencies ' +
  'and product teams. You are given the text content of a design selection (its ' +
  'layers) and a task. Work only from the provided content — never invent facts ' +
  'not present in it. Write like a senior product designer and copywriter: ' +
  'concise, concrete, on-brand. Return clean text with no preamble, no ' +
  '"Here is", and no code fences unless the task explicitly asks for structured ' +
  'output.';

/**
 * buildMessages composes the system frame + the selection context (fenced as
 * data, so the model treats layer copy as data not instructions — a
 * prompt-injection boundary) + the task instruction. Pure — unit-tested.
 */
export function buildMessages(task: string, context: string): ChatCompletionMessage[] {
  const trimmed = context.trim();
  const user: ChatCompletionMessage = {
    role: 'user',
    content: trimmed
      ? `${task}\n\n---- design selection ----\n${trimmed}\n---- end ----`
      : task,
  };
  return [{ role: 'system', content: SYSTEM_PROMPT }, user];
}

// ── The design action catalog (pure task strings) ────────────────────────────

/**
 * The five design actions, mirroring the Figma/Canva action set:
 *  - critique   → summarize + critique the selection (UX/copy/hierarchy)
 *  - rewrite    → rewrite the selected text (per an optional instruction)
 *  - translate  → translate the text layers into a target language
 *  - contentfill→ generate realistic placeholder copy for the layers
 *  - ask        → free-form question about the selection
 */
export type ActionId = 'critique' | 'rewrite' | 'translate' | 'contentfill' | 'ask';

/** The stable list of actions, in menu order — the single source for both the
 * manifest commands and the WebView UI. */
export const ACTIONS: ActionId[] = ['critique', 'rewrite', 'translate', 'contentfill', 'ask'];

/** Whether an action rewrites the per-layer text (vs. returning a single note).
 * `rewrite`, `translate`, and `contentfill` produce one replacement string per
 * input layer; `critique` and `ask` return a single prose note. Pure. */
export function isPerLayer(id: ActionId): boolean {
  return id === 'rewrite' || id === 'translate' || id === 'contentfill';
}

// A shared instruction appended to per-layer actions: return the results as a
// JSON array of strings, positionally aligned to the input layers, so the host
// can map result[i] → layers[i].text. Kept in ONE place (DRY) since three
// actions share it.
const PER_LAYER_JSON_RULE =
  'Return ONLY a JSON array of strings — one element per numbered layer above, ' +
  'in the same order. Element i is the new text for layer [i+1]. Preserve a ' +
  'layer exactly (echo its text) when it should not change. No prose, no code ' +
  'fences — just the JSON array.';

/**
 * actionTask maps an action id (+ optional user detail) to its task instruction.
 * `rewrite`/`translate`/`ask` take a user detail (the instruction / target
 * language / question); `critique` and `contentfill` are fixed. Pure.
 */
export function actionTask(id: ActionId, detail = ''): string {
  const d = detail.trim();
  switch (id) {
    case 'critique':
      return (
        'Critique this design selection. Cover copy clarity, visual/information ' +
        'hierarchy, tone, and consistency. Lead with a one-sentence overall ' +
        'take, then a short bullet list of the highest-leverage improvements. ' +
        'Be specific and reference layers by their name or number. No preamble.'
      );
    case 'rewrite':
      return (
        (d
          ? `Rewrite each layer's text so that: ${d}.`
          : 'Rewrite each layer\'s text to be clearer, tighter, and more ' +
            'compelling while preserving its meaning and role.') +
        ` ${PER_LAYER_JSON_RULE}`
      );
    case 'translate':
      return (
        `Translate each layer's text into ${d || 'Spanish'}. Keep the tone, ` +
        'keep product/brand names untranslated, and match string length where ' +
        `UI space is tight. ${PER_LAYER_JSON_RULE}`
      );
    case 'contentfill':
      return (
        'Replace each layer\'s text with realistic, on-brand placeholder copy ' +
        'that fits its apparent role (heading, body, label, button) and roughly ' +
        `its current length. ${PER_LAYER_JSON_RULE}`
      );
    case 'ask':
      return d || 'What is this selection communicating, and what would you improve?';
  }
}

// ── @hanzo/ai request shaping + running an action ────────────────────────────

/**
 * Extract assistant text from a @hanzo/ai ChatCompletion. The published client
 * types `content` as `string | ChatCompletionContentPart[]`; we join text parts
 * and ignore images (a design critique response is text). Throws on empty
 * content so the caller surfaces a real gateway failure. Pure — unit-tested.
 */
export function extractContent(res: ChatCompletion): string {
  const content = res?.choices?.[0]?.message?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((p): p is { type: 'text'; text: string } => p?.type === 'text')
      .map((p) => p.text)
      .join('');
  }
  if (text.trim() === '') throw new Error('Hanzo API returned no content');
  return text;
}

export interface RunActionParams {
  id: ActionId;
  /** rewrite instruction / target language / question. */
  detail?: string;
  selection: Selection;
  /** An `sk-…` Hanzo API key or IAM access token. */
  hanzoToken: string;
  model?: string;
  baseUrl?: string;
  /** Injected in tests. */
  client?: AiClient;
  signal?: AbortSignal;
}

/**
 * runAction assembles the context, forms the task, and asks Hanzo through the
 * published createAiClient contract. Returns the RAW model text: for `critique`/
 * `ask` that is a prose note; for `rewrite`/`translate`/`contentfill` it is the
 * JSON array the caller parses (parseLayerEdits) into per-layer replacements.
 * Writing back is a separate explicit step so the user reviews before it lands.
 * This is the SINGLE path from the adapter to the model.
 */
export async function runAction(p: RunActionParams): Promise<string> {
  const client =
    p.client ??
    createAiClient({ token: p.hanzoToken, baseUrl: p.baseUrl ?? HANZO_API_BASE_URL });
  const context = assembleContext(p.selection);
  const task = actionTask(p.id, p.detail);
  const params = {
    model: p.model || DEFAULT_MODEL,
    messages: buildMessages(task, context),
    stream: false as const,
  };
  // Pass the options object only when there's a signal — an empty options bag is
  // noise on the wire and in the call trace.
  const res = p.signal
    ? await client.chat.completions.create(params, { signal: p.signal })
    : await client.chat.completions.create(params);
  return extractContent(res);
}

// ── Response parsing (pure) ──────────────────────────────────────────────────

/**
 * A single per-layer edit: which layer (by id) gets which new text. The host
 * applies these as `layer.text = edit.text`. `id` is carried through from the
 * input Selection so the write-back is unambiguous even if the model reorders.
 */
export interface LayerEdit {
  id: string;
  name: string;
  text: string;
}

/**
 * parseLayerEdits turns a per-layer action's JSON-array output into LayerEdit[],
 * positionally aligned to the input layers. It tolerates a stray ```json fence
 * or surrounding prose by extracting the first `[ … ]` span, coerces each
 * element to a string, and pairs result[i] with layers[i]. Extra results are
 * dropped; missing ones leave that layer untouched (not in the output). Throws
 * only when no array is present at all, so the caller surfaces a real failure
 * rather than silently writing nothing. Pure — unit-tested.
 */
export function parseLayerEdits(raw: string, layers: TextLayer[]): LayerEdit[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No layer-edit array found in model output');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('Model output was not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('Model output was not a JSON array');

  const edits: LayerEdit[] = [];
  const n = Math.min(parsed.length, layers.length);
  for (let i = 0; i < n; i++) {
    const el = parsed[i];
    const text = typeof el === 'string' ? el : el == null ? '' : String(el);
    edits.push({ id: layers[i].id, name: layers[i].name, text });
  }
  return edits;
}

/**
 * A note produced by a non-per-layer action — a heading + the model's prose.
 * The host inserts this as a new text layer next to the selection so the
 * critique/answer is visible on the canvas.
 */
export interface ResultNote {
  heading: string;
  body: string;
}

/** noteHeading — a concise, action-labelled heading for an inserted note layer. */
export function noteHeading(id: ActionId): string {
  const label: Record<ActionId, string> = {
    critique: 'Critique',
    rewrite: 'Rewrite',
    translate: 'Translation',
    contentfill: 'Content',
    ask: 'Answer',
  };
  return `Hanzo AI — ${label[id]}`;
}

/**
 * resultNote builds the ResultNote for a prose action (`critique`/`ask`): a
 * labelled heading plus the trimmed body. Pure — unit-tested.
 */
export function resultNote(id: ActionId, body: string): ResultNote {
  return { heading: noteHeading(id), body: body.trim() };
}
