// Canvas REST API v1 — pure request shaping + response parsing. Every function
// returns a PreparedRequest (url + headers [+ body]) or parses a response body;
// none opens a socket, so the whole API surface is unit-testable without a
// network. server.ts is the thin glue that fetches these shapes with the OAuth
// Bearer access token.
//
// The REST root is `https://{host}/api/v1` (see config.apiBaseUrl). Canvas scopes
// reads/writes by the authorizing user's Bearer token; course-scoped resources
// take the course id in the path (…/courses/{id}/…). Docs:
// canvas.instructure.com/doc/api/courses.html, assignments.html, submissions.html,
// discussion_topics.html, pages.html, modules.html, enrollments.html.

// A prepared GET: url + headers a single fetch needs (Bearer only).
export interface PreparedGet {
  url: string;
  headers: Record<string, string>;
}

// A prepared write (POST/PUT): adds the JSON body and Content-Type. Canvas accepts
// a JSON body (Content-Type: application/json) for these endpoints; we use it so
// nested params stay structured rather than form-bracket-encoded.
export interface PreparedWrite extends PreparedGet {
  method: 'POST' | 'PUT';
  body: string;
}

// headers builds the auth header set common to every request.
function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// jsonHeaders adds Content-Type for a write body on top of the auth header.
function jsonHeaders(accessToken: string): Record<string, string> {
  return { ...headers(accessToken), 'Content-Type': 'application/json' };
}

// The scope every request carries: which REST root and which bearer. Grouping them
// keeps every wrapper's signature small.
export interface Scope {
  apiBase: string;
  accessToken: string;
}

// Pagination controls. Canvas paginates with page (1-based) + per_page and returns
// the page relations (next/prev/first/last) in the RFC 5988 `Link` response header
// (parsed by the caller with parseLinkHeader). We attach these as query params on
// list endpoints.
export interface Page {
  page?: number;
  perPage?: number;
}

// DEFAULT_PER_PAGE is Canvas's documented maximum page size; 100 minimises
// round-trips (Canvas's own default is only 10).
export const DEFAULT_PER_PAGE = 100;

// pageParams renders pagination into query pairs, clamping per_page to the
// documented maximum. Only emits params that are set, so an unpaginated call stays
// clean. Pure — unit-tested.
export function pageParams(page: Page | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!page) return out;
  if (typeof page.page === 'number' && page.page > 0) out.page = String(Math.floor(page.page));
  if (typeof page.perPage === 'number' && page.perPage > 0) {
    out.per_page = String(Math.min(Math.floor(page.perPage), DEFAULT_PER_PAGE));
  }
  return out;
}

// A repeated query param, e.g. Canvas's `include[]=syllabus_body`. buildUrl expands
// an array value into one pair per element with a trailing `[]` on the key.
type Query = Record<string, string | string[] | undefined>;

// buildUrl joins the REST root + path and appends a query string, dropping
// undefined/empty values and expanding arrays into Canvas's `key[]=v` repetition.
// One place builds every URL so scoping/pagination params are applied
// consistently. Pure.
function buildUrl(apiBase: string, path: string, query: Query = {}): string {
  const base = `${apiBase.replace(/\/+$/, '')}${path}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) if (item !== undefined && item !== '') q.append(`${k}[]`, item);
    } else if (v !== undefined && v !== '') {
      q.set(k, v);
    }
  }
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

// enc encodes a single path segment (ids are integers and page urls are slugs, but
// we encode defensively so a stray value can never break — or traverse — the path).
function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}

// ---- Courses --------------------------------------------------------------

// listCourses — the courses the authorizing user can see. Bearer scope only (no
// course in the path). The panel's picker uses this to choose which course to run
// against.
export function listCourses(scope: Scope, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, '/courses', pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// getCourse — one course. `includes` maps to Canvas `include[]` associations; we
// default to `syllabus_body` (an HTML syllabus) since the summarize-course action
// grounds on it. Pass `[]` to fetch the bare course.
export function getCourse(
  scope: Scope,
  courseId: number | string,
  includes: readonly string[] = ['syllabus_body'],
): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}`, {
      include: includes.length ? [...includes] : undefined,
    }),
    headers: headers(scope.accessToken),
  };
}

// ---- Assignments ----------------------------------------------------------

// listAssignments — the assignments in a course. Course-scoped path.
export function listAssignments(scope: Scope, courseId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/assignments`, pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// getAssignment — one assignment in full (description, due date, points, submission
// types). This is what the feedback/question actions read.
export function getAssignment(
  scope: Scope,
  courseId: number | string,
  assignmentId: number | string,
): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}`),
    headers: headers(scope.accessToken),
  };
}

// ---- Submissions ----------------------------------------------------------

// listSubmissions — the submissions for an assignment. Course + assignment scoped
// path; `include[]=submission_comments` so existing comments come along for the
// summarize/feedback context.
export function listSubmissions(
  scope: Scope,
  courseId: number | string,
  assignmentId: number | string,
  page?: Page,
): PreparedGet {
  return {
    url: buildUrl(
      scope.apiBase,
      `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}/submissions`,
      { include: ['submission_comments'], ...pageParams(page) },
    ),
    headers: headers(scope.accessToken),
  };
}

// getSubmission — one student's submission (by user id) with its comment thread.
export function getSubmission(
  scope: Scope,
  courseId: number | string,
  assignmentId: number | string,
  userId: number | string,
): PreparedGet {
  return {
    url: buildUrl(
      scope.apiBase,
      `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}/submissions/${enc(userId)}`,
      { include: ['submission_comments'] },
    ),
    headers: headers(scope.accessToken),
  };
}

// postSubmissionComment — add a text comment to a student's submission. Canvas
// models a submission comment as an UPDATE to the submission (PUT
// …/submissions/{user_id} with a `comment[text_comment]`), not a separate comments
// collection — this is the ONE feedback write path, behind an explicit action.
// Returns a PreparedWrite (PUT + JSON body).
export function postSubmissionComment(
  scope: Scope,
  courseId: number | string,
  assignmentId: number | string,
  userId: number | string,
  text: string,
): PreparedWrite {
  return {
    method: 'PUT',
    url: buildUrl(
      scope.apiBase,
      `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}/submissions/${enc(userId)}`,
    ),
    headers: jsonHeaders(scope.accessToken),
    body: JSON.stringify({ comment: { text_comment: text } }),
  };
}

// ---- Discussions ----------------------------------------------------------

// listDiscussions — the discussion topics in a course (announcements included when
// they are discussion-backed). Course-scoped path.
export function listDiscussions(scope: Scope, courseId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/discussion_topics`, pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// createAnnouncement — post a course announcement. In Canvas an announcement is a
// discussion topic with `is_announcement: true` (POST …/discussion_topics) — the
// second gated write path. Returns a PreparedWrite (POST + JSON body).
export function createAnnouncement(
  scope: Scope,
  courseId: number | string,
  title: string,
  message: string,
): PreparedWrite {
  return {
    method: 'POST',
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/discussion_topics`),
    headers: jsonHeaders(scope.accessToken),
    body: JSON.stringify({ title, message, is_announcement: true }),
  };
}

// ---- Pages ----------------------------------------------------------------

// listPages — the wiki pages in a course. Course-scoped path.
export function listPages(scope: Scope, courseId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/pages`, pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// getPage — one wiki page in full (its HTML body). Canvas addresses a page by its
// url slug or page id.
export function getPage(
  scope: Scope,
  courseId: number | string,
  urlOrId: number | string,
): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/pages/${enc(urlOrId)}`),
    headers: headers(scope.accessToken),
  };
}

// ---- Modules --------------------------------------------------------------

// listModules — the modules in a course, with their items inlined
// (`include[]=items`) so the course-overview context sees the module structure.
export function listModules(scope: Scope, courseId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/modules`, {
      include: ['items'],
      ...pageParams(page),
    }),
    headers: headers(scope.accessToken),
  };
}

// ---- Enrollments ----------------------------------------------------------

// listEnrollments — the enrollments in a course (who is a student / teacher / TA).
export function listEnrollments(scope: Scope, courseId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/courses/${enc(courseId)}/enrollments`, pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// ---- Pagination header (RFC 5988 Link) ------------------------------------

// The page relations Canvas returns in the `Link` header — each an absolute URL.
export interface CanvasLinks {
  current?: string;
  next?: string;
  prev?: string;
  first?: string;
  last?: string;
}

// parseLinkHeader reads Canvas's RFC 5988 `Link` header into the page relations.
// Canvas returns entries like `<https://host/api/v1/courses?page=2&per_page=100>;
// rel="next"`. Accepts a Headers instance or a plain header map so it works against
// fetch Responses and test fixtures alike. Returns {} for a missing header. Pure.
export function parseLinkHeader(
  h: Headers | Record<string, string | string[] | undefined>,
): CanvasLinks {
  const raw =
    typeof (h as Headers)?.get === 'function'
      ? (h as Headers).get('Link') ?? (h as Headers).get('link')
      : (h as Record<string, string | string[] | undefined>).Link ??
        (h as Record<string, string | string[] | undefined>).link;
  const val = Array.isArray(raw) ? raw.join(', ') : raw;
  const links: CanvasLinks = {};
  if (!val) return links;
  for (const part of String(val).split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?([^"\s;]+)"?/i);
    if (!m) continue;
    const rel = m[2].toLowerCase();
    if (rel === 'current' || rel === 'next' || rel === 'prev' || rel === 'first' || rel === 'last') {
      links[rel] = m[1];
    }
  }
  return links;
}

// pageOfUrl extracts the 1-based `page` query param from a Canvas pagination URL
// (the relations in parseLinkHeader carry absolute URLs). Returns undefined when
// absent/unparseable. Pure — lets a same-origin proxy client re-request the next
// page by number without following Canvas's absolute URL directly.
export function pageOfUrl(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const m = url.match(/[?&]page=([^&]+)/);
  if (!m) return undefined;
  const n = Number.parseInt(decodeURIComponent(m[1]), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// nextPage is the page number to request for the next page, or undefined when
// there is no `next` relation (the last page). Pure — the ONE way the panel decides
// whether to keep paginating.
export function nextPage(links: CanvasLinks): number | undefined {
  return pageOfUrl(links.next);
}

// ---- Response parsing -----------------------------------------------------
//
// Canvas list endpoints return a bare JSON array of records; detail endpoints
// return one object. We normalize the snake_case wire fields we surface into small
// typed shapes at this boundary so nothing downstream touches the wire. Text bodies
// (syllabus, page body, assignment description, discussion message) are Canvas HTML;
// we keep them raw here and strip to plain text in course.ts (htmlToText) at render.

function arrayOf(data: any, key?: string): any[] {
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data?.[key])) return data[key];
  return [];
}

// One course as it appears in listCourses / getCourse.
export interface Course {
  id: number;
  name: string;
  courseCode: string;
  workflowState: string;
  syllabusBody: string;
  termName: string;
}

export function parseCourse(data: any): Course {
  return {
    id: Number(data?.id ?? 0),
    name: String(data?.name ?? ''),
    courseCode: String(data?.course_code ?? ''),
    workflowState: String(data?.workflow_state ?? ''),
    syllabusBody: String(data?.syllabus_body ?? ''),
    termName: String(data?.term?.name ?? data?.enrollment_term_id ?? ''),
  };
}

export function parseCourses(data: any): Course[] {
  return arrayOf(data, 'courses')
    .map(parseCourse)
    .filter((c) => c.id > 0);
}

// One assignment.
export interface Assignment {
  id: number;
  name: string;
  description: string;
  dueAt: string;
  pointsPossible: number;
  submissionTypes: string[];
}

export function parseAssignment(data: any): Assignment {
  return {
    id: Number(data?.id ?? 0),
    name: String(data?.name ?? ''),
    description: String(data?.description ?? ''),
    dueAt: String(data?.due_at ?? ''),
    pointsPossible: Number(data?.points_possible ?? 0),
    submissionTypes: Array.isArray(data?.submission_types)
      ? data.submission_types.map((s: any) => String(s))
      : [],
  };
}

export function parseAssignments(data: any): Assignment[] {
  return arrayOf(data, 'assignments')
    .map(parseAssignment)
    .filter((a) => a.id > 0);
}

// One comment within a submission's thread.
export interface SubmissionComment {
  id: number;
  authorName: string;
  comment: string;
  createdAt: string;
}

function parseSubmissionComment(c: any): SubmissionComment {
  return {
    id: Number(c?.id ?? 0),
    authorName: String(c?.author_name ?? c?.author?.display_name ?? ''),
    comment: String(c?.comment ?? ''),
    createdAt: String(c?.created_at ?? ''),
  };
}

// One student submission.
export interface Submission {
  id: number;
  userId: number;
  assignmentId: number;
  body: string;
  submittedAt: string;
  workflowState: string;
  score: number | null;
  grade: string;
  late: boolean;
  missing: boolean;
  comments: SubmissionComment[];
}

export function parseSubmission(data: any): Submission {
  return {
    id: Number(data?.id ?? 0),
    userId: Number(data?.user_id ?? 0),
    assignmentId: Number(data?.assignment_id ?? 0),
    body: String(data?.body ?? ''),
    submittedAt: String(data?.submitted_at ?? ''),
    workflowState: String(data?.workflow_state ?? ''),
    score: typeof data?.score === 'number' ? data.score : null,
    grade: data?.grade === null || data?.grade === undefined ? '' : String(data.grade),
    late: data?.late === true,
    missing: data?.missing === true,
    comments: Array.isArray(data?.submission_comments)
      ? data.submission_comments.map(parseSubmissionComment)
      : [],
  };
}

export function parseSubmissions(data: any): Submission[] {
  return arrayOf(data, 'submissions')
    .map(parseSubmission)
    .filter((s) => s.id > 0 || s.userId > 0);
}

// One discussion topic.
export interface Discussion {
  id: number;
  title: string;
  message: string;
  postedAt: string;
  isAnnouncement: boolean;
}

export function parseDiscussion(data: any): Discussion {
  return {
    id: Number(data?.id ?? 0),
    title: String(data?.title ?? ''),
    message: String(data?.message ?? ''),
    postedAt: String(data?.posted_at ?? ''),
    isAnnouncement: data?.is_announcement === true,
  };
}

export function parseDiscussions(data: any): Discussion[] {
  return arrayOf(data, 'discussion_topics')
    .map(parseDiscussion)
    .filter((d) => d.id > 0);
}

// One wiki page. The list omits the body; the detail (getPage) carries it.
export interface Page_ {
  pageId: number;
  url: string;
  title: string;
  body: string;
  updatedAt: string;
}

export function parsePage(data: any): Page_ {
  return {
    pageId: Number(data?.page_id ?? 0),
    url: String(data?.url ?? ''),
    title: String(data?.title ?? ''),
    body: String(data?.body ?? ''),
    updatedAt: String(data?.updated_at ?? ''),
  };
}

export function parsePages(data: any): Page_[] {
  return arrayOf(data, 'pages')
    .map(parsePage)
    .filter((p) => p.pageId > 0 || p.url.length > 0);
}

// One module item (a page, assignment, quiz, file, external link, …).
export interface ModuleItem {
  id: number;
  title: string;
  type: string;
  position: number;
}

// One course module, with its items when Canvas inlined them.
export interface Module {
  id: number;
  name: string;
  position: number;
  items: ModuleItem[];
}

function parseModuleItem(i: any): ModuleItem {
  return {
    id: Number(i?.id ?? 0),
    title: String(i?.title ?? ''),
    type: String(i?.type ?? ''),
    position: Number(i?.position ?? 0),
  };
}

export function parseModule(data: any): Module {
  return {
    id: Number(data?.id ?? 0),
    name: String(data?.name ?? ''),
    position: Number(data?.position ?? 0),
    items: Array.isArray(data?.items) ? data.items.map(parseModuleItem) : [],
  };
}

export function parseModules(data: any): Module[] {
  return arrayOf(data, 'modules')
    .map(parseModule)
    .filter((m) => m.id > 0);
}

// One enrollment (a person's role in the course).
export interface Enrollment {
  id: number;
  userId: number;
  userName: string;
  type: string;
  role: string;
  state: string;
}

export function parseEnrollment(data: any): Enrollment {
  return {
    id: Number(data?.id ?? 0),
    userId: Number(data?.user_id ?? 0),
    userName: String(data?.user?.name ?? data?.user?.short_name ?? ''),
    type: String(data?.type ?? ''),
    role: String(data?.role ?? ''),
    state: String(data?.enrollment_state ?? ''),
  };
}

export function parseEnrollments(data: any): Enrollment[] {
  return arrayOf(data, 'enrollments')
    .map(parseEnrollment)
    .filter((e) => e.id > 0);
}
