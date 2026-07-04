// People-context assembly — PURE, host-agnostic, fully unit-testable. Turns the
// typed Workday records (workers, organizations, requisitions, absence types,
// time-off report rows) into the plain text an AI action reads, windowed to a
// character budget so a large tenant never overflows the model or gets sent
// silently truncated.
//
// There is ONE windowing contract, identical in spirit to @hanzo/procore's
// project windowing: render ordered blocks, walk them in order, stop at the
// budget, always include at least the first block, and report `truncated`
// honestly. The only HR-specific part is how a record renders to a block.

import type {
  Worker,
  Organization,
  JobRequisition,
  AbsenceType,
  ReportRow,
} from './workday-api.js';
import { PEOPLE_CHAR_BUDGET } from './config.js';

// ---- Record → text block --------------------------------------------------

// renderWorker turns one worker into a labelled block. Only records-backed facts;
// no compensation or performance is ever rendered (it isn't in the profile). Pure.
export function renderWorker(w: Worker): string {
  const lines: string[] = [w.name || w.id];
  const head: string[] = [];
  if (w.businessTitle) head.push(w.businessTitle);
  else if (w.jobTitle) head.push(w.jobTitle);
  if (w.organization) head.push(w.organization);
  if (head.length) lines.push(head.join(' · '));
  const detail: string[] = [];
  if (w.jobTitle && w.jobTitle !== w.businessTitle) detail.push(`Job: ${w.jobTitle}`);
  if (w.location) detail.push(`Location: ${w.location}`);
  if (w.managerName) detail.push(`Manager: ${w.managerName}`);
  if (w.email) detail.push(`Email: ${w.email}`);
  if (w.isManager) detail.push('People manager');
  if (detail.length) lines.push(detail.join(' · '));
  return lines.join('\n');
}

// renderOrganization turns one supervisory org into a compact block.
export function renderOrganization(o: Organization): string {
  const head = `Organization: ${o.name || o.id}`;
  const meta: string[] = [];
  if (o.code) meta.push(`Code: ${o.code}`);
  if (o.type) meta.push(`Type: ${o.type}`);
  if (o.managerName) meta.push(`Manager: ${o.managerName}`);
  return meta.length ? `${head}\n${meta.join(' · ')}` : head;
}

// renderJobRequisition turns one requisition into a compact block.
export function renderJobRequisition(r: JobRequisition): string {
  const head = `Requisition ${r.name || r.id}: ${r.title}`.trim();
  const meta: string[] = [];
  if (r.status) meta.push(`Status: ${r.status}`);
  if (r.openings) meta.push(`Openings: ${r.openings}`);
  if (r.location) meta.push(`Location: ${r.location}`);
  if (r.startDate) meta.push(`Start: ${r.startDate}`);
  return meta.length ? `${head}\n${meta.join(' · ')}` : head;
}

// renderAbsenceType turns one eligible absence/time-off type into a line.
export function renderAbsenceType(a: AbsenceType): string {
  return `Absence type: ${a.name || a.id}`;
}

// renderReportRow turns one RaaS Report_Entry row into a single labelled line of
// column: value pairs, dropping empty cells. Pure.
export function renderReportRow(row: ReportRow): string {
  const entries = Object.entries(row).filter(([, v]) => v !== '');
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

// ---- Windowing to a budget ------------------------------------------------

// A named group of rendered blocks — a section of the people context (e.g.
// "Workers", "Direct reports"). The assembler concatenates sections in the order
// given and windows the whole thing to the budget.
export interface Section {
  title: string;
  blocks: string[];
}

// The windowed people context: the rendered text, how many blocks were available
// vs included, and whether anything was dropped (so the prompt and UI can say so
// honestly).
export interface PeopleContext {
  text: string;
  totalBlocks: number;
  includedBlocks: number;
  truncated: boolean;
}

// buildPeopleContext concatenates sections IN ORDER and caps the rendered text at
// `budget` characters. It walks blocks in order (across sections) and stops when
// adding the next block would exceed the budget — always including at least the
// first block (hard-cut to the budget if that one block alone is over).
// `truncated` is true whenever not every available block made it in. Pure and
// total: deterministic, no I/O. This is the ONE windowing algorithm for the
// package — the same "fit ordered text to a budget" contract as @hanzo/procore.
export function buildPeopleContext(
  sections: Section[],
  budget: number = PEOPLE_CHAR_BUDGET,
): PeopleContext {
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

// contextNote is the one honest sentence prepended to the people text so the
// model (and, echoed in the panel, the user) knows the scope of what it sees.
// Never claim the whole tenant was sent when it wasn't. Pure.
export function contextNote(ctx: PeopleContext): string {
  if (ctx.totalBlocks === 0) return 'No Workday records were available.';
  return ctx.truncated
    ? `Workday records: ${ctx.includedBlocks} of ${ctx.totalBlocks} items (truncated to fit — answer only from what is shown and say so if the omitted part is needed).`
    : `Workday records: all ${ctx.totalBlocks} item${ctx.totalBlocks === 1 ? '' : 's'}.`;
}

// ---- Convenience section builders -----------------------------------------
//
// These turn a typed record list into a Section, so a caller (server or panel)
// assembles a people context in a couple of lines. Kept here (pure) so the same
// section shapes feed both surfaces and the tests.

export function workerSection(workers: Worker[], title = 'Workers'): Section {
  return { title, blocks: workers.map(renderWorker) };
}
export function directReportSection(workers: Worker[], title = 'Direct reports'): Section {
  return { title, blocks: workers.map(renderWorker) };
}
export function organizationSection(orgs: Organization[], title = 'Organization'): Section {
  return { title, blocks: orgs.map(renderOrganization) };
}
export function requisitionSection(reqs: JobRequisition[], title = 'Job requisitions'): Section {
  return { title, blocks: reqs.map(renderJobRequisition) };
}
export function absenceTypeSection(types: AbsenceType[], title = 'Absence types'): Section {
  return { title, blocks: types.map(renderAbsenceType) };
}
export function timeOffSection(rows: ReportRow[], title = 'Time off'): Section {
  return { title, blocks: rows.map(renderReportRow).filter((b) => b.length > 0) };
}
