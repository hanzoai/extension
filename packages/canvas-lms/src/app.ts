// The Canvas panel glue: the embedded/linked-app page that opens with a course in
// context and drives the AI actions over the course's live records. All the
// logic-heavy work (action prompts, context windowing, chat shaping, proxy request
// shaping, auth) lives in its own tested modules; this file binds them to the DOM. It
// is the one impure, browser-only entry point.
//
// Data flow: the panel reads Canvas ONLY through the same-origin server proxy
// (createProxyClient), which holds the OAuth token server-side. It pulls the course's
// syllabus / modules / assignments / pages / discussions, assembles a windowed context
// (buildCourseContext), and runs an action or a freeform question against api.hanzo.ai
// with the pasted Hanzo key. The optional write-backs (submission comment, course
// announcement) post back through the same proxy, behind explicit buttons.

import { actionList, isActionId, runAction } from './actions.js';
import { ask as askHanzo, listModels, type CourseMeta } from './hanzo.js';
import {
  buildCourseContext,
  contextNote,
  courseSection,
  moduleSection,
  assignmentSection,
  pageSection,
  discussionSection,
  submissionSection,
  type CourseContext,
  type Section,
} from './course.js';
import { DEFAULT_MODEL } from './config.js';
import { getApiKey, setApiKey, hasApiKey, bearer, validateKey } from './auth.js';
import { createProxyClient, parseLaunchContext, type ProxyClient } from './panel.js';
import type { Course, Assignment, Submission } from './canvas-api.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let controller: AbortController | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const launch = parseLaunchContext(window.location.search);

  const courseEl = $<HTMLSelectElement>('course');
  const assignmentEl = $<HTMLSelectElement>('assignment');
  const loadBtn = $<HTMLButtonElement>('load');
  const loadSubsBtn = $<HTMLButtonElement>('loadsubs');
  const recordsEl = $('records');
  const outputEl = $<HTMLTextAreaElement>('output');
  const statusEl = $('status');
  const modelEl = $<HTMLSelectElement>('model');
  const chipRow = $('chips');
  const runBtn = $<HTMLButtonElement>('run');
  const stopBtn = $<HTMLButtonElement>('stop');
  const promptEl = $<HTMLTextAreaElement>('prompt');
  const apiKeyEl = $<HTMLInputElement>('apikey');
  const saveKeyBtn = $<HTMLButtonElement>('savekey');
  const authHint = $('authhint');
  const commentBtn = $<HTMLButtonElement>('comment');
  const announceBtn = $<HTMLButtonElement>('announce');

  apiKeyEl.value = getApiKey();
  reflectAuth();
  void populateModels();
  void populateCourses();

  const client: ProxyClient = createProxyClient();

  // Loaded state: the course-overview sections, the loaded submissions (a separate
  // section appended on demand), and the ids the write-backs target.
  let overview: Section[] = [];
  let submissions: Submission[] = [];
  let ctx: CourseContext | null = null;
  let meta: CourseMeta = {};
  let currentCourseId = '';
  let currentAssignmentId = '';
  let assignments: Assignment[] = [];

  // Action chips — derived from the catalog so UI and logic never drift.
  for (const a of actionList()) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = a.label;
    b.dataset.action = a.id;
    b.onclick = () => void run(a.id);
    chipRow.appendChild(b);
  }

  loadBtn.onclick = () => void loadCourse();
  loadSubsBtn.onclick = () => void loadSubmissions();
  courseEl.onchange = () => {
    currentCourseId = courseEl.value;
  };
  assignmentEl.onchange = () => {
    currentAssignmentId = assignmentEl.value;
  };
  runBtn.onclick = () => {
    const prompt = promptEl.value.trim();
    if (prompt) void ask(prompt);
  };
  stopBtn.onclick = () => controller?.abort();
  commentBtn.onclick = () => void postComment();
  announceBtn.onclick = () => void postAnnouncement();
  saveKeyBtn.onclick = async () => {
    const key = apiKeyEl.value.trim();
    setStatus('Checking key…');
    try {
      const models = await validateKey(key);
      setApiKey(key);
      fillModels(models);
      reflectAuth();
      setStatus('Key saved.', 'ok');
    } catch (e: any) {
      setStatus(e?.message || 'Key rejected.', 'error');
    }
  };

  // If we launched already scoped to a course, load it straight away.
  if (launch.courseId) {
    void populateCourses().then(() => {
      courseEl.value = launch.courseId;
      currentCourseId = launch.courseId;
      void loadCourse();
    });
  }

  // populateCourses fills the course picker from the proxy. An auth failure leaves the
  // picker empty with a status hint pointing at the connect flow.
  async function populateCourses(): Promise<void> {
    setStatus('Loading courses…');
    try {
      const { items } = await client.listCourses({ perPage: 100 });
      fillCourses(items);
      setStatus(
        items.length ? `Loaded ${items.length} courses.` : 'No courses visible.',
        items.length ? 'ok' : 'warn',
      );
    } catch (e: any) {
      setStatus(
        e?.message || 'Could not load courses — is the app connected? (Connect on canvas.hanzo.ai)',
        'error',
      );
    }
  }

  // loadCourse pulls the scoped course's records and assembles the overview context
  // the actions run over. The course/syllabus, modules, assignments, pages, and
  // discussions are fetched in parallel; each failure is tolerated so a course missing
  // one area still yields a usable context.
  async function loadCourse(): Promise<void> {
    const courseId = courseEl.value || currentCourseId;
    if (!courseId) {
      setStatus('Pick a course first.', 'warn');
      return;
    }
    currentCourseId = courseId;
    setStatus('Loading course records…');
    const [course, modules, assigns, pages, discussions] = await Promise.all([
      client.getCourse(courseId).catch(() => null),
      client.listModules(courseId, { perPage: 100 }).then((r) => r.items).catch(() => []),
      client.listAssignments(courseId, { perPage: 100 }).then((r) => r.items).catch(() => [] as Assignment[]),
      client.listPages(courseId, { perPage: 100 }).then((r) => r.items).catch(() => []),
      client.listDiscussions(courseId, { perPage: 100 }).then((r) => r.items).catch(() => []),
    ]);

    assignments = assigns;
    submissions = [];
    fillAssignments(assigns);

    overview = [
      ...(course ? [courseSection(course)] : []),
      moduleSection(modules),
      assignmentSection(assigns),
      pageSection(pages),
      discussionSection(discussions),
    ];
    meta = course ? courseMetaOf(course) : {};
    rebuildContext();

    recordsEl.textContent =
      `${modules.length} modules · ${assigns.length} assignments · ${pages.length} pages · ${discussions.length} discussions`;
    announceBtn.disabled = false;
    announceBtn.title = 'Post the result as a course announcement';
    loadSubsBtn.disabled = assigns.length === 0;
    setStatus(contextNote(ctx!));
  }

  // loadSubmissions pulls the selected assignment's submissions and appends them to the
  // context so the feedback / summarize-submissions actions have student work. Enables
  // the submission-comment write-back against the first submission.
  async function loadSubmissions(): Promise<void> {
    const assignmentId = assignmentEl.value || currentAssignmentId;
    if (!currentCourseId || !assignmentId) {
      setStatus('Load a course and pick an assignment first.', 'warn');
      return;
    }
    currentAssignmentId = assignmentId;
    setBusy(true);
    setStatus('Loading submissions…');
    try {
      const { items } = await client.listSubmissions(currentCourseId, assignmentId, { perPage: 100 });
      submissions = items;
      rebuildContext();
      const withWork = submissions.filter((s) => s.workflowState && s.workflowState !== 'unsubmitted');
      commentBtn.disabled = withWork.length === 0;
      commentBtn.title = withWork.length
        ? `Post the result as a comment on user ${withWork[0].userId}'s submission`
        : 'No submitted work to comment on';
      recordsEl.textContent += ` · ${submissions.length} submissions`;
      setStatus(contextNote(ctx!));
    } catch (e: any) {
      setStatus(e?.message || 'Could not load submissions.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // rebuildContext re-windows the overview + any loaded submissions into one context.
  function rebuildContext(): void {
    ctx = buildCourseContext([...overview, ...(submissions.length ? [submissionSection(submissions)] : [])]);
  }

  // run executes one of the named actions over the loaded course context.
  async function run(actionId: string): Promise<void> {
    if (!isActionId(actionId)) return;
    await execute((c, m, opts) => runAction(actionId, c, m, opts));
  }

  // ask executes a freeform question over the loaded course context.
  async function ask(prompt: string): Promise<void> {
    await execute((c, m, opts) => askHanzo(prompt, c, m, opts));
  }

  // execute is the shared runner: require a loaded context, call the model, show the
  // result. Both the chips and freeform ask funnel through here (one path).
  async function execute(
    call: (
      c: CourseContext,
      m: CourseMeta,
      opts: { token: string; model: string; signal: AbortSignal },
    ) => Promise<string>,
  ): Promise<void> {
    if (!ctx || ctx.totalBlocks === 0) {
      setStatus('Load a course first (pick one and press Load).', 'warn');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    setStatus(contextNote(ctx));
    outputEl.value = '';
    try {
      const text = await call(ctx, meta, {
        token: bearer(),
        model: modelEl.value || DEFAULT_MODEL,
        signal: controller.signal,
      });
      outputEl.value = text;
      setStatus('Done.', 'ok');
    } catch (e: any) {
      if (e?.name === 'AbortError') setStatus('Stopped.');
      else setStatus(e?.message || 'Request failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // postComment writes the current output back to Canvas as a comment on the first
  // submitted student's submission — an explicit, documented write-back. Guarded: it
  // never posts an empty body and always confirms who it targeted.
  async function postComment(): Promise<void> {
    const body = outputEl.value.trim();
    const target = submissions.find((s) => s.workflowState && s.workflowState !== 'unsubmitted');
    if (!target) return setStatus('No submitted work to comment on.', 'warn');
    if (!body) return setStatus('Nothing to post — run an action or write feedback first.', 'warn');
    if (!confirm(`Post this as a comment on user ${target.userId}'s submission?`)) return;
    setBusy(true);
    setStatus('Posting comment to Canvas…');
    try {
      await client.postSubmissionComment(currentCourseId, currentAssignmentId, target.userId, body);
      setStatus(`Comment posted on user ${target.userId}'s submission.`, 'ok');
    } catch (e: any) {
      setStatus(e?.message || 'Comment failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // postAnnouncement writes the current output back as a course announcement. Canvas
  // needs a title + body; we take the first line of the result as the title and the
  // rest as the body, so a "subject line then body" draft posts cleanly.
  async function postAnnouncement(): Promise<void> {
    const text = outputEl.value.trim();
    if (!currentCourseId) return setStatus('Load a course first.', 'warn');
    if (!text) return setStatus('Nothing to post — draft an announcement first.', 'warn');
    const nl = text.indexOf('\n');
    const title = (nl === -1 ? text : text.slice(0, nl)).trim().slice(0, 200);
    const message = (nl === -1 ? text : text.slice(nl + 1)).trim() || text;
    if (!confirm(`Post a course announcement titled “${title}”?`)) return;
    setBusy(true);
    setStatus('Posting announcement to Canvas…');
    try {
      await client.createAnnouncement(currentCourseId, title, message);
      setStatus('Announcement posted.', 'ok');
    } catch (e: any) {
      setStatus(e?.message || 'Announcement failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- small DOM helpers ----------------------------------------------------

  let courses: Course[] = [];
  function courseMetaOf(course: Course): CourseMeta {
    return { name: course.name || undefined, courseCode: course.courseCode || undefined, term: course.termName || undefined };
  }
  function fillCourses(items: Course[]): void {
    courses = items;
    courseEl.innerHTML = '';
    for (const c of items) {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name || c.courseCode || `Course ${c.id}`;
      courseEl.appendChild(opt);
    }
    if (items.length && !currentCourseId) currentCourseId = String(items[0].id);
  }
  function fillAssignments(items: Assignment[]): void {
    assignmentEl.innerHTML = '';
    for (const a of items) {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = a.name || `Assignment ${a.id}`;
      assignmentEl.appendChild(opt);
    }
    currentAssignmentId = items.length ? String(items[0].id) : '';
  }

  async function populateModels(): Promise<void> {
    try {
      fillModels(await listModels({ token: bearer() }));
    } catch {
      fillModels([DEFAULT_MODEL]);
    }
  }
  function fillModels(ids: string[]): void {
    const list = ids.length ? ids : [DEFAULT_MODEL];
    modelEl.innerHTML = '';
    for (const id of list) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      modelEl.appendChild(opt);
    }
    if (list.includes(DEFAULT_MODEL)) modelEl.value = DEFAULT_MODEL;
  }

  function reflectAuth(): void {
    authHint.textContent = hasApiKey()
      ? 'Using your saved Hanzo key.'
      : 'No key saved — using public models. Paste an hk-… key for your org models.';
  }

  function setBusy(b: boolean): void {
    runBtn.disabled = b;
    stopBtn.disabled = !b;
    loadBtn.disabled = b;
    loadSubsBtn.disabled = b || assignments.length === 0;
    for (const c of Array.from(chipRow.querySelectorAll('button'))) (c as HTMLButtonElement).disabled = b;
    announceBtn.disabled = b || !currentCourseId;
    commentBtn.disabled = b || submissions.length === 0;
  }

  function setStatus(msg: string, kind: '' | 'ok' | 'warn' | 'error' = ''): void {
    statusEl.textContent = msg;
    statusEl.className = `status${kind ? ' ' + kind : ''}`;
  }
});
