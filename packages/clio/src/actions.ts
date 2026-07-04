// The four Hanzo AI actions over a Clio matter, plus the pure matter-context
// assembly/truncation they share. An action = build a task prompt + a matter
// context, ask Hanzo, and (optionally) WRITE the result back to Clio as a Note
// or Activity. The context assembly and the per-action task strings are pure
// and unit-tested; the Hanzo call and the Clio write are the two thin async
// edges (hanzo-chat.ask, clio-api.createNote/createActivity).

import { ask, type ChatOptions } from './hanzo-chat.js';
import {
  createNote,
  createActivity,
  clioFetch,
  type CreateNoteParams,
  type CreateActivityParams,
} from './clio-api.js';

// ── Matter context assembly (pure) ────────────────────────────────────────

// A matter as this app consumes it — a subset of Clio's matter record plus the
// pulled-in document texts. Shaped by app.ts from Clio responses.
export interface MatterContext {
  displayNumber?: string;
  description?: string;
  status?: string;
  clientName?: string;
  practiceArea?: string;
  responsibleAttorney?: string;
  openDate?: string;
  // Each document: its name and the text pulled via downloadDocument.
  documents: Array<{ name: string; text: string }>;
}

// The model's context window is finite; a matter's documents can be huge. Cap
// the total assembled context so a big matter never blows the request. Chosen
// to fit comfortably in a modern context window alongside the response.
export const MAX_CONTEXT_CHARS = 48_000;
// Per-document cap so one giant document can't crowd out every other document.
export const MAX_DOC_CHARS = 12_000;

// truncate cuts text to a max length, appending a visible marker so the model
// (and a reviewing lawyer) know content was elided. Pure.
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

// isTextExtractable reports whether a Clio document's content_type yields useful
// text when downloaded as-is. Legal matters are mostly PDF/DOCX (binary); those
// come back as mojibake that wastes the context budget and teaches the model
// nothing, so we skip their bytes and keep only the filename. Text, markdown,
// JSON/XML, CSV, and HTML are worth reading. Matched on the MIME SUBTYPE (after
// the `/`) so the DOCX type — application/vnd.openxmlformats-…, which contains
// the substring "xml" in its VENDOR tree — is correctly treated as binary. Pure.
const TEXT_SUBTYPES = new Set(['json', 'xml', 'csv', 'html', 'markdown', 'x-markdown', 'plain', 'rtf']);
export function isTextExtractable(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(';')[0].trim(); // drop any ;charset=
  if (ct.startsWith('text/')) return true;
  const subtype = ct.slice(ct.indexOf('/') + 1);
  return TEXT_SUBTYPES.has(subtype);
}

// assembleMatterContext renders a MatterContext into the single fenced string
// handed to Hanzo. Header lines carry the matter metadata; each document is
// per-doc capped, then the whole thing is capped at MAX_CONTEXT_CHARS. Order is
// metadata-first so the most important facts survive truncation.
export function assembleMatterContext(m: MatterContext, maxChars = MAX_CONTEXT_CHARS): string {
  const lines: string[] = [];
  if (m.displayNumber) lines.push(`Matter: ${m.displayNumber}`);
  if (m.description) lines.push(`Description: ${m.description}`);
  if (m.clientName) lines.push(`Client: ${m.clientName}`);
  if (m.status) lines.push(`Status: ${m.status}`);
  if (m.practiceArea) lines.push(`Practice area: ${m.practiceArea}`);
  if (m.responsibleAttorney) lines.push(`Responsible attorney: ${m.responsibleAttorney}`);
  if (m.openDate) lines.push(`Opened: ${m.openDate}`);

  for (const doc of m.documents) {
    const body = truncate(doc.text.trim(), MAX_DOC_CHARS);
    lines.push(`\n=== Document: ${doc.name} ===\n${body}`);
  }
  return truncate(lines.join('\n'), maxChars);
}

// ── The four action definitions (pure task strings) ───────────────────────

export type ActionId = 'summarize' | 'draft' | 'dates' | 'chat';

// Each action's task instruction. `draft` and `chat` take a user-supplied
// detail (what to draft / the question); `summarize` and `dates` are fixed.
export function actionTask(id: ActionId, detail = ''): string {
  switch (id) {
    case 'summarize':
      return (
        'Summarize this matter for the responsible attorney. Cover the client, ' +
        'the nature of the matter, current status, key parties, and the most ' +
        'important facts and open issues from the documents. Be concise.'
      );
    case 'draft': {
      const what = detail.trim() || 'a professional letter to the client updating them on this matter';
      return (
        `Draft ${what}. Use the matter context for names, dates and facts. ` +
        'Produce a complete, send-ready draft with an appropriate salutation ' +
        'and sign-off. The attorney will review and edit before sending.'
      );
    }
    case 'dates':
      return (
        'Extract every key date, deadline, and obligation from this matter and ' +
        'its documents. Return a structured list; for each item give the date ' +
        '(or "no date stated"), what is due, who is obligated, and the source ' +
        'document. If none are present, say so plainly.'
      );
    case 'chat':
      return detail.trim() || 'What is the current status of this matter?';
  }
}

// ── Running an action ─────────────────────────────────────────────────────

export interface RunActionParams {
  id: ActionId;
  detail?: string; // draft instruction / chat question
  context: MatterContext;
  hanzoToken: string;
  chatOpts?: ChatOptions;
}

// runAction assembles the context, forms the task, and asks Hanzo. Returns the
// raw AI text — writing it back to Clio is a separate explicit step (writeBack),
// so a lawyer reviews the output before it is persisted.
export async function runAction(p: RunActionParams): Promise<string> {
  const context = assembleMatterContext(p.context);
  const task = actionTask(p.id, p.detail);
  return ask(task, context, p.hanzoToken, p.chatOpts);
}

// noteSubject — a concise, action-labelled subject for the write-back note so a
// lawyer scanning the matter's notes sees what Hanzo produced. Pure.
export function noteSubject(id: ActionId, matterLabel = ''): string {
  const label: Record<ActionId, string> = {
    summarize: 'Matter summary',
    draft: 'Draft correspondence',
    dates: 'Key dates & obligations',
    chat: 'Q&A',
  };
  const suffix = matterLabel ? ` — ${matterLabel}` : '';
  return `Hanzo AI: ${label[id]}${suffix}`;
}

export type WriteTarget = 'note' | 'activity';

export interface WriteBackParams {
  target: WriteTarget;
  token: string; // Clio bearer
  base: string; // regional Clio origin
  matterId: number;
  subject: string; // note subject / activity label
  body: string; // the AI output to persist
}

// writeBack persists an AI result to Clio as either a matter Note (default —
// visible on the matter, holds the full body) or an Activity (a time/audit log
// entry). Returns the created record. One function, two targets, no branching
// in the caller.
export async function writeBack(p: WriteBackParams): Promise<any> {
  if (p.target === 'note') {
    const params: CreateNoteParams = {
      token: p.token,
      base: p.base,
      matterId: p.matterId,
      subject: p.subject,
      detail: p.body,
    };
    return clioFetch(createNote(params));
  }
  const params: CreateActivityParams = {
    token: p.token,
    base: p.base,
    matterId: p.matterId,
    note: `${p.subject}\n\n${p.body}`,
  };
  return clioFetch(createActivity(params));
}
