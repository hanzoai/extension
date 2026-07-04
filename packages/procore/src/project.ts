// Project-context assembly — PURE, host-agnostic, fully unit-testable. Turns the
// typed Procore records (RFIs, submittals, documents, observations, daily logs)
// into the plain text an AI action reads, windowed to a character budget so a
// busy project never overflows the model or gets sent silently truncated.
//
// There is ONE windowing contract, identical in spirit to @hanzo/docusign's page
// windowing: render ordered blocks, walk them in order, stop at the budget,
// always include at least the first block, and report `truncated` honestly. The
// only construction-specific part is how a record renders to a block.

import type {
  DailyLogNote,
  DocumentEntry,
  Observation,
  Rfi,
  Submittal,
} from './procore-api.js';
import { PROJECT_CHAR_BUDGET } from './config.js';

// ---- Record → text block --------------------------------------------------

// renderRFI turns one RFI (question + reply thread) into a labelled block. The
// reply order carries meaning (the conversation), so we never reorder it. Empty
// fields are omitted rather than rendered as blank lines. Pure.
export function renderRFI(rfi: Rfi): string {
  const lines: string[] = [];
  const head = `RFI ${rfi.number || rfi.id}: ${rfi.subject}`.trim();
  lines.push(head);
  const meta: string[] = [];
  if (rfi.status) meta.push(`Status: ${rfi.status}`);
  if (rfi.ballInCourt) meta.push(`Ball in court: ${rfi.ballInCourt}`);
  if (rfi.dueDate) meta.push(`Due: ${rfi.dueDate}`);
  if (meta.length) lines.push(meta.join(' · '));
  if (rfi.question.body) lines.push(`Question: ${rfi.question.body.trim()}`);
  for (const r of rfi.question.replies) {
    const who = r.createdBy ? ` (${r.createdBy})` : '';
    if (r.body) lines.push(`Reply${who}: ${r.body.trim()}`);
  }
  return lines.join('\n');
}

// renderSubmittal turns one submittal into a compact one/two-line block.
export function renderSubmittal(s: Submittal): string {
  const head = `Submittal ${s.number || s.id}: ${s.title}`.trim();
  const meta: string[] = [];
  if (s.type) meta.push(`Type: ${s.type}`);
  if (s.status) meta.push(`Status: ${s.status}`);
  if (s.dueDate) meta.push(`Due: ${s.dueDate}`);
  return meta.length ? `${head}\n${meta.join(' · ')}` : head;
}

// renderDocument turns one document/folder entry into a single labelled line.
export function renderDocument(d: DocumentEntry): string {
  const kind = d.isFolder ? 'Folder' : 'File';
  const when = d.updatedAt ? ` (updated ${d.updatedAt})` : '';
  return `${kind}: ${d.name}${when}`;
}

// renderObservation turns one observation into a labelled block.
export function renderObservation(o: Observation): string {
  const head = `Observation: ${o.name}`.trim();
  const meta: string[] = [];
  if (o.status) meta.push(`Status: ${o.status}`);
  if (o.priority) meta.push(`Priority: ${o.priority}`);
  const lines = [meta.length ? `${head}\n${meta.join(' · ')}` : head];
  if (o.description) lines.push(o.description.trim());
  return lines.join('\n');
}

// renderDailyLog turns one daily-log note into a labelled block.
export function renderDailyLog(n: DailyLogNote): string {
  const who = n.createdBy ? ` — ${n.createdBy}` : '';
  const date = n.date ? `[${n.date}]` : '[daily log]';
  return `${date}${who}: ${n.comment.trim()}`;
}

// ---- Windowing to a budget ------------------------------------------------

// A named group of rendered blocks — a section of the project context (e.g.
// "Open RFIs", "Daily log 2026-06-20"). The assembler concatenates sections in
// the order given and windows the whole thing to the budget.
export interface Section {
  title: string;
  blocks: string[];
}

// The windowed project context: the rendered text, how many blocks were
// available vs included, and whether anything was dropped (so the prompt and UI
// can say so honestly).
export interface ProjectContext {
  text: string;
  totalBlocks: number;
  includedBlocks: number;
  truncated: boolean;
}

// renderSection turns a section into its header + blocks string. Used both to
// measure the budget and to emit — the measured text IS the sent text.
function renderSection(title: string, blocks: string[]): string {
  return `## ${title}\n${blocks.join('\n\n')}`;
}

// buildProjectContext concatenates sections IN ORDER and caps the rendered text
// at `budget` characters. It walks blocks in order (across sections) and stops
// when adding the next block would exceed the budget — always including at least
// the first block (hard-cut to the budget if that one block alone is over).
// `truncated` is true whenever not every available block made it in. Pure and
// total: deterministic, no I/O. This is the ONE windowing algorithm for the
// package — the same "fit ordered text to a budget" contract as @hanzo/docusign.
export function buildProjectContext(
  sections: Section[],
  budget: number = PROJECT_CHAR_BUDGET,
): ProjectContext {
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

// contextNote is the one honest sentence prepended to the project text so the
// model (and, echoed in the panel, the user) knows the scope of what it sees.
// Never claim the whole project was sent when it wasn't. Pure.
export function contextNote(ctx: ProjectContext): string {
  if (ctx.totalBlocks === 0) return 'No project records were available.';
  return ctx.truncated
    ? `Project records: ${ctx.includedBlocks} of ${ctx.totalBlocks} items (truncated to fit — answer only from what is shown and say so if the omitted part is needed).`
    : `Project records: all ${ctx.totalBlocks} item${ctx.totalBlocks === 1 ? '' : 's'}.`;
}

// ---- Convenience section builders -----------------------------------------
//
// These turn a typed record list into a Section, so a caller (server or panel)
// assembles a project context in a couple of lines. Kept here (pure) so the same
// section shapes feed both surfaces and the tests.

export function rfiSection(rfis: Rfi[], title = 'RFIs'): Section {
  return { title, blocks: rfis.map(renderRFI) };
}
export function submittalSection(submittals: Submittal[], title = 'Submittals'): Section {
  return { title, blocks: submittals.map(renderSubmittal) };
}
export function documentSection(docs: DocumentEntry[], title = 'Documents'): Section {
  return { title, blocks: docs.map(renderDocument) };
}
export function observationSection(items: Observation[], title = 'Observations'): Section {
  return { title, blocks: items.map(renderObservation) };
}
export function dailyLogSection(notes: DailyLogNote[], title = 'Daily log'): Section {
  return { title, blocks: notes.map(renderDailyLog) };
}
