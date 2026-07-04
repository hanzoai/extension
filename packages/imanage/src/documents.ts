// Document-context assembly — PURE, host-agnostic, fully unit-testable. Turns the
// typed iManage records (document profiles, extracted content, workspaces, folder
// listings, search results) into the plain text an AI action reads, windowed to a
// character budget so a large legal document (or matter set) never overflows the
// model or gets sent silently truncated.
//
// There is ONE windowing contract, identical in spirit to @hanzo/procore's project
// windowing: render ordered blocks, walk them in order, stop at the budget, always
// include at least the first block, and report `truncated` honestly. The only
// legal-DMS-specific part is how a record (or a document's content) renders to a
// block.

import type { DocumentEntry, FolderEntry, Workspace } from './imanage-api.js';
import { DOCUMENT_CHAR_BUDGET } from './config.js';

// ---- Text extraction ------------------------------------------------------
//
// getDocumentContent returns the stored bytes. We assume text or exported text;
// binary formats (native .docx/.pdf without server-side export, images) are OUT OF
// SCOPE and reported honestly rather than fed as garbage. looksBinary is a cheap
// heuristic: a NUL byte, or a high share of non-printable control characters, means
// we cannot treat it as text here.

// looksBinary reports whether a fetched content string is (probably) not plain
// text. Pure — samples the head so it stays cheap on large documents.
export function looksBinary(raw: string): boolean {
  if (raw.length === 0) return false;
  const sample = raw.slice(0, 4096);
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true; // a NUL byte is a reliable binary tell
    // Allow tab (9), LF (10), CR (13); count other C0 controls + DEL as binary.
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) control++;
  }
  return control / sample.length > 0.15;
}

// The result of extracting text from fetched content: the text (empty when not
// extractable) and an honest reason when nothing usable came out.
export interface ExtractedText {
  text: string;
  extracted: boolean;
  reason?: string;
}

// extractText normalizes fetched content to context text. Binary / empty content
// yields extracted:false with a reason the caller surfaces (never fabricated
// text). Whitespace is collapsed lightly so the model sees clean prose. Pure.
export function extractText(raw: string, name?: string): ExtractedText {
  const label = name ? ` (${name})` : '';
  if (!raw || raw.trim().length === 0) {
    return { text: '', extracted: false, reason: `The document${label} has no extractable text content.` };
  }
  if (looksBinary(raw)) {
    return {
      text: '',
      extracted: false,
      reason: `The document${label} is a binary format (native or image) — text extraction / OCR is out of scope here; summarize from the profile metadata only.`,
    };
  }
  const text = raw.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  return { text, extracted: true };
}

// ---- Record → text block --------------------------------------------------

// renderDocumentMeta turns a document profile into a labelled metadata block.
// Empty fields are omitted rather than rendered as blank lines. Pure.
export function renderDocumentMeta(doc: DocumentEntry): string {
  const head = `Document: ${doc.name || doc.id}`.trim();
  const meta: string[] = [];
  if (doc.extension) meta.push(`Type: .${doc.extension}`);
  if (doc.class) meta.push(`Class: ${doc.class}`);
  if (doc.author) meta.push(`Author: ${doc.author}`);
  if (doc.version !== '' && doc.version !== undefined) meta.push(`Version: ${doc.version}`);
  if (doc.editDate) meta.push(`Edited: ${doc.editDate}`);
  const lines = [head];
  if (meta.length) lines.push(meta.join(' · '));
  if (doc.comment) lines.push(`Comment: ${doc.comment.trim()}`);
  return lines.join('\n');
}

// renderWorkspace turns one workspace (matter container) into a labelled block.
export function renderWorkspace(w: Workspace): string {
  const head = `Workspace: ${w.name || w.id}`.trim();
  const meta: string[] = [];
  if (w.client) meta.push(`Client: ${w.client}`);
  if (w.matter) meta.push(`Matter: ${w.matter}`);
  const lines = [meta.length ? `${head}\n${meta.join(' · ')}` : head];
  if (w.description) lines.push(w.description.trim());
  return lines.join('\n');
}

// renderDocumentLine turns one document entry into a single labelled line (for a
// folder listing or a search result set — the index, not the content).
export function renderDocumentLine(doc: DocumentEntry): string {
  const ext = doc.extension ? `.${doc.extension}` : '';
  const who = doc.author ? ` — ${doc.author}` : '';
  const when = doc.editDate ? ` (${doc.editDate})` : '';
  return `Doc: ${doc.name || doc.id}${ext}${who}${when}`;
}

// renderFolderLine turns one folder entry into a single labelled line.
export function renderFolderLine(f: FolderEntry): string {
  return `Folder: ${f.name || f.id}`;
}

// contentBlocks splits a document's extracted text into paragraph blocks so the
// windowing algorithm can include as much as fits and cut on a paragraph boundary
// rather than mid-sentence. Pure.
export function contentBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

// ---- Windowing to a budget ------------------------------------------------

// A named group of rendered blocks — a section of the context (e.g. "Document
// profile", "Contract text", "Search results"). The assembler concatenates
// sections in the order given and windows the whole thing to the budget.
export interface Section {
  title: string;
  blocks: string[];
}

// The windowed document context: the rendered text, how many blocks were available
// vs included, and whether anything was dropped (so the prompt and UI can say so
// honestly).
export interface DocumentContext {
  text: string;
  totalBlocks: number;
  includedBlocks: number;
  truncated: boolean;
}

// buildContext concatenates sections IN ORDER and caps the rendered text at
// `budget` characters. It walks blocks in order (across sections) and stops when
// adding the next block would exceed the budget — always including at least the
// first block (hard-cut to the budget if that one block alone is over).
// `truncated` is true whenever not every available block made it in. Pure and
// total: deterministic, no I/O. This is the ONE windowing algorithm for the
// package — the same "fit ordered text to a budget" contract as @hanzo/procore.
export function buildContext(
  sections: Section[],
  budget: number = DOCUMENT_CHAR_BUDGET,
): DocumentContext {
  const totalBlocks = sections.reduce((n, s) => n + s.blocks.length, 0);
  if (totalBlocks === 0) {
    return { text: '', totalBlocks: 0, includedBlocks: 0, truncated: false };
  }

  const parts: string[] = [];
  let used = 0;
  let included = 0;
  let hardCut = false;

  outer: for (const section of sections) {
    if (section.blocks.length === 0) continue;
    // The section header is charged to the first block that fits under it.
    let headerPending = `## ${section.title}\n`;
    for (const block of section.blocks) {
      const prefix = parts.length === 0 ? '' : '\n\n';
      const addition = prefix + headerPending + block;
      if (used + addition.length > budget) {
        if (parts.length === 0) {
          // First block alone overflows — hard-cut it to the budget so we always
          // send something rather than an empty context.
          const solo = (headerPending + block).slice(0, budget);
          parts.push(solo);
          used = solo.length;
          included = 1;
          hardCut = true;
        }
        break outer;
      }
      parts.push(addition);
      used += addition.length;
      included += 1;
      headerPending = ''; // header only precedes the first block of the section
    }
  }

  const truncated = included < totalBlocks || hardCut;
  return { text: parts.join(''), totalBlocks, includedBlocks: included, truncated };
}

// contextNote is the one honest sentence prepended to the document text so the
// model (and, echoed in the panel, the user) knows the scope of what it sees.
// Never claim the whole document/matter was sent when it wasn't. Pure.
export function contextNote(ctx: DocumentContext): string {
  if (ctx.totalBlocks === 0) return 'No document content or records were available.';
  return ctx.truncated
    ? `Document context: ${ctx.includedBlocks} of ${ctx.totalBlocks} sections (truncated to fit — answer only from what is shown and say so if the omitted part is needed).`
    : `Document context: all ${ctx.totalBlocks} section${ctx.totalBlocks === 1 ? '' : 's'}.`;
}

// ---- Convenience section builders -----------------------------------------
//
// These turn typed records into a Section, so a caller (server or panel) assembles
// a context in a couple of lines. Kept here (pure) so the same section shapes feed
// both surfaces and the tests.

// documentSection assembles ONE document: its profile metadata plus its extracted
// content (paragraph-blocked). When content was not extractable, the reason rides
// as the section's single content block so the model knows to work from metadata.
export function documentSection(doc: DocumentEntry, extracted: ExtractedText, title = 'Document'): Section {
  const blocks = [renderDocumentMeta(doc)];
  if (extracted.extracted && extracted.text) blocks.push(...contentBlocks(extracted.text));
  else if (extracted.reason) blocks.push(`[${extracted.reason}]`);
  return { title, blocks };
}

export function documentIndexSection(docs: DocumentEntry[], title = 'Documents'): Section {
  return { title, blocks: docs.map(renderDocumentLine) };
}
export function folderSection(folders: FolderEntry[], title = 'Folders'): Section {
  return { title, blocks: folders.map(renderFolderLine) };
}
export function workspaceSection(workspaces: Workspace[], title = 'Workspaces'): Section {
  return { title, blocks: workspaces.map(renderWorkspace) };
}
export function searchResultSection(docs: DocumentEntry[], title = 'Search results'): Section {
  return { title, blocks: docs.map(renderDocumentLine) };
}
