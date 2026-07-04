import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PER_PAGE,
  pageParams,
  parseLinkHeader,
  pageOfUrl,
  nextPage,
  listCourses,
  getCourse,
  listAssignments,
  getAssignment,
  listSubmissions,
  getSubmission,
  postSubmissionComment,
  listDiscussions,
  createAnnouncement,
  listPages,
  getPage,
  listModules,
  listEnrollments,
  type Scope,
} from '../src/canvas-api.js';
import { apiBaseUrl } from '../src/config.js';

const scope: Scope = {
  apiBase: apiBaseUrl('school.instructure.com'),
  accessToken: 'at-123',
};

function q(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('api: pageParams', () => {
  it('emits nothing for no page', () => {
    expect(pageParams(undefined)).toEqual({});
  });
  it('emits page + per_page when set', () => {
    expect(pageParams({ page: 2, perPage: 50 })).toEqual({ page: '2', per_page: '50' });
  });
  it('clamps per_page to the documented max', () => {
    expect(pageParams({ perPage: 500 }).per_page).toBe(String(DEFAULT_PER_PAGE));
  });
  it('ignores non-positive values', () => {
    expect(pageParams({ page: 0, perPage: -5 })).toEqual({});
  });
});

describe('api: bearer scoping', () => {
  it('every read carries the Bearer token and no company header', () => {
    for (const req of [
      listCourses(scope),
      getCourse(scope, 7),
      listAssignments(scope, 7),
      getAssignment(scope, 7, 9),
      listSubmissions(scope, 7, 9),
      getSubmission(scope, 7, 9, 11),
      listDiscussions(scope, 7),
      listPages(scope, 7),
      getPage(scope, 7, 'intro'),
      listModules(scope, 7),
      listEnrollments(scope, 7),
    ]) {
      expect(req.headers.Authorization).toBe('Bearer at-123');
      expect(req.headers).not.toHaveProperty('Procore-Company-Id');
    }
  });
});

describe('api: courses', () => {
  it('lists courses with pagination and no course in the path', () => {
    const req = listCourses(scope, { page: 3, perPage: 25 });
    const url = new URL(req.url);
    expect(url.pathname).toBe('/api/v1/courses');
    expect(q(req.url).get('page')).toBe('3');
    expect(q(req.url).get('per_page')).toBe('25');
  });
  it('gets one course defaulting to include[]=syllabus_body', () => {
    const req = getCourse(scope, 100);
    expect(new URL(req.url).pathname).toBe('/api/v1/courses/100');
    expect(q(req.url).getAll('include[]')).toEqual(['syllabus_body']);
  });
  it('gets a bare course when includes are empty', () => {
    const req = getCourse(scope, 100, []);
    expect(q(req.url).has('include[]')).toBe(false);
  });
});

describe('api: assignments + submissions', () => {
  it('lists assignments on a course path', () => {
    expect(new URL(listAssignments(scope, 100).url).pathname).toBe('/api/v1/courses/100/assignments');
  });
  it('gets one assignment by id', () => {
    expect(new URL(getAssignment(scope, 100, 55).url).pathname).toBe('/api/v1/courses/100/assignments/55');
  });
  it('lists submissions with submission_comments included', () => {
    const req = listSubmissions(scope, 100, 55, { perPage: 50 });
    expect(new URL(req.url).pathname).toBe('/api/v1/courses/100/assignments/55/submissions');
    expect(q(req.url).getAll('include[]')).toEqual(['submission_comments']);
    expect(q(req.url).get('per_page')).toBe('50');
  });
  it('gets one submission by user id', () => {
    const req = getSubmission(scope, 100, 55, 900);
    expect(new URL(req.url).pathname).toBe('/api/v1/courses/100/assignments/55/submissions/900');
  });
});

describe('api: postSubmissionComment (the feedback write path)', () => {
  it('PUTs a comment[text_comment] JSON body on the submission', () => {
    const req = postSubmissionComment(scope, 100, 55, 900, 'Great analysis of the data.');
    expect(req.method).toBe('PUT');
    expect(new URL(req.url).pathname).toBe('/api/v1/courses/100/assignments/55/submissions/900');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers.Authorization).toBe('Bearer at-123');
    expect(JSON.parse(req.body)).toEqual({ comment: { text_comment: 'Great analysis of the data.' } });
  });
});

describe('api: createAnnouncement (the announcement write path)', () => {
  it('POSTs a discussion topic flagged is_announcement', () => {
    const req = createAnnouncement(scope, 100, 'Midterm moved', 'The midterm is now next Friday.');
    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toBe('/api/v1/courses/100/discussion_topics');
    expect(JSON.parse(req.body)).toEqual({
      title: 'Midterm moved',
      message: 'The midterm is now next Friday.',
      is_announcement: true,
    });
  });
});

describe('api: discussions / pages / modules / enrollments', () => {
  it('lists discussions on a course path', () => {
    expect(new URL(listDiscussions(scope, 100).url).pathname).toBe('/api/v1/courses/100/discussion_topics');
  });
  it('lists pages and gets one page by url slug', () => {
    expect(new URL(listPages(scope, 100).url).pathname).toBe('/api/v1/courses/100/pages');
    expect(new URL(getPage(scope, 100, 'week-1-intro').url).pathname).toBe('/api/v1/courses/100/pages/week-1-intro');
  });
  it('lists modules with items included', () => {
    const req = listModules(scope, 100);
    expect(new URL(req.url).pathname).toBe('/api/v1/courses/100/modules');
    expect(q(req.url).getAll('include[]')).toEqual(['items']);
  });
  it('lists enrollments on a course path', () => {
    expect(new URL(listEnrollments(scope, 100).url).pathname).toBe('/api/v1/courses/100/enrollments');
  });
});

describe('api: path segment encoding', () => {
  it('encodes ids/slugs defensively so a stray value cannot traverse the path', () => {
    const req = getPage(scope, 'a/b', 'c d');
    expect(req.url).toContain('/courses/a%2Fb/pages/c%20d');
  });
});

describe('api: parseLinkHeader (RFC 5988)', () => {
  const header =
    '<https://school.instructure.com/api/v1/courses?page=1&per_page=10>; rel="current", ' +
    '<https://school.instructure.com/api/v1/courses?page=2&per_page=10>; rel="next", ' +
    '<https://school.instructure.com/api/v1/courses?page=1&per_page=10>; rel="first", ' +
    '<https://school.instructure.com/api/v1/courses?page=17&per_page=10>; rel="last"';

  it('parses each relation URL from a Headers instance', () => {
    const links = parseLinkHeader(new Headers({ Link: header }));
    expect(links.current).toContain('page=1');
    expect(links.next).toBe('https://school.instructure.com/api/v1/courses?page=2&per_page=10');
    expect(links.first).toContain('page=1');
    expect(links.last).toContain('page=17');
  });

  it('parses from a plain header map (either case)', () => {
    expect(parseLinkHeader({ Link: header }).next).toContain('page=2');
    expect(parseLinkHeader({ link: header }).last).toContain('page=17');
  });

  it('returns {} for a missing/blank header', () => {
    expect(parseLinkHeader({})).toEqual({});
    expect(parseLinkHeader(new Headers())).toEqual({});
  });

  it('tolerates a last-page header with no next relation', () => {
    const last =
      '<https://school.instructure.com/api/v1/courses?page=16&per_page=10>; rel="prev", ' +
      '<https://school.instructure.com/api/v1/courses?page=17&per_page=10>; rel="current"';
    const links = parseLinkHeader({ Link: last });
    expect(links.next).toBeUndefined();
    expect(links.prev).toContain('page=16');
  });
});

describe('api: pageOfUrl + nextPage', () => {
  it('extracts the page number from a pagination URL', () => {
    expect(pageOfUrl('https://h/api/v1/courses?page=2&per_page=10')).toBe(2);
    expect(pageOfUrl('https://h/api/v1/courses?per_page=10')).toBeUndefined();
    expect(pageOfUrl(undefined)).toBeUndefined();
  });
  it('nextPage reads the next relation into a page number', () => {
    expect(nextPage({ next: 'https://h/api/v1/courses?page=3' })).toBe(3);
    expect(nextPage({})).toBeUndefined();
  });
});
