import { describe, it, expect, vi } from 'vitest';
import { parseLaunchContext, proxyUrl, createProxyClient } from '../src/panel.js';

describe('panel: parseLaunchContext', () => {
  it('reads a plain course_id', () => {
    expect(parseLaunchContext('?course_id=370663')).toEqual({ courseId: '370663' });
  });
  it('accepts Canvas LTI custom-variable spellings and defaults to empty', () => {
    expect(parseLaunchContext('?custom_canvas_course_id=7')).toEqual({ courseId: '7' });
    expect(parseLaunchContext('?canvas_course_id=9')).toEqual({ courseId: '9' });
    expect(parseLaunchContext('')).toEqual({ courseId: '' });
  });
});

describe('panel: proxyUrl', () => {
  it('prefixes /proxy and appends a query, dropping empties', () => {
    expect(proxyUrl('', '/courses', { page: '', per_page: '100' })).toBe('/proxy/courses?per_page=100');
  });
  it('expands array values into Canvas key[]=v repetition', () => {
    expect(proxyUrl('', '/courses/1', { include: ['syllabus_body'] })).toBe(
      '/proxy/courses/1?include%5B%5D=syllabus_body',
    );
  });
  it('strips a trailing slash from the base', () => {
    expect(proxyUrl('https://canvas.hanzo.ai/', '/x')).toBe('https://canvas.hanzo.ai/proxy/x');
  });
});

// jsonResponse builds a fetch Response-like with an optional Link header.
function jsonResponse(body: unknown, link?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (link) headers.set('Link', link);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

// fetchMockOf wraps a responder in a fetch-typed mock so calls[i] carries the
// (url, init) arg tuple TypeScript expects.
function fetchMockOf(responder: () => Response) {
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(responder()));
}

describe('panel: createProxyClient — scoping + shaping', () => {
  it('sends credentials and returns parsed items with the next page from the Link header', async () => {
    const link = '<https://school.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next"';
    const fetchMock = fetchMockOf(() => jsonResponse([{ id: 1, name: 'Biology' }], link));
    const client = createProxyClient({ fetch: fetchMock as any });
    const { items, next } = await client.listCourses({ perPage: 100 });

    expect(items).toEqual([
      { id: 1, name: 'Biology', courseCode: '', workflowState: '', syllabusBody: '', termName: '' },
    ]);
    expect(next).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/courses?per_page=100');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('has no next page when the Link header omits a next relation', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse([]));
    const client = createProxyClient({ fetch: fetchMock as any });
    const { next } = await client.listCourses();
    expect(next).toBeUndefined();
  });

  it('gets a course with include[]=syllabus_body', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ id: 1, name: 'Biology', syllabus_body: '<p>Hi</p>' }));
    const client = createProxyClient({ fetch: fetchMock as any });
    const course = await client.getCourse(1);
    expect(course.syllabusBody).toBe('<p>Hi</p>');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/courses/1?include%5B%5D=syllabus_body');
  });

  it('lists submissions on the assignment path with comments included', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse([]));
    const client = createProxyClient({ fetch: fetchMock as any });
    await client.listSubmissions(100, 55, { page: 2 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/proxy/courses/100/assignments/55/submissions?include%5B%5D=submission_comments&page=2',
    );
  });

  it('postSubmissionComment PUTs the comment[text_comment] JSON body', async () => {
    const fetchMock = fetchMockOf(() => new Response('{}', { status: 200 }));
    const client = createProxyClient({ fetch: fetchMock as any });
    await client.postSubmissionComment(100, 55, 900, 'Nice work.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/courses/100/assignments/55/submissions/900');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ comment: { text_comment: 'Nice work.' } });
  });

  it('createAnnouncement POSTs a discussion topic flagged is_announcement', async () => {
    const fetchMock = fetchMockOf(() => new Response('{}', { status: 201 }));
    const client = createProxyClient({ fetch: fetchMock as any });
    await client.createAnnouncement(100, 'Heads up', 'Class is online Friday.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/courses/100/discussion_topics');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      title: 'Heads up',
      message: 'Class is online Friday.',
      is_announcement: true,
    });
  });

  it('surfaces a proxy error with status + message', async () => {
    const fetchMock = fetchMockOf(() => new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 }));
    const client = createProxyClient({ fetch: fetchMock as any });
    await expect(client.listCourses()).rejects.toThrow(/401.*not authenticated/);
  });
});
