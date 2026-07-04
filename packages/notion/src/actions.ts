// The four Hanzo AI actions over a Notion page/workspace, plus the pure
// page-context assembly/truncation they share. An action = build a task prompt +
// a page context, ask Hanzo through the createAiClient contract, and (for the
// write actions) turn the result into Notion blocks / a database row. The
// context assembly, the per-action task strings, and the extraction parsing are
// pure and unit-tested; the model call and the Notion write are the two thin
// async edges (client.chat.completions.create, notion-api.appendChildren/createPage).

import {
  createAiClient,
  extractContent,
  type AiClient,
  type ChatMessage,
} from './client.js';
import { DEFAULT_MODEL } from './config.js';
import { calloutBlock, headingBlock, textToBlocks, titleProperty, richTextProperty, dateProperty } from './blocks.js';

// ── Page context assembly (pure) ────────────────────────────────────────────

/**
 * A Notion page as this app consumes it — its title plus its content already
 * rendered to text by blocks.ts (blocksToText over the fetched block tree).
 */
export interface PageContext {
  title: string;
  /** The page body as markdown-ish text (from blocksToText). */
  text: string;
}

// The model's context window is finite; a wiki page can be huge. Cap the
// assembled context so a big page never blows the request. Chosen to fit
// comfortably in a modern context window alongside the response.
export const MAX_CONTEXT_CHARS = 48_000;

// truncate cuts text to a max length, appending a visible marker so the model
// (and the reviewing user) know content was elided. Pure.
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

// assemblePageContext renders a PageContext into the single fenced string handed
// to Hanzo. The title leads so it survives truncation; the body follows, capped
// at maxChars. Pure.
export function assemblePageContext(p: PageContext, maxChars = MAX_CONTEXT_CHARS): string {
  const header = p.title ? `Page: ${p.title}\n\n` : '';
  return truncate(header + p.text.trim(), maxChars);
}

// ── System frame + message shaping (pure) ───────────────────────────────────

export const SYSTEM_PROMPT =
  'You are Hanzo AI working inside a Notion workspace for a startup or ops team. ' +
  'You are given a page (its title and content) and a task. Work only from the ' +
  'provided content — never invent facts not present in it. Return clean text ' +
  'with no preamble, no "Here is", and no code fences unless the task explicitly ' +
  'asks for structured output.';

/**
 * buildMessages composes the system frame + the page context (fenced as data,
 * so the model treats page content as data not instructions — a prompt-injection
 * boundary) + the task instruction. Pure — unit-tested.
 */
export function buildMessages(task: string, context: string): ChatMessage[] {
  const trimmed = context.trim();
  const user: ChatMessage = {
    role: 'user',
    content: trimmed ? `${task}\n\n---- Notion page ----\n${trimmed}\n---- end ----` : task,
  };
  return [{ role: 'system', content: SYSTEM_PROMPT }, user];
}

// ── The four action definitions (pure task strings) ─────────────────────────

export type ActionId = 'summarize' | 'draft' | 'extract' | 'ask';

/**
 * actionTask maps an action id (+ optional user detail) to its task instruction.
 * `draft` and `ask` take a user-supplied detail (what to write / the question);
 * `summarize` and `extract` are fixed. Pure.
 */
export function actionTask(id: ActionId, detail = ''): string {
  switch (id) {
    case 'summarize':
      return (
        'Summarize this page as a tight bullet list of the key points and any ' +
        'decisions reached. Lead with a one-sentence overview. No preamble.'
      );
    case 'draft': {
      const what = detail.trim() || 'the next section, continuing naturally from the page content';
      return (
        `Draft ${what}. Match the tone and structure of the existing page. ` +
        'Produce complete, ready-to-insert prose. No preamble.'
      );
    }
    case 'extract':
      return (
        'Extract the action items from this page. Return ONLY a JSON array; each ' +
        'element is an object with keys "task" (string, required), "owner" ' +
        '(string, "" if none named), and "due" (ISO date string YYYY-MM-DD, "" ' +
        'if none stated). Return [] if there are no action items. No prose, no ' +
        'code fences — just the JSON array.'
      );
    case 'ask':
      return detail.trim() || 'What is this page about, and what are the open questions?';
  }
}

// ── Running the ask/summarize/draft actions ─────────────────────────────────

export interface RunActionParams {
  id: ActionId;
  detail?: string; // draft instruction / question
  context: PageContext;
  hanzoToken: string;
  model?: string;
  baseURL?: string;
  client?: AiClient; // injected in tests
  signal?: AbortSignal;
}

/**
 * runAction assembles the context, forms the task, and asks Hanzo through the
 * createAiClient contract. Returns the RAW AI text for every action — for
 * `summarize`/`draft`/`ask` that is prose to append as a callout; for `extract`
 * it is the JSON array the caller parses (parseActionItems) into database rows.
 * Writing back is a separate explicit step so the user reviews before persisting.
 * This is the SINGLE path from the app to the model.
 */
export async function runAction(p: RunActionParams): Promise<string> {
  const client =
    p.client ?? createAiClient({ token: p.hanzoToken, baseURL: p.baseURL });
  const context = assemblePageContext(p.context);
  const task = actionTask(p.id, p.detail);
  const res = await client.chat.completions.create({
    model: p.model || DEFAULT_MODEL,
    messages: buildMessages(task, context),
    signal: p.signal,
  });
  return extractContent(res);
}

// ── Extract → database ──────────────────────────────────────────────────────

/** One extracted action item. `owner`/`due` are '' when the page didn't state them. */
export interface ActionItem {
  task: string;
  owner: string;
  due: string; // ISO date or ''
}

/**
 * parseActionItems parses the model's JSON-array output into ActionItem[]. It
 * tolerates a stray ```json fence or leading/trailing prose by extracting the
 * first `[ … ]` span, and drops malformed elements (an item with no `task` is
 * useless). Throws only when no array is present at all, so the caller surfaces
 * a real failure rather than silently writing nothing. Pure — unit-tested.
 */
export function parseActionItems(raw: string): ActionItem[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No action-item array found in model output');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('Model output was not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('Model output was not a JSON array');
  const out: ActionItem[] = [];
  for (const el of parsed) {
    const o = el as { task?: unknown; owner?: unknown; due?: unknown };
    const task = typeof o?.task === 'string' ? o.task.trim() : '';
    if (!task) continue;
    out.push({
      task,
      owner: typeof o?.owner === 'string' ? o.owner.trim() : '',
      due: typeof o?.due === 'string' ? o.due.trim() : '',
    });
  }
  return out;
}

/**
 * The property names in the target database. Defaults match a conventional
 * action-items database ("Name" is Notion's default title column). Overridable
 * so a team's existing database with different column names still works.
 */
export interface DatabaseFieldMap {
  title: string; // title column (the task)
  owner?: string; // rich_text column
  due?: string; // date column
}

export const DEFAULT_FIELD_MAP: DatabaseFieldMap = {
  title: 'Name',
  owner: 'Owner',
  due: 'Due',
};

/**
 * actionItemProperties maps ONE ActionItem to a Notion `properties` object for
 * createPage, using the field map. Only maps the owner/due columns when the map
 * names them and the item has a value — so a database missing those columns
 * still gets valid rows (just the title). Pure — unit-tested.
 */
export function actionItemProperties(
  item: ActionItem,
  fields: DatabaseFieldMap = DEFAULT_FIELD_MAP,
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    [fields.title]: titleProperty(item.task),
  };
  if (fields.owner && item.owner) props[fields.owner] = richTextProperty(item.owner);
  if (fields.due && item.due) props[fields.due] = dateProperty(item.due);
  return props;
}

// ── Write-back block building (pure) ────────────────────────────────────────

/** noteHeading — a concise, action-labelled heading for the appended block so a
 * user scanning the page sees what Hanzo produced. Pure. */
export function noteHeading(id: ActionId): string {
  const label: Record<ActionId, string> = {
    summarize: 'Summary',
    draft: 'Draft',
    extract: 'Action items',
    ask: 'Answer',
  };
  return `Hanzo AI — ${label[id]}`;
}

/**
 * resultBlocks builds the Notion block list appended to a page for a text
 * result: a heading, then the body as a callout (short) followed by any overflow
 * as paragraphs. The callout holds the first slice so the output reads as a
 * distinct AI note; longer bodies spill into paragraph blocks (Notion renders a
 * giant callout poorly). Pure — unit-tested.
 */
export function resultBlocks(id: ActionId, body: string): Array<Record<string, unknown>> {
  const trimmed = body.trim();
  const blocks: Array<Record<string, unknown>> = [headingBlock(noteHeading(id))];
  // First paragraph → callout (the eye-catching AI note); rest → paragraphs.
  const paras = trimmed.split(/\n\s*\n/);
  const [first, ...rest] = paras;
  blocks.push(calloutBlock(first || trimmed));
  for (const p of rest) {
    for (const b of textToBlocks(p)) blocks.push(b);
  }
  return blocks;
}
