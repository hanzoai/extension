// design-core — the PURE, DOM-free, figma-free heart of Hanzo AI for Figma.
// Everything here is unit-testable without a browser or the `figma.*` API:
//
//   • the design-action CATALOG (system + user prompt builders per action),
//   • selection→context ASSEMBLY + budget truncation (SelectionSnapshot → text),
//   • response PARSING (variant-list splitting, JSON edit maps → TextEdit[]),
//   • @hanzo/ai REQUEST SHAPING (buildMessages) and the run funnels
//     (stream/complete) over an injectable AiClient.
//
// code.ts (main thread) is the thin glue that serializes the selection and
// applies the TextEdit[] this module produces; ui.ts (iframe) is the thin glue
// that renders and calls run/runStream. Sketch/Canva can mirror this catalog
// verbatim — the only Figma-specific concept that leaks in is SelectionSnapshot,
// which is itself just data. Composition over copies: every network call goes
// through the published @hanzo/ai headless client; this module never speaks raw
// HTTP to the gateway.

import {
  createAiClient,
  type AiClient,
  type ChatCompletionMessage,
  type ChatCompletionContentPart,
} from '@hanzo/ai';
import { API_BASE_URL, DEFAULT_MODEL, CONTEXT_CHAR_BUDGET } from './config.js';
import type { SelectionSnapshot, SerializedText, TextEdit } from './messaging.js';

// ---------------------------------------------------------------------------
// The design-AI action catalog.
// ---------------------------------------------------------------------------

/** How a given action's model output is applied to the document. This is what
 *  lets ONE run funnel serve every action: the panel dispatches on `apply`.
 *   - `rewrite`  : model returns a JSON id→text map; each text node is rewritten.
 *   - `rename`   : model returns a JSON id→name map; each layer is renamed.
 *   - `insert`   : model returns a variant LIST; the user inserts a chosen one.
 *   - `readonly` : model returns prose (critique / a11y); nothing is written. */
export type ApplyMode = 'rewrite' | 'rename' | 'insert' | 'readonly';

/** One design action: a stable id, the button label, whether it needs text
 *  nodes present, how its output is applied, and the two prompt builders. The
 *  builders are pure functions of (snapshot, userNote) so the catalog stays
 *  declarative and every prompt is unit-tested. */
export interface DesignAction {
  id: string;
  label: string;
  /** Short helper shown under the button. */
  hint: string;
  apply: ApplyMode;
  /** True when the action operates on TEXT nodes and needs at least one. */
  needsText: boolean;
  /** The persona/instruction system prompt for this action. */
  system: (snapshot: SelectionSnapshot) => string;
  /** The user turn: the honest context note + the fenced selection + the task.
   *  `note` is the freeform box (e.g. target language, brand voice, a question). */
  user: (snapshot: SelectionSnapshot, note: string) => string;
}

/** The base persona shared by every action, specialized per action below. */
const PERSONA =
  'You are Hanzo AI, a senior product designer and UX writer embedded in Figma. ' +
  'You are precise, on-brand, and never invent facts about the product that are ' +
  'not implied by the selection. Follow the output format EXACTLY — downstream ' +
  'code parses it verbatim.';

/** Instruction shared by the two write-back actions (rewrite, rename): return a
 *  strict JSON object mapping node id → new value, and NOTHING else. This is the
 *  contract parseEditMap depends on. */
function jsonMapInstruction(field: 'text' | 'name'): string {
  return (
    `Return ONLY a JSON object (no prose, no markdown fence) mapping each node ` +
    `id to its new ${field}. Include ONLY ids you are changing. Example: ` +
    `{"12:3":"New ${field}","12:4":"Another"}. Preserve any id you are not sure ` +
    `about by omitting it.`
  );
}

/** The catalog. Content/config, not logic — the one place actions are defined.
 *  Ordered as the panel shows them. */
export const ACTIONS = {
  rewrite: {
    id: 'rewrite',
    label: 'Improve copy',
    hint: 'Tighten & clarify the selected text layers.',
    apply: 'rewrite',
    needsText: true,
    system: () =>
      `${PERSONA} You rewrite UX copy to be clearer, tighter, and more useful ` +
      `without changing meaning or length dramatically. ${jsonMapInstruction('text')}`,
    user: (s, note) =>
      composeUser(s, note, 'Rewrite the copy of the text layers below.'),
  },

  translate: {
    id: 'translate',
    label: 'Translate',
    hint: 'Localize every text layer to a target language.',
    apply: 'rewrite',
    needsText: true,
    system: () =>
      `${PERSONA} You are an expert software localizer. Translate UX strings ` +
      `naturally for native speakers, keeping placeholders (like {name}, %s, ` +
      `\${x}) and punctuation intact, and keeping length UI-appropriate. ` +
      `${jsonMapInstruction('text')}`,
    user: (s, note) =>
      composeUser(
        s,
        note,
        `Translate the text layers below to the target language. Target language: ` +
          `${note.trim() || '(state the language in the note box)'}.`,
      ),
  },

  fill: {
    id: 'fill',
    label: 'Fill content',
    hint: 'Replace lorem/placeholder with realistic on-brand copy.',
    apply: 'rewrite',
    needsText: true,
    system: () =>
      `${PERSONA} You replace placeholder text (lorem ipsum, "Title", "Body ` +
      `text", dummy values) with realistic, on-brand copy that fits the layer's ` +
      `role and length. Leave real copy unchanged (omit its id). ` +
      `${jsonMapInstruction('text')}`,
    user: (s, note) =>
      composeUser(s, note, 'Fill in realistic copy for the placeholder text layers below.'),
  },

  rename: {
    id: 'rename',
    label: 'Rename layers',
    hint: 'Give selected layers sensible, consistent names.',
    apply: 'rename',
    needsText: false,
    system: () =>
      `${PERSONA} You name Figma layers the way a tidy designer would: short, ` +
      `descriptive, consistent casing, based on each node's role, type, and text. ` +
      `${jsonMapInstruction('name')}`,
    user: (s, note) =>
      composeUser(s, note, 'Propose better names for the layers below.'),
  },

  critique: {
    id: 'critique',
    label: 'Critique + a11y',
    hint: 'Plain-language design critique with accessibility notes.',
    apply: 'readonly',
    needsText: false,
    system: () =>
      `${PERSONA} You give a concise, plain-language design critique and ` +
      `accessibility review. Cover hierarchy, clarity, and consistency; then an ` +
      `ACCESSIBILITY section covering color-contrast risks (use the hex colors ` +
      `given), text clarity, and touch-target/legibility concerns. Reference ` +
      `WCAG AA where relevant. Be specific and actionable; no preamble.`,
    user: (s, note) =>
      composeUser(
        s,
        note,
        'Critique the selection below and list accessibility issues with fixes.',
      ),
  },

  variants: {
    id: 'variants',
    label: 'Variants',
    hint: 'Generate options (e.g. "3 headline options", "dark-mode copy").',
    apply: 'insert',
    needsText: false,
    system: () =>
      `${PERSONA} You generate distinct copy variants. Return each variant on its ` +
      `OWN line, numbered "1. ", "2. ", … and nothing else — no headers, no blank ` +
      `lines between them, no commentary.`,
    user: (s, note) =>
      composeUser(
        s,
        note,
        `Generate variants as requested: ${note.trim() || '3 options'}. ` +
          `Base them on the selection below.`,
      ),
  },
} as const satisfies Record<string, DesignAction>;

/** A known action id. */
export type ActionId = keyof typeof ACTIONS;

/** True when `id` names a known action. Boundary guard (own-property only, so
 *  prototype keys like `toString` cannot leak through). */
export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

/** Resolve an action id to its definition. Throws on unknown id. */
export function getAction(id: string): DesignAction {
  if (!isActionId(id)) throw new Error(`Unknown design action: ${id}`);
  return ACTIONS[id];
}

// ---------------------------------------------------------------------------
// Selection → context assembly + budget truncation (pure, deterministic).
// ---------------------------------------------------------------------------

/** The honest one-line scope note prepended to the selection context so the
 *  model (and, echoed in the panel, the user) knows exactly what it can see.
 *  Never claim we sent the whole selection when the budget truncated it. */
export function contextNote(s: SelectionSnapshot): string {
  if (s.rootCount === 0) return 'Nothing is selected — select layers or a frame first.';
  const bits = [`${s.rootCount} selected root${s.rootCount === 1 ? '' : 's'}`];
  if (s.texts.length) bits.push(`${s.texts.length} text layer${s.texts.length === 1 ? '' : 's'}`);
  if (s.nodes.length) bits.push(`${s.nodes.length} other node${s.nodes.length === 1 ? '' : 's'}`);
  const scope = bits.join(', ');
  return s.truncated
    ? `Context: ${scope} (the selection was truncated to fit; work only from what is shown and say so if a full answer needs the omitted nodes).`
    : `Context: ${scope} (the full selection).`;
}

/** Indent a line to render tree depth in the fenced context. */
function indent(depth: number): string {
  return '  '.repeat(Math.max(0, depth));
}

/** Serialize a text node as one context line: id, name, color, and its content.
 *  ids are shown so the model can key its JSON edit map back to them. */
function textLine(t: SerializedText): string {
  const color = t.color ? ` color=${t.color}` : '';
  return `${indent(t.depth)}- [text id=${t.id} name="${t.name}"${color}] ${JSON.stringify(t.characters)}`;
}

/** Serialize a non-text node as one structural context line. */
function nodeLine(n: { id: string; type: string; name: string; depth: number; color?: string }): string {
  const color = n.color ? ` color=${n.color}` : '';
  return `${indent(n.depth)}- [${n.type} id=${n.id} name="${n.name}"${color}]`;
}

/** Build the fenced selection context, capped at `budget` characters. Text nodes
 *  come first (they're what most actions act on), then structural nodes. Lines
 *  are added IN ORDER and we stop when the next line would exceed the budget,
 *  always keeping at least the first line. Returns the block AND whether we
 *  dropped any line beyond what the snapshot already marked truncated. Pure and
 *  total: deterministic, no I/O. */
export function buildSelectionContext(
  s: SelectionSnapshot,
  budget: number = CONTEXT_CHAR_BUDGET,
): { block: string; truncated: boolean } {
  const lines: string[] = [
    ...s.texts.map(textLine),
    ...s.nodes.map(nodeLine),
  ];
  if (lines.length === 0) return { block: '(no visible layers in the selection)', truncated: s.truncated };

  const kept: string[] = [];
  let used = 0;
  let dropped = false;
  for (const line of lines) {
    const addition = (kept.length === 0 ? '' : '\n') + line;
    if (used + addition.length > budget && kept.length > 0) {
      dropped = true;
      break;
    }
    if (kept.length === 0 && line.length > budget) {
      // The very first line overflows on its own — hard-cut it so we always
      // return something, and mark truncated (we dropped part of this line).
      kept.push(line.slice(0, budget));
      dropped = true;
      break;
    }
    kept.push(line);
    used += addition.length;
  }
  return { block: kept.join('\n'), truncated: s.truncated || dropped };
}

/** Assemble the user turn: honest note (reflecting any local truncation) +
 *  fenced selection + the task line. Shared by every action's `user` builder so
 *  the framing is identical everywhere. */
function composeUser(s: SelectionSnapshot, _note: string, task: string): string {
  const { block, truncated } = buildSelectionContext(s);
  const scoped: SelectionSnapshot = truncated === s.truncated ? s : { ...s, truncated };
  return [
    contextNote(scoped),
    '',
    '---- selection ----',
    block,
    '',
    '---- task ----',
    task,
  ].join('\n');
}

/** Build the OpenAI-compatible message list for an action + freeform note.
 *  System prompt is the action's persona; the single user turn carries the
 *  context and task. Pure — unit-tested. */
export function buildMessages(
  actionId: string,
  snapshot: SelectionSnapshot,
  note: string,
): ChatCompletionMessage[] {
  const action = getAction(actionId);
  return [
    { role: 'system', content: action.system(snapshot) },
    { role: 'user', content: action.user(snapshot, note) },
  ];
}

// ---------------------------------------------------------------------------
// Response parsing (pure).
// ---------------------------------------------------------------------------

/** Strip a leading/trailing ```json fence if the model wrapped its JSON despite
 *  being told not to. Tolerant, not clever. */
function stripFence(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(t);
  return fence ? fence[1].trim() : t;
}

/** Parse a model response that should be a JSON id→value map into TextEdit[].
 *  `field` decides whether the value lands as `characters` (rewrite/translate/
 *  fill) or `name` (rename). Only ids present in `validIds` survive — the model
 *  cannot invent nodes to mutate. Non-string values are dropped. Throws only
 *  when the payload is not a JSON object at all, so the panel can show the raw
 *  reply. Pure — unit-tested. */
export function parseEditMap(
  text: string,
  field: 'characters' | 'name',
  validIds: ReadonlySet<string>,
): TextEdit[] {
  let obj: unknown;
  try {
    obj = JSON.parse(stripFence(text));
  } catch {
    throw new Error('Model did not return a JSON edit map.');
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('Model did not return a JSON edit map.');
  }
  const edits: TextEdit[] = [];
  for (const [id, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!validIds.has(id)) continue;
    if (typeof value !== 'string') continue;
    edits.push(field === 'characters' ? { id, characters: value } : { id, name: value });
  }
  return edits;
}

/** Split a numbered/bulleted variant list into clean strings. Accepts "1. ",
 *  "2) ", "- ", "* " prefixes; drops blank lines and any leading label line.
 *  Pure — unit-tested. */
export function parseVariants(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim())
    .filter((l) => l.length > 0);
}

/** The set of writable text-node ids in a snapshot — the only ids a rewrite/
 *  translate/fill edit map may touch. */
export function textIds(s: SelectionSnapshot): Set<string> {
  return new Set(s.texts.map((t) => t.id));
}

/** The set of all node ids in a snapshot — the ids a rename edit map may touch
 *  (text layers AND structural nodes are renameable). */
export function allIds(s: SelectionSnapshot): Set<string> {
  return new Set([...s.texts.map((t) => t.id), ...s.nodes.map((n) => n.id)]);
}

// ---------------------------------------------------------------------------
// @hanzo/ai run funnels (the only network in this module) over an injectable
// client so tests mock the gateway with zero HTTP.
// ---------------------------------------------------------------------------

/** Inputs shared by {@link stream} and {@link complete}. */
export interface RunInput {
  /** The design action id. */
  actionId: string;
  /** The current selection snapshot. */
  snapshot: SelectionSnapshot;
  /** The freeform note box (target language, brand voice, a question, …). */
  note: string;
  /** Model id to route to. */
  model?: string;
  /** Bearer credential for the gateway: the pasted `hk-…` key. Empty is allowed
   *  (the gateway serves anonymous/limited models). */
  token: string;
  /** Injected client (tests). Defaults to a real `createAiClient`. */
  client?: AiClient;
  /** Abort the run. */
  signal?: AbortSignal;
}

/** Build the client for a run. Centralized so base URL + token wiring lives in
 *  ONE place and tests can inject a fake. */
function clientFor(input: RunInput): AiClient {
  return input.client ?? createAiClient({ baseUrl: API_BASE_URL, token: input.token });
}

/** Run ONE streaming completion, invoking `onDelta` with each text chunk as it
 *  arrives, and resolve with the full concatenated text. Every action funnels
 *  through here; the caller parses the full text per the action's ApplyMode. */
export async function stream(input: RunInput, onDelta: (text: string) => void): Promise<string> {
  const client = clientFor(input);
  const chunks = await client.chat.completions.create(
    {
      model: input.model || DEFAULT_MODEL,
      messages: buildMessages(input.actionId, input.snapshot, input.note),
      stream: true,
    },
    { signal: input.signal },
  );
  let full = '';
  for await (const chunk of chunks) {
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}

/** Flatten an assistant message's content to plain text. The gateway may return
 *  a string or OpenAI content parts; we concatenate the text parts. Pure. */
export function messageText(content: string | ChatCompletionContentPart[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/** Run ONE non-streaming completion and return the assistant text. */
export async function complete(input: RunInput): Promise<string> {
  const client = clientFor(input);
  const res = await client.chat.completions.create(
    {
      model: input.model || DEFAULT_MODEL,
      messages: buildMessages(input.actionId, input.snapshot, input.note),
      stream: false,
    },
    { signal: input.signal },
  );
  return messageText(res.choices?.[0]?.message?.content);
}

/** Parse the full model text for an action into the concrete result the panel
 *  applies: for `rewrite`/`rename` a TextEdit[]; for `insert` a variant list;
 *  for `readonly` nothing (the prose IS the result). Pure — the single mapping
 *  from ApplyMode to output, so the panel never re-implements parsing. */
export function parseResult(
  actionId: string,
  snapshot: SelectionSnapshot,
  text: string,
): { edits?: TextEdit[]; variants?: string[] } {
  const action = getAction(actionId);
  switch (action.apply) {
    case 'rewrite':
      return { edits: parseEditMap(text, 'characters', textIds(snapshot)) };
    case 'rename':
      return { edits: parseEditMap(text, 'name', allIds(snapshot)) };
    case 'insert':
      return { variants: parseVariants(text) };
    case 'readonly':
      return {};
  }
}

/** Validate a pasted key by listing models with it — a key that can't list
 *  models is rejected before it's used. Returns the model ids on success so the
 *  caller can populate the picker in one round-trip. */
export async function validateKey(token: string, client?: AiClient): Promise<string[]> {
  const t = token.trim();
  if (!t) throw new Error('Enter a Hanzo API key (hk-…).');
  const c = client ?? createAiClient({ baseUrl: API_BASE_URL, token: t });
  const models = await c.models.list();
  return models.map((m) => m.id).filter((id) => typeof id === 'string' && id.length > 0);
}

/** List model ids available to `token` (empty lists public models). Never throws
 *  to the panel — returns [] on failure so the picker can fall back to the
 *  default. */
export async function listModels(token: string, client?: AiClient): Promise<string[]> {
  try {
    const c = client ?? createAiClient({ baseUrl: API_BASE_URL, token: token.trim() });
    const models = await c.models.list();
    return models.map((m) => m.id).filter((id) => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}
