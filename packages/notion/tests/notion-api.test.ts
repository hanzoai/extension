import { describe, it, expect, vi } from 'vitest';
import {
  retrieveBlockChildren,
  appendChildren,
  retrievePage,
  createPage,
  retrieveDatabase,
  queryDatabase,
  search,
  readListPage,
  notionFetch,
  paginate,
  NOTION_MAX_PAGE_SIZE,
} from '../src/notion-api';
import { NOTION_VERSION } from '../src/config';

const TOK = 'secret_bot';
const root = 'https://api.notion.com/v1';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe('read wrappers', () => {
  it('retrieveBlockChildren builds GET with auth + version, no page params by default', () => {
    const req = retrieveBlockChildren({ token: TOK, blockId: 'PAGE' });
    expect(req).toMatchObject({ url: `${root}/blocks/PAGE/children`, method: 'GET' });
    expect(req.headers.Authorization).toBe(`Bearer ${TOK}`);
    expect(req.headers['Notion-Version']).toBe(NOTION_VERSION);
    expect(req.headers['Content-Type']).toBeUndefined();
  });

  it('retrieveBlockChildren adds start_cursor + capped page_size', () => {
    const req = retrieveBlockChildren({ token: TOK, blockId: 'B', startCursor: 'cur', pageSize: 500 });
    const u = new URL(req.url);
    expect(u.searchParams.get('start_cursor')).toBe('cur');
    expect(u.searchParams.get('page_size')).toBe(String(NOTION_MAX_PAGE_SIZE));
  });

  it('retrievePage + retrieveDatabase target the right paths', () => {
    expect(retrievePage({ token: TOK, pageId: 'P1' }).url).toBe(`${root}/pages/P1`);
    expect(retrieveDatabase({ token: TOK, databaseId: 'D1' }).url).toBe(`${root}/databases/D1`);
  });
});

describe('write wrappers', () => {
  it('appendChildren PATCHes children under a page and JSON-content-types', () => {
    const kids = [{ type: 'paragraph' }];
    const req = appendChildren({ token: TOK, blockId: 'PAGE', children: kids });
    expect(req).toMatchObject({ url: `${root}/blocks/PAGE/children`, method: 'PATCH' });
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(req.body!)).toEqual({ children: kids });
  });

  it('appendChildren carries an `after` anchor when given', () => {
    const req = appendChildren({ token: TOK, blockId: 'PAGE', children: [], after: 'BLK' });
    expect(JSON.parse(req.body!).after).toBe('BLK');
  });

  it('createPage posts parent + properties (database row)', () => {
    const req = createPage({
      token: TOK,
      parent: { database_id: 'DB' },
      properties: { Name: { title: [] } },
    });
    expect(req).toMatchObject({ url: `${root}/pages`, method: 'POST' });
    const body = JSON.parse(req.body!);
    expect(body.parent).toEqual({ database_id: 'DB' });
    expect(body.properties).toEqual({ Name: { title: [] } });
    expect(body.children).toBeUndefined();
  });

  it('createPage includes children only when non-empty', () => {
    const req = createPage({
      token: TOK,
      parent: { page_id: 'P' },
      properties: {},
      children: [{ type: 'paragraph' }],
    });
    expect(JSON.parse(req.body!).children).toHaveLength(1);
  });
});

describe('body-paginated wrappers', () => {
  it('queryDatabase puts filter/sorts/cursor in the JSON body', () => {
    const req = queryDatabase({
      token: TOK,
      databaseId: 'DB',
      filter: { property: 'Done', checkbox: { equals: false } },
      sorts: [{ property: 'Due', direction: 'ascending' }],
      startCursor: 'c1',
      pageSize: 25,
    });
    expect(req).toMatchObject({ url: `${root}/databases/DB/query`, method: 'POST' });
    const body = JSON.parse(req.body!);
    expect(body.filter).toEqual({ property: 'Done', checkbox: { equals: false } });
    expect(body.sorts).toHaveLength(1);
    expect(body.start_cursor).toBe('c1');
    expect(body.page_size).toBe(25);
  });

  it('search wraps the object filter in Notion’s { value, property } shape', () => {
    const req = search({ token: TOK, query: 'roadmap', filterObject: 'page' });
    expect(req).toMatchObject({ url: `${root}/search`, method: 'POST' });
    const body = JSON.parse(req.body!);
    expect(body.query).toBe('roadmap');
    expect(body.filter).toEqual({ value: 'page', property: 'object' });
  });

  it('search omits query/filter when not given', () => {
    const body = JSON.parse(search({ token: TOK }).body!);
    expect(body.query).toBeUndefined();
    expect(body.filter).toBeUndefined();
  });
});

describe('readListPage', () => {
  it('extracts results + paging', () => {
    const page = readListPage({ results: [1, 2], has_more: true, next_cursor: 'nx' });
    expect(page.results).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('nx');
  });

  it('defaults missing fields safely', () => {
    const page = readListPage({});
    expect(page.results).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBe('');
  });

  it('throws on Notion’s error envelope', () => {
    expect(() => readListPage({ object: 'error', code: 'unauthorized', message: 'bad token' })).toThrow(
      /Notion API error: bad token/,
    );
  });
});

describe('notionFetch', () => {
  it('parses JSON on ok', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    const req = retrievePage({ token: TOK, pageId: 'P' });
    await expect(notionFetch(req, doFetch as any)).resolves.toEqual({ ok: 1 });
    expect(doFetch).toHaveBeenCalledWith(req.url, {
      method: 'GET',
      headers: req.headers,
      body: undefined,
    });
  });

  it('surfaces Notion’s message on non-ok', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ message: 'object not found' }, false, 404));
    await expect(notionFetch(retrievePage({ token: TOK, pageId: 'X' }), doFetch as any)).rejects.toThrow(
      /Notion API 404: object not found/,
    );
  });

  it('reports a non-JSON body with the status', async () => {
    const bad = { ok: false, status: 502, text: async () => '<html>bad gateway</html>' } as unknown as Response;
    const doFetch = vi.fn().mockResolvedValue(bad);
    await expect(notionFetch(retrievePage({ token: TOK, pageId: 'X' }), doFetch as any)).rejects.toThrow(
      /Notion API 502/,
    );
  });
});

describe('paginate', () => {
  it('walks every page via has_more/next_cursor and collects all results', async () => {
    const pages = [
      { results: ['a', 'b'], has_more: true, next_cursor: 'c1' },
      { results: ['c'], has_more: true, next_cursor: 'c2' },
      { results: ['d'], has_more: false, next_cursor: null },
    ];
    let i = 0;
    const doFetch = vi.fn().mockImplementation(async () => jsonResponse(pages[i++]));
    const seen: (string | undefined)[] = [];
    const all = await paginate<string>(
      (cursor) => {
        seen.push(cursor);
        return retrieveBlockChildren({ token: TOK, blockId: 'P', startCursor: cursor });
      },
      { doFetch: doFetch as any },
    );
    expect(all).toEqual(['a', 'b', 'c', 'd']);
    expect(seen).toEqual([undefined, 'c1', 'c2']); // cursor threads forward
  });

  it('stops at maxPages even if has_more stays true', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: ['x'], has_more: true, next_cursor: 'loop' }));
    const all = await paginate<string>(() => retrieveBlockChildren({ token: TOK, blockId: 'P' }), {
      doFetch: doFetch as any,
      maxPages: 3,
    });
    expect(all).toEqual(['x', 'x', 'x']);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });
});
