// Course-context assembly — PURE, host-agnostic, fully unit-testable. Turns the
// typed Canvas records (course/syllabus, modules, assignments, pages, discussions,
// submissions, enrollments) into the plain text an AI action reads, windowed to a
// character budget so a busy course never overflows the model or gets sent silently
// truncated.
//
// There is ONE windowing contract, identical in spirit to @hanzo/procore's project
// windowing: render ordered blocks, walk them in order, stop at the budget, always
// include at least the first block, and report `truncated` honestly. The only
// education-specific parts are how a record renders to a block and the HTML→text
// step (Canvas content — syllabus, page bodies, assignment descriptions, discussion
// messages — is HTML).

import type {
  Assignment,
  Course,
  Discussion,
  Enrollment,
  Module,
  Page_,
  Submission,
} from './canvas-api.js';
import { COURSE_CHAR_BUDGET } from './config.js';

// ---- HTML → text ----------------------------------------------------------

// htmlToText reduces Canvas rich-text HTML to readable plain text: block elements
// become line breaks, tags are stripped, the common named/numeric entities are
// decoded, and whitespace is collapsed. Deliberately small and dependency-free (no
// DOM) — Canvas bodies are trusted-institution content we only need to READ, not
// render, so a full sanitizer/ parser would be over-engineering. Pure.
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

// clamp trims a rendered body to a maximum length with an ellipsis so one giant
// page/syllabus can't dominate the budget before windowing even runs. Pure.
function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// Per-body cap: a single HTML body is trimmed to this before it becomes a block, so
// the windowing budget sees comparable blocks rather than one 40k-char page.
const BODY_CAP = 4_000;

// ---- Record → text block --------------------------------------------------

// renderCourseOverview turns the course + its syllabus into the lead block: the
// course identity and the (HTML-stripped, clamped) syllabus text.
export function renderCourseOverview(course: Course): string {
  const lines: string[] = [];
  const head = `${course.name}${course.courseCode ? ` (${course.courseCode})` : ''}`.trim();
  lines.push(head);
  const meta: string[] = [];
  if (course.termName) meta.push(`Term: ${course.termName}`);
  if (course.workflowState) meta.push(`State: ${course.workflowState}`);
  if (meta.length) lines.push(meta.join(' · '));
  const syllabus = htmlToText(course.syllabusBody);
  if (syllabus) lines.push(`Syllabus:\n${clamp(syllabus, BODY_CAP)}`);
  return lines.join('\n');
}

// renderAssignment turns one assignment into a labelled block.
export function renderAssignment(a: Assignment): string {
  const head = `Assignment: ${a.name}`.trim();
  const meta: string[] = [];
  if (a.dueAt) meta.push(`Due: ${a.dueAt}`);
  if (a.pointsPossible) meta.push(`Points: ${a.pointsPossible}`);
  if (a.submissionTypes.length) meta.push(`Submit: ${a.submissionTypes.join(', ')}`);
  const lines = [meta.length ? `${head}\n${meta.join(' · ')}` : head];
  const desc = htmlToText(a.description);
  if (desc) lines.push(clamp(desc, BODY_CAP));
  return lines.join('\n');
}

// renderSubmission turns one student submission into a labelled block, including
// the score/status and any existing comment thread (order preserved).
export function renderSubmission(s: Submission): string {
  const lines: string[] = [];
  const flags = [s.late ? 'late' : '', s.missing ? 'missing' : ''].filter(Boolean).join(', ');
  const head = `Submission (user ${s.userId})${flags ? ` [${flags}]` : ''}`;
  lines.push(head);
  const meta: string[] = [];
  if (s.workflowState) meta.push(`Status: ${s.workflowState}`);
  if (s.score !== null) meta.push(`Score: ${s.score}`);
  if (s.grade) meta.push(`Grade: ${s.grade}`);
  if (s.submittedAt) meta.push(`Submitted: ${s.submittedAt}`);
  if (meta.length) lines.push(meta.join(' · '));
  const body = htmlToText(s.body);
  if (body) lines.push(`Response: ${clamp(body, BODY_CAP)}`);
  for (const c of s.comments) {
    const who = c.authorName ? ` (${c.authorName})` : '';
    if (c.comment) lines.push(`Comment${who}: ${c.comment.trim()}`);
  }
  return lines.join('\n');
}

// renderDiscussion turns one discussion topic into a labelled block.
export function renderDiscussion(d: Discussion): string {
  const kind = d.isAnnouncement ? 'Announcement' : 'Discussion';
  const head = `${kind}: ${d.title}`.trim();
  const body = htmlToText(d.message);
  return body ? `${head}\n${clamp(body, BODY_CAP)}` : head;
}

// renderPage turns one wiki page into a labelled block (title + stripped body).
export function renderPage(p: Page_): string {
  const head = `Page: ${p.title || p.url}`.trim();
  const body = htmlToText(p.body);
  return body ? `${head}\n${clamp(body, BODY_CAP)}` : head;
}

// renderModule turns one module + its items into a labelled block.
export function renderModule(m: Module): string {
  const head = `Module: ${m.name}`.trim();
  const items = m.items.map((i) => `  - ${i.title}${i.type ? ` [${i.type}]` : ''}`).filter(Boolean);
  return items.length ? `${head}\n${items.join('\n')}` : head;
}

// renderEnrollment turns one enrollment into a single labelled line.
export function renderEnrollment(e: Enrollment): string {
  const who = e.userName || `user ${e.userId}`;
  const role = e.role || e.type;
  return `${who}${role ? ` — ${role}` : ''}${e.state ? ` (${e.state})` : ''}`;
}

// ---- Windowing to a budget ------------------------------------------------

// A named group of rendered blocks — a section of the course context (e.g.
// "Assignments", "Modules"). The assembler concatenates sections in the order given
// and windows the whole thing to the budget.
export interface Section {
  title: string;
  blocks: string[];
}

// The windowed course context: the rendered text, how many blocks were available vs
// included, and whether anything was dropped (so the prompt and UI can say so
// honestly).
export interface CourseContext {
  text: string;
  totalBlocks: number;
  includedBlocks: number;
  truncated: boolean;
}

// buildCourseContext concatenates sections IN ORDER and caps the rendered text at
// `budget` characters. It walks blocks in order (across sections) and stops when
// adding the next block would exceed the budget — always including at least the
// first block (hard-cut to the budget if that one block alone is over). `truncated`
// is true whenever not every available block made it in. Pure and total:
// deterministic, no I/O. This is the ONE windowing algorithm for the package — the
// same "fit ordered text to a budget" contract as @hanzo/procore.
export function buildCourseContext(
  sections: Section[],
  budget: number = COURSE_CHAR_BUDGET,
): CourseContext {
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

// contextNote is the one honest sentence prepended to the course text so the model
// (and, echoed in the panel, the user) knows the scope of what it sees. Never claim
// the whole course was sent when it wasn't. Pure.
export function contextNote(ctx: CourseContext): string {
  if (ctx.totalBlocks === 0) return 'No course records were available.';
  return ctx.truncated
    ? `Course records: ${ctx.includedBlocks} of ${ctx.totalBlocks} items (truncated to fit — answer only from what is shown and say so if the omitted part is needed).`
    : `Course records: all ${ctx.totalBlocks} item${ctx.totalBlocks === 1 ? '' : 's'}.`;
}

// ---- Convenience section builders -----------------------------------------
//
// These turn a typed record list into a Section, so a caller (server or panel)
// assembles a course context in a couple of lines. Kept here (pure) so the same
// section shapes feed both surfaces and the tests.

export function courseSection(course: Course, title = 'Course'): Section {
  return { title, blocks: [renderCourseOverview(course)] };
}
export function moduleSection(modules: Module[], title = 'Modules'): Section {
  return { title, blocks: modules.map(renderModule) };
}
export function assignmentSection(assignments: Assignment[], title = 'Assignments'): Section {
  return { title, blocks: assignments.map(renderAssignment) };
}
export function pageSection(pages: Page_[], title = 'Pages'): Section {
  return { title, blocks: pages.map(renderPage) };
}
export function discussionSection(discussions: Discussion[], title = 'Discussions'): Section {
  return { title, blocks: discussions.map(renderDiscussion) };
}
export function submissionSection(submissions: Submission[], title = 'Submissions'): Section {
  return { title, blocks: submissions.map(renderSubmission) };
}
export function enrollmentSection(enrollments: Enrollment[], title = 'Enrollments'): Section {
  return { title, blocks: enrollments.map(renderEnrollment) };
}
