// Browser-side panel helpers — PURE where it counts (launch-context parsing +
// proxy-request shaping), so the impure DOM wiring in app.ts stays thin and the logic
// is unit-tested. The panel reaches Canvas ONLY through the server proxy (config:
// same-origin /proxy/*), which injects the OAuth Bearer + refreshes it; the browser
// never holds a Canvas token.

import {
  parseCourses,
  parseCourse,
  parseAssignments,
  parseAssignment,
  parseSubmissions,
  parseSubmission,
  parseDiscussions,
  parsePages,
  parsePage,
  parseModules,
  parseEnrollments,
  parseLinkHeader,
  nextPage,
  pageParams,
  type Course,
  type Assignment,
  type Submission,
  type Discussion,
  type Page_,
  type Module,
  type Enrollment,
  type Page,
} from './canvas-api.js';

// The launch context: when Canvas embeds this app (via LTI or a course-nav link) it
// passes the course in the URL query. The panel reads it so it opens already scoped.
// Optional — without it the user picks from the course list.
export interface LaunchContext {
  courseId: string;
}

// parseLaunchContext reads a course id from a location search string, accepting the
// plain `course_id` and Canvas's LTI custom-variable spellings. Pure — unit-tested
// with plain strings.
export function parseLaunchContext(search: string): LaunchContext {
  const q = new URLSearchParams(search);
  return {
    courseId:
      q.get('course_id') ??
      q.get('canvas_course_id') ??
      q.get('custom_canvas_course_id') ??
      q.get('courseId') ??
      '',
  };
}

// A parsed list result: the typed items plus the page number to request next (from
// the Link header's `rel="next"`), or undefined on the last page.
export interface ListResult<T> {
  items: T[];
  next?: number;
}

// The panel's Canvas client: reads through the same-origin server proxy. Every call
// rides the session cookie (credentials: 'include'); the proxy injects the Bearer.
// Pure over an injected fetch + base, so request shaping is unit-testable.
export interface ProxyClient {
  listCourses(page?: Page): Promise<ListResult<Course>>;
  getCourse(courseId: number | string): Promise<Course>;
  listAssignments(courseId: number | string, page?: Page): Promise<ListResult<Assignment>>;
  getAssignment(courseId: number | string, assignmentId: number | string): Promise<Assignment>;
  listSubmissions(
    courseId: number | string,
    assignmentId: number | string,
    page?: Page,
  ): Promise<ListResult<Submission>>;
  getSubmission(
    courseId: number | string,
    assignmentId: number | string,
    userId: number | string,
  ): Promise<Submission>;
  listDiscussions(courseId: number | string, page?: Page): Promise<ListResult<Discussion>>;
  listPages(courseId: number | string, page?: Page): Promise<ListResult<Page_>>;
  getPage(courseId: number | string, urlOrId: number | string): Promise<Page_>;
  listModules(courseId: number | string, page?: Page): Promise<ListResult<Module>>;
  listEnrollments(courseId: number | string, page?: Page): Promise<ListResult<Enrollment>>;
  postSubmissionComment(
    courseId: number | string,
    assignmentId: number | string,
    userId: number | string,
    text: string,
  ): Promise<void>;
  createAnnouncement(courseId: number | string, title: string, message: string): Promise<void>;
}

export interface ProxyClientOptions {
  /** Proxy base (defaults to same-origin ''). The REST path is appended after /proxy. */
  base?: string;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

// proxyUrl builds a same-origin proxy URL for a REST path + query, expanding array
// values into Canvas's `key[]=v` repetition. Normalizes the base (drops a trailing
// slash) so this is the ONE place base+path joining happens. Pure so tests assert the
// exact shape (…/proxy/courses?per_page=100).
export function proxyUrl(
  base: string,
  restPath: string,
  query: Record<string, string | string[] | undefined> = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) if (item !== undefined && item !== '') q.append(`${k}[]`, item);
    } else if (v !== undefined && v !== '') {
      q.set(k, v);
    }
  }
  const qs = q.toString();
  return `${base.replace(/\/+$/, '')}/proxy${restPath}${qs ? `?${qs}` : ''}`;
}

// createProxyClient returns a ProxyClient. The cookie credentials are attached once
// here so every method stays a one-liner. List methods parse the Link header into the
// next page number so a caller can page through the proxy without following Canvas's
// absolute URLs.
export function createProxyClient(opts: ProxyClientOptions = {}): ProxyClient {
  const base = opts.base ?? ''; // proxyUrl normalizes the trailing slash
  const doFetch = opts.fetch ?? fetch;

  async function getJson(
    restPath: string,
    query: Record<string, string | string[] | undefined>,
  ): Promise<{ data: any; next?: number }> {
    const resp = await doFetch(proxyUrl(base, restPath, query), { credentials: 'include' });
    if (!resp.ok) throw new Error(await proxyError(resp));
    return { data: await resp.json(), next: nextPage(parseLinkHeader(resp.headers)) };
  }

  async function write(restPath: string, method: 'POST' | 'PUT', body: unknown): Promise<void> {
    const resp = await doFetch(proxyUrl(base, restPath), {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(await proxyError(resp));
  }

  return {
    async listCourses(page?) {
      const { data, next } = await getJson('/courses', pageParams(page));
      return { items: parseCourses(data), next };
    },
    async getCourse(courseId) {
      const { data } = await getJson(`/courses/${enc(courseId)}`, { include: ['syllabus_body'] });
      return parseCourse(data);
    },
    async listAssignments(courseId, page?) {
      const { data, next } = await getJson(`/courses/${enc(courseId)}/assignments`, pageParams(page));
      return { items: parseAssignments(data), next };
    },
    async getAssignment(courseId, assignmentId) {
      const { data } = await getJson(
        `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}`,
        {},
      );
      return parseAssignment(data);
    },
    async listSubmissions(courseId, assignmentId, page?) {
      const { data, next } = await getJson(
        `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}/submissions`,
        { include: ['submission_comments'], ...pageParams(page) },
      );
      return { items: parseSubmissions(data), next };
    },
    async getSubmission(courseId, assignmentId, userId) {
      const { data } = await getJson(
        `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}/submissions/${enc(userId)}`,
        { include: ['submission_comments'] },
      );
      return parseSubmission(data);
    },
    async listDiscussions(courseId, page?) {
      const { data, next } = await getJson(
        `/courses/${enc(courseId)}/discussion_topics`,
        pageParams(page),
      );
      return { items: parseDiscussions(data), next };
    },
    async listPages(courseId, page?) {
      const { data, next } = await getJson(`/courses/${enc(courseId)}/pages`, pageParams(page));
      return { items: parsePages(data), next };
    },
    async getPage(courseId, urlOrId) {
      const { data } = await getJson(`/courses/${enc(courseId)}/pages/${enc(urlOrId)}`, {});
      return parsePage(data);
    },
    async listModules(courseId, page?) {
      const { data, next } = await getJson(`/courses/${enc(courseId)}/modules`, {
        include: ['items'],
        ...pageParams(page),
      });
      return { items: parseModules(data), next };
    },
    async listEnrollments(courseId, page?) {
      const { data, next } = await getJson(
        `/courses/${enc(courseId)}/enrollments`,
        pageParams(page),
      );
      return { items: parseEnrollments(data), next };
    },
    async postSubmissionComment(courseId, assignmentId, userId, text) {
      await write(
        `/courses/${enc(courseId)}/assignments/${enc(assignmentId)}/submissions/${enc(userId)}`,
        'PUT',
        { comment: { text_comment: text } },
      );
    },
    async createAnnouncement(courseId, title, message) {
      await write(`/courses/${enc(courseId)}/discussion_topics`, 'POST', {
        title,
        message,
        is_announcement: true,
      });
    },
  };
}

// proxyError extracts a readable message from a non-2xx proxy response.
async function proxyError(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return `Canvas proxy ${resp.status}: ${j?.error || j?.message || text.slice(0, 200)}`;
  } catch {
    return `Canvas proxy ${resp.status}: ${text.slice(0, 200) || 'request failed'}`;
  }
}

function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}
