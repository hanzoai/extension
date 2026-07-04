import { describe, it, expect } from 'vitest';
import {
  GitlabClient,
  getMRChanges,
  createMRNote,
  createIssueNote,
  addIssueLabels,
  listLabels,
  getNotes,
  encodeProject,
  type FetchLike,
} from '../src/gitlab-api.js';

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** A fake fetch recording every call and returning a scripted JSON body. */
function fakeFetch(dataFor: (url: string, method: string) => unknown): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: init?.headers, body: init?.body });
    const data = dataFor(url, method);
    return { ok: true, status: 200, text: async () => (data === undefined ? '' : JSON.stringify(data)) };
  };
  return { fetch, calls };
}

function client(fetch: FetchLike, baseURL = 'https://gitlab.com'): GitlabClient {
  return new GitlabClient({ baseURL, token: 'glpat-secret', fetch });
}

describe('encodeProject', () => {
  it('passes a numeric id through', () => {
    expect(encodeProject(42)).toBe('42');
  });

  it('url-encodes a namespace/project path', () => {
    expect(encodeProject('group/sub/proj')).toBe('group%2Fsub%2Fproj');
  });
});

describe('GitlabClient base URL normalization', () => {
  it('strips a trailing slash and an accidental /api/v4 suffix', async () => {
    const { fetch, calls } = fakeFetch(() => []);
    const c = new GitlabClient({ baseURL: 'https://gl.example.com/api/v4/', token: 't', fetch });
    await listLabels(c, 5);
    expect(calls[0].url).toBe('https://gl.example.com/api/v4/projects/5/labels?per_page=100');
  });

  it('sends the token as PRIVATE-TOKEN', async () => {
    const { fetch, calls } = fakeFetch(() => []);
    await listLabels(client(fetch), 5);
    expect(calls[0].headers?.['PRIVATE-TOKEN']).toBe('glpat-secret');
  });

  it('throws on a non-2xx response with status and body', async () => {
    const failing: FetchLike = async () => ({
      ok: false,
      status: 403,
      text: async () => '{"message":"403 Forbidden"}',
    });
    await expect(listLabels(client(failing), 5)).rejects.toThrow(/403/);
  });
});

describe('getMRChanges', () => {
  it('hits the changes endpoint and returns the changes array', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      changes: [{ old_path: 'a.ts', new_path: 'a.ts', diff: '+a' }],
    }));
    const changes = await getMRChanges(client(fetch), 'group/proj', 12);
    expect(changes).toHaveLength(1);
    expect(changes[0].new_path).toBe('a.ts');
    expect(calls[0].url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fproj/merge_requests/12/changes',
    );
    expect(calls[0].method).toBe('GET');
  });

  it('returns [] when the response lacks changes', async () => {
    const { fetch } = fakeFetch(() => ({}));
    expect(await getMRChanges(client(fetch), 1, 3)).toEqual([]);
  });
});

describe('createMRNote / createIssueNote', () => {
  it('POSTs a JSON note body to the MR notes endpoint', async () => {
    const { fetch, calls } = fakeFetch(() => ({}));
    await createMRNote(client(fetch), 7, 5, 'hello MR');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/7/merge_requests/5/notes');
    expect(calls[0].headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ body: 'hello MR' });
  });

  it('POSTs to the issue notes endpoint', async () => {
    const { fetch, calls } = fakeFetch(() => ({}));
    await createIssueNote(client(fetch), 7, 5, 'hello issue');
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/7/issues/5/notes');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ body: 'hello issue' });
  });
});

describe('addIssueLabels', () => {
  it('is a no-op for an empty list', async () => {
    const { fetch, calls } = fakeFetch(() => ({}));
    await addIssueLabels(client(fetch), 7, 5, []);
    expect(calls).toHaveLength(0);
  });

  it('PUTs add_labels as a comma-joined query, not clobbering existing', async () => {
    const { fetch, calls } = fakeFetch(() => ({}));
    await addIssueLabels(client(fetch), 7, 5, ['bug', 'crash']);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(
      'https://gitlab.com/api/v4/projects/7/issues/5?add_labels=bug%2Ccrash',
    );
  });
});

describe('listLabels', () => {
  it('returns label names only, fetching a single page of 100', async () => {
    const { fetch, calls } = fakeFetch(() => [{ name: 'bug' }, { name: 'crash' }, { id: 1 }]);
    expect(await listLabels(client(fetch), 3)).toEqual(['bug', 'crash']);
    expect(calls[0].url).toContain('per_page=100');
  });
});

describe('getNotes', () => {
  it('drops system notes and empties, returns author+body oldest-first', async () => {
    const { fetch, calls } = fakeFetch(() => [
      { author: { username: 'alice' }, body: 'first', system: false },
      { author: { username: 'root' }, body: 'changed the labels', system: true },
      { author: { username: 'bob' }, body: '   ', system: false },
      { author: { username: 'carol' }, body: 'third', system: false },
    ]);
    const out = await getNotes(client(fetch), 'group/proj', 'merge_requests', 5);
    expect(out).toEqual([
      { author: 'alice', body: 'first' },
      { author: 'carol', body: 'third' },
    ]);
    expect(calls[0].url).toContain('sort=asc');
    expect(calls[0].url).toContain('/merge_requests/5/notes');
  });
});
