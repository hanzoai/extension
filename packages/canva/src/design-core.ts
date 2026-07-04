// The design action catalog and everything pure around it: the prompt builders
// for copy / rewrite / translate / ideas / ask, the design-context assembly and
// truncation, the message shaping @hanzo/ai takes, and the response parsing that
// turns a model reply into paste-ready text. NO @canva imports, NO @hanzo/ai
// imports, NO DOM — this module is host-agnostic and fully unit-testable. The
// panel (app.tsx) reads a selection / page via canva.ts, hands the text here to
// build a request, sends it through hanzo.ts, and parses the reply back here
// before inserting it via canva.ts.
//
// It mirrors @hanzo/figma's design-core so the two design apps stay consistent:
// the same five action families, the same context/prompt/parse contracts. There
// is exactly ONE code path from an (action id + inputs) to a message list, and
// ONE path from a raw reply to paste-ready text.

// A message in the OpenAI-compatible schema — the shape @hanzo/ai's
// chat.completions.create takes. A local alias so the pure builders have a
// precise, testable return type independent of the SDK's broader union.
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// SYSTEM_PROMPT grounds every answer in the design context provided. It forbids
// inventing facts about the brand or product (the failure mode that makes a
// marketing assistant dangerous — fake claims, fake prices, fake stats), and
// keeps output ready to drop onto the canvas. Brand-neutral, designer-facing.
export const SYSTEM_PROMPT =
  'You are Hanzo AI, a copywriting assistant embedded in Canva. You help create ' +
  'marketing copy — headlines, captions, body copy, calls to action — and edit ' +
  'the text already on the design. Work from the design context provided below; ' +
  'never invent facts, prices, statistics, dates, or claims that are not ' +
  'supported by it or by the user\'s instruction. Write in clear, natural, ' +
  'on-brand prose sized for a design surface — punchy for headlines, concise for ' +
  'captions. Return ONLY the requested text, ready to drop onto the canvas — no ' +
  'preamble, no explanation, no surrounding quotes, no markdown fences.';

// ---- Design context assembly ----------------------------------------------
//
// The panel gathers what it can see about the design — the selected text (the
// primary subject of rewrite/translate) and the other text on the current page
// (surrounding voice/context) — and hands it here as a DesignContext. We render
// it into a compact, labeled block the model reads as data (never as
// instructions), and cap the whole block at the budget. Honest truncation.

// What the panel can observe about the design and pass to a prompt builder. All
// fields optional: a blank design has none, a fresh "generate" has only a brief.
export interface DesignContext {
  /** The user's selected text — the subject of rewrite/translate. */
  selection?: string;
  /** Other text on the current page, in reading order — surrounding voice. */
  pageText?: string[];
  /** The design's title, if the app can read it. */
  title?: string;
}

// The result of rendering a DesignContext down to what we attach: the text and
// whether anything was truncated (so the prompt and UI can say so honestly).
export interface RenderedContext {
  text: string;
  truncated: boolean;
}

// collapseWhitespace normalizes a text fragment for the context block: collapse
// runs of whitespace (including the newlines Canva stores between text lines)
// into single spaces and trim. Pure. The model does not need the layout, and
// raw newlines waste budget and blur the data/instruction boundary.
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// buildDesignContext renders the observable design into a labeled block, capped
// at `budget` characters. The selection is the field the model most needs (it is
// what rewrite/translate act on), so it is rendered first and the surrounding
// page text — the longest, least essential field — is what truncation trims.
// Pure and total. `truncated` is true whenever the render was cut to fit.
export function buildDesignContext(ctx: DesignContext, budget: number = DESIGN_CHAR_BUDGET): RenderedContext {
  const lines: string[] = [];
  if (ctx.title) {
    const t = collapseWhitespace(ctx.title);
    if (t) lines.push(`Design title: ${t}`);
  }
  if (ctx.selection) {
    const sel = collapseWhitespace(ctx.selection);
    if (sel) lines.push(`Selected text: ${sel}`);
  }
  if (ctx.pageText && ctx.pageText.length) {
    const page = ctx.pageText.map(collapseWhitespace).filter(Boolean);
    if (page.length) lines.push(`Other text on this page: ${page.join(' | ')}`);
  }

  const full = lines.join('\n');
  if (full.length <= budget) return { text: full, truncated: false };
  return { text: full.slice(0, budget), truncated: true };
}

// DESIGN_CHAR_BUDGET default mirrors config.ts. Re-declared here as the builder's
// own default so design-core stays importable with zero config dependency (the
// panel passes the config value explicitly when it wants to; tests do not).
const DESIGN_CHAR_BUDGET = 12_000;

// ---- Prompt assembly ------------------------------------------------------

// contextNote is the one honest sentence prepended when the render was cut, so
// the model does not answer as though it saw the whole design.
function contextNote(truncated: boolean): string {
  return truncated
    ? 'Note: the design context below was truncated to fit — answer only from what is shown.'
    : '';
}

// buildMessages fences the design context as DATA (never instructions) and rides
// the honest note inside the user turn so it is never lost. The task (the
// resolved action prompt, plus any user instruction) comes last. Pure — the
// whole prompt is asserted in a test. When there is no context (a from-scratch
// generate with only a brief), the fence is omitted so the user turn is just the
// task.
export function buildMessages(task: string, rendered: RenderedContext): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: SYSTEM_PROMPT };
  const note = contextNote(rendered.truncated);
  const notePrefix = note ? `${note}\n\n` : '';
  const fence = rendered.text
    ? `---- design ----\n${rendered.text}\n---- end design ----\n\n`
    : '';
  const user: ChatMessage = {
    role: 'user',
    content: `${notePrefix}${fence}---- task ----\n${task}`,
  };
  return [system, user];
}

// ---- The action catalog ---------------------------------------------------
//
// An action is (id → label + a prompt builder). The builder takes the action's
// inputs (a brief, a target language, a topic) and returns the task string that
// is layered onto the fenced context by buildMessages. Some actions ignore the
// context (generate, ideas, ask-with-no-selection); some require the selection
// (rewrite, translate). Keeping each action's task in one builder means the
// panel, the picker, and any test resolve prompts one way.

// The inputs a design action may take. All optional; each builder reads only the
// fields it needs and ignores the rest. `instruction` is the user's freeform
// text (the brief for generate, the question for ask, the tweak for rewrite);
// `language` is the target for translate; `count` bounds an ideas list.
export interface ActionInputs {
  instruction?: string;
  language?: string;
  count?: number;
}

// clampCount bounds an ideas request to a sane, promptable range. Pure.
function clampCount(count: number | undefined): number {
  if (!count || !Number.isFinite(count)) return 5;
  return Math.max(1, Math.min(10, Math.floor(count)));
}

// The five design actions. Each `build` returns the task string. `needsSelection`
// marks the actions that operate on the selected text (the panel disables them
// until something is selected). `needsInstruction` marks the actions that
// require a user brief/question (generate, ask) so the panel can validate before
// sending. Frozen so the catalog is immutable at runtime.
export const DESIGN_ACTIONS = {
  generate: {
    label: 'Generate copy',
    needsSelection: false,
    needsInstruction: true,
    build: (i: ActionInputs): string => {
      const brief = (i.instruction ?? '').trim();
      return (
        `Write marketing copy for this design based on the brief: "${brief}". ` +
        'Return polished, on-brand copy sized for a design surface — a headline, ' +
        'a short caption, or a few tight lines as the brief implies. Ground every ' +
        'claim in the brief and the design context. Return only the copy.'
      );
    },
  },
  rewrite: {
    label: 'Rewrite selected text',
    needsSelection: true,
    needsInstruction: false,
    build: (i: ActionInputs): string => {
      const tweak = (i.instruction ?? '').trim();
      const how = tweak
        ? `Rewrite it as follows: ${tweak}.`
        : 'Rewrite it to be clearer, tighter, and more persuasive, keeping the same meaning and roughly the same length.';
      return (
        `Rewrite the selected text above. ${how} Do NOT add any fact not present ` +
        'in the design context or the instruction. Return only the rewritten text.'
      );
    },
  },
  translate: {
    label: 'Translate',
    needsSelection: true,
    needsInstruction: false,
    build: (i: ActionInputs): string => {
      const lang = (i.language ?? '').trim() || 'Spanish';
      return (
        `Translate the selected text above into ${lang}. Preserve the tone, ` +
        'intent, and any brand names verbatim; localize idioms naturally rather ' +
        'than translating word for word. Return only the translated text.'
      );
    },
  },
  ideas: {
    label: 'Content ideas',
    needsSelection: false,
    needsInstruction: true,
    build: (i: ActionInputs): string => {
      const topic = (i.instruction ?? '').trim();
      const n = clampCount(i.count);
      return (
        `Suggest ${n} distinct content ideas for this design about: "${topic}". ` +
        'Each idea a single short line (a headline or angle), grounded in the ' +
        'topic and the design context. Return a numbered list, nothing else.'
      );
    },
  },
  ask: {
    label: 'Ask',
    needsSelection: false,
    needsInstruction: true,
    build: (i: ActionInputs): string => {
      const q = (i.instruction ?? '').trim();
      return (
        `Answer this question about the design or its copy: "${q}". Answer only ` +
        'from the design context and general copywriting knowledge; if the ' +
        'context does not support an answer, say so plainly.'
      );
    },
  },
} as const;

// A design action id from the catalog.
export type DesignActionId = keyof typeof DESIGN_ACTIONS;

// isDesignActionId narrows an arbitrary string to a known id. Boundary guard —
// the panel validates an inbound id here before running it.
export function isDesignActionId(id: string): id is DesignActionId {
  return Object.prototype.hasOwnProperty.call(DESIGN_ACTIONS, id);
}

// designActionList is the ordered catalog for building the UI, derived from the
// action map so the panel and the catalog can never drift.
export function designActionList(): Array<{
  id: DesignActionId;
  label: string;
  needsSelection: boolean;
  needsInstruction: boolean;
}> {
  return (Object.keys(DESIGN_ACTIONS) as DesignActionId[]).map((id) => {
    const a = DESIGN_ACTIONS[id];
    return { id, label: a.label, needsSelection: a.needsSelection, needsInstruction: a.needsInstruction };
  });
}

// actionTask resolves an id + inputs to its task string. Throws on an unknown id
// (a boundary error surfaced to the caller) rather than silently running a
// default. This is the single id→prompt resolution the panel calls.
export function actionTask(id: string, inputs: ActionInputs = {}): string {
  if (!isDesignActionId(id)) throw new Error(`Unknown design action: ${id}`);
  return DESIGN_ACTIONS[id].build(inputs);
}

// buildActionMessages is the single path from an (action id, inputs, observed
// design) to the message list @hanzo/ai takes. Resolve the task, render the
// context, assemble the messages. Pure — the whole request is asserted in a
// test. The panel calls exactly this, then hands the result to hanzo.ts.
export function buildActionMessages(
  id: string,
  inputs: ActionInputs,
  ctx: DesignContext,
  budget: number = DESIGN_CHAR_BUDGET,
): ChatMessage[] {
  const task = actionTask(id, inputs);
  return buildMessages(task, buildDesignContext(ctx, budget));
}

// ---- Response parsing -----------------------------------------------------
//
// Models sometimes wrap paste-ready text despite the system prompt: a leading
// "Here's your headline:", a Markdown code fence, or matched surrounding quotes.
// parseCopy strips those so the text drops cleanly onto the canvas. Total and
// idempotent — parsing already-clean text returns it unchanged.

// stripFence removes a single wrapping Markdown code fence (```lang ... ```) if
// the whole reply is fenced. It does NOT touch fences in the middle of a reply
// (those are intentional content). Pure.
function stripFence(s: string): string {
  const m = s.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s;
}

// stripWrappingQuotes removes one matched pair of surrounding quotes (straight or
// curly) when the ENTIRE string is quoted — the model quoting a headline. It
// leaves quotes that are part of the content (an opening quote with no close, an
// internal quote). Pure.
function stripWrappingQuotes(s: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];
  for (const [open, close] of pairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      const inner = s.slice(1, -1);
      // Only strip if the inner text has no unescaped copy of the closing quote,
      // i.e. the quotes truly wrap the whole thing rather than being content.
      if (!inner.includes(close)) return inner;
    }
  }
  return s;
}

// parseCopy turns a raw model reply into paste-ready text: trim, drop a single
// wrapping code fence, drop matched surrounding quotes, trim again. Idempotent.
// This is the single reply→text path the panel uses before inserting.
export function parseCopy(raw: string): string {
  let s = raw.trim();
  s = stripFence(s).trim();
  s = stripWrappingQuotes(s).trim();
  return s;
}

// parseIdeas turns a raw "ideas" reply — a numbered or bulleted list — into a
// clean array of idea lines, dropping the list markers so each idea can be shown
// as its own item and inserted individually. Pure. Blank lines and pure-marker
// lines are dropped; a reply with no list structure yields its non-empty lines.
export function parseIdeas(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim())
    .map((line) => stripWrappingQuotes(line).trim())
    .filter((line) => line.length > 0);
}
