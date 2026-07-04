// The desktop action catalog and everything pure around it: the prompt builders
// for the quick actions (summarize / explain / rewrite / translate / fix-grammar
// / ask), the clipboard-context assembly and truncation, the message shaping
// @hanzo/ai takes, and the response parsing that turns a model reply into
// paste-ready text. NO Tauri imports, NO @hanzo/ai imports, NO DOM — this module
// is host-agnostic and fully unit-testable. The app reads the clipboard via
// clipboard.ts, hands the text here to build a request, sends it through hanzo.ts,
// and parses the reply back here before copying/pasting via clipboard.ts.
//
// It mirrors @hanzo/raycast's actions core so the productivity suite stays
// consistent: the same context/prompt/parse contracts, one code path from an
// (action id + inputs) to a message list, and one path from a raw reply to
// paste-ready text.

// A message in the OpenAI-compatible schema — the shape @hanzo/ai's
// chat.completions.create takes. A local alias so the pure builders have a
// precise, testable return type independent of the SDK's broader union.
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// SYSTEM_PROMPT grounds every answer in the text the user handed us. It forbids
// inventing facts (the failure mode that makes a rewrite assistant dangerous) and
// keeps output ready to paste straight back — no preamble, no fences. Brand-
// neutral, surface-neutral: this runs over whatever the frontmost app copied.
export const SYSTEM_PROMPT =
  "You are Hanzo AI, an assistant that pops up over whatever app the user is in. " +
  "You operate on the text on their clipboard, copied from the app in front of " +
  "them. Work only from the text provided below; never invent facts, figures, " +
  "names, or claims that are not present in it or in the user's instruction. " +
  "Return ONLY the resulting text, ready to paste straight back — no preamble, no " +
  'explanation, no surrounding quotes, no markdown code fences, no "Here is". ' +
  "Preserve the input's format (lists stay lists, code stays code) unless the " +
  "instruction says otherwise.";

// ---- Context assembly -----------------------------------------------------
//
// The app captures what it can see — the clipboard contents — and an optional
// freeform instruction, and hands the clipboard here as an ActionContext. We
// render the text into a compact, fenced block the model reads as data (never as
// instructions), capped at the budget. Honest truncation.

// What the app observed and passes to a prompt builder. `text` is the subject
// (the clipboard). Optional: an `ask` with an empty clipboard has only the
// instruction.
export interface ActionContext {
  /** The captured subject text — the clipboard contents. */
  text?: string;
}

// The result of rendering an ActionContext down to what we attach: the text and
// whether it was truncated (so the prompt and UI can say so).
export interface RenderedContext {
  text: string;
  truncated: boolean;
}

// chooseSubject decides which captured text becomes the model's subject: the
// clipboard when it is non-empty, else none. Pure and total so the capture policy
// is unit-tested without Tauri. It lives here with the context assembly (not
// braided into the clipboard I/O in clipboard.ts) so the whole "what does the
// model see" decision is one testable module.
export function chooseSubject(clipboard: string | null): ActionContext {
  const clip = (clipboard ?? "").trim();
  if (clip) return { text: clip };
  return {};
}

// buildContext renders the observed subject into what we attach, capped at
// `budget` characters. Pure and total. `truncated` is true whenever the text was
// cut to fit; the caller shows that honestly rather than answering as though it
// saw the whole input.
export function buildContext(
  ctx: ActionContext,
  budget: number = CONTEXT_CHAR_BUDGET,
): RenderedContext {
  const raw = (ctx.text ?? "").trim();
  if (!raw) return { text: "", truncated: false };
  if (raw.length <= budget) return { text: raw, truncated: false };
  return { text: raw.slice(0, budget), truncated: true };
}

// CONTEXT_CHAR_BUDGET default mirrors config.ts. Re-declared here as the builder's
// own default so actions.ts stays importable with zero config dependency (the app
// passes the config value explicitly when it wants to; tests do not).
const CONTEXT_CHAR_BUDGET = 24_000;

// ---- Prompt assembly ------------------------------------------------------

// contextNote is the one honest sentence prepended when the render was cut, so the
// model does not answer as though it saw the whole input.
function contextNote(truncated: boolean): string {
  return truncated
    ? "Note: the text below was truncated to fit — answer only from what is shown."
    : "";
}

// buildMessages fences the captured clipboard text as DATA (never instructions)
// and rides the honest note inside the user turn so it is never lost. The task
// (the resolved action prompt, plus any user instruction) comes last. Pure — the
// whole prompt is asserted in a test. When there is no context (an `ask` with an
// empty clipboard), the fence is omitted so the user turn is just the task.
export function buildMessages(
  task: string,
  rendered: RenderedContext,
): ChatMessage[] {
  const system: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
  const note = contextNote(rendered.truncated);
  const notePrefix = note ? `${note}\n\n` : "";
  const fence = rendered.text
    ? `---- clipboard ----\n${rendered.text}\n---- end clipboard ----\n\n`
    : "";
  const user: ChatMessage = {
    role: "user",
    content: `${notePrefix}${fence}---- task ----\n${task}`,
  };
  return [system, user];
}

// ---- The action catalog ---------------------------------------------------
//
// An action is (id → label + a prompt builder). The builder takes the action's
// inputs (an optional user instruction, a target language) and returns the task
// string layered onto the fenced context by buildMessages. Most actions require
// the captured text (summarize/explain/rewrite/translate/fix); `ask` works with
// or without it. Keeping each action's task in one builder means every command and
// every test resolve prompts one way.

// The inputs a quick action may take. All optional; each builder reads only the
// fields it needs. `instruction` is the user's freeform text (the tweak for
// rewrite, the question for ask); `language` is the target for translate.
export interface ActionInputs {
  instruction?: string;
  language?: string;
}

// The six actions. Each `build` returns the task string. `needsText` marks the
// actions that operate on the clipboard (the app tells the user to copy something
// first when it is empty). `needsInstruction` marks actions that require a user
// instruction (ask) so the app validates before sending. Frozen so the catalog is
// immutable at runtime.
export const ACTIONS = {
  ask: {
    label: "Ask",
    needsText: false,
    needsInstruction: true,
    build: (i: ActionInputs): string => {
      const q = (i.instruction ?? "").trim();
      return (
        `Answer this: "${q}". If clipboard text is provided above, answer from it; ` +
        "otherwise answer from general knowledge. If the provided text does not " +
        "support an answer, say so plainly."
      );
    },
  },
  summarize: {
    label: "Summarize clipboard",
    needsText: true,
    needsInstruction: false,
    build: (i: ActionInputs): string => {
      const focus = (i.instruction ?? "").trim();
      const how = focus
        ? `Focus the summary on: ${focus}.`
        : "Cover the key points and any conclusion.";
      return (
        "Summarize the clipboard text above concisely in clear prose. " +
        `${how} Do NOT add any fact not present in the text. Return only the summary.`
      );
    },
  },
  rewrite: {
    label: "Rewrite",
    needsText: true,
    needsInstruction: false,
    build: (i: ActionInputs): string => {
      const tweak = (i.instruction ?? "").trim();
      const how = tweak
        ? `Rewrite it as follows: ${tweak}.`
        : "Rewrite it to be clearer, tighter, and more natural, keeping the same meaning and roughly the same length.";
      return (
        `Rewrite the clipboard text above. ${how} Do NOT add any fact not present ` +
        "in the text or the instruction. Preserve its format. Return only the " +
        "rewritten text."
      );
    },
  },
  explain: {
    label: "Explain",
    needsText: true,
    needsInstruction: false,
    build: (i: ActionInputs): string => {
      const focus = (i.instruction ?? "").trim();
      const how = focus
        ? `Tailor the explanation to: ${focus}.`
        : "Assume a smart reader new to this topic.";
      return (
        "Explain the clipboard text above in plain language — what it means and " +
        `why it matters. ${how} If it is code, explain what it does step by step. ` +
        "Ground the explanation only in the text. Return only the explanation."
      );
    },
  },
  translate: {
    label: "Translate",
    needsText: true,
    needsInstruction: false,
    build: (i: ActionInputs): string => {
      const lang = (i.language ?? "").trim() || "English";
      return (
        `Translate the clipboard text above into ${lang}. Preserve the tone, ` +
        "intent, formatting, and any proper names verbatim; localize idioms " +
        "naturally rather than translating word for word. Return only the " +
        "translated text."
      );
    },
  },
  fixGrammar: {
    label: "Fix grammar",
    needsText: true,
    needsInstruction: false,
    build: (): string => {
      return (
        "Correct the grammar, spelling, and punctuation of the clipboard text " +
        "above. Do NOT change its meaning, tone, voice, or wording beyond what the " +
        "corrections require; preserve its format. Return only the corrected text."
      );
    },
  },
} as const;

// An action id from the catalog.
export type ActionId = keyof typeof ACTIONS;

// isActionId narrows an arbitrary string to a known id. Boundary guard — the app
// validates an inbound id here before running it.
export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

// actionList is the ordered catalog for building UI (the assistant window's action
// row + the tray menu), derived from the action map so the UI and the catalog can
// never drift.
export function actionList(): Array<{
  id: ActionId;
  label: string;
  needsText: boolean;
  needsInstruction: boolean;
}> {
  return (Object.keys(ACTIONS) as ActionId[]).map((id) => {
    const a = ACTIONS[id];
    return {
      id,
      label: a.label,
      needsText: a.needsText,
      needsInstruction: a.needsInstruction,
    };
  });
}

// actionTask resolves an id + inputs to its task string. Throws on an unknown id
// (a boundary error surfaced to the caller) rather than silently running a
// default. This is the single id→prompt resolution the app calls.
export function actionTask(id: string, inputs: ActionInputs = {}): string {
  if (!isActionId(id)) throw new Error(`Unknown action: ${id}`);
  return ACTIONS[id].build(inputs);
}

// buildActionMessages is the single path from an (action id, inputs, observed
// context) to the message list @hanzo/ai takes. Resolve the task, render the
// context, assemble the messages. Pure — the whole request is asserted in a test.
// The app calls exactly this, then hands the result to hanzo.ts.
export function buildActionMessages(
  id: string,
  inputs: ActionInputs,
  ctx: ActionContext,
  budget: number = CONTEXT_CHAR_BUDGET,
): ChatMessage[] {
  const task = actionTask(id, inputs);
  return buildMessages(task, buildContext(ctx, budget));
}

// ---- Response parsing -----------------------------------------------------
//
// Models sometimes wrap paste-ready text despite the system prompt: a leading
// "Here's the summary:", a Markdown code fence, or matched surrounding quotes.
// parseResult strips those so the text pastes cleanly. Total and idempotent —
// parsing already-clean text returns it unchanged.

// stripFence removes a single wrapping Markdown code fence (```lang ... ```) if the
// WHOLE reply is fenced. It does NOT touch fences in the middle of a reply (those
// are intentional content). Pure.
function stripFence(s: string): string {
  const m = s.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s;
}

// stripWrappingQuotes removes one matched pair of surrounding quotes (straight or
// curly) when the ENTIRE string is quoted — the model quoting a single line. It
// leaves quotes that are part of the content (an opening quote with no close, an
// internal quote). Pure.
function stripWrappingQuotes(s: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      const inner = s.slice(1, -1);
      if (!inner.includes(close)) return inner;
    }
  }
  return s;
}

// parseResult turns a raw model reply into paste-ready text: trim, drop a single
// wrapping code fence, drop matched surrounding quotes, trim again. Idempotent.
// This is the single reply→text path the app uses before copying/pasting.
export function parseResult(raw: string): string {
  let s = raw.trim();
  s = stripFence(s).trim();
  s = stripWrappingQuotes(s).trim();
  return s;
}
