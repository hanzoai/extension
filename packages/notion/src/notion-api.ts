// Notion REST API v1 client. Every wrapper is PURE request-shaping — it returns
// the { url, method, headers, body } a caller will fetch, so the wire contract
// (path, JSON body, pagination) is unit-testable without a network. `notionFetch`
// at the bottom is the one thin place that actually hits the network and surfaces
// Notion's error shape.
//
// Notion conventions this encodes:
//  - Bearer token auth; `Notion-Version` header pins the response shape.
//  - Reads that can return many items paginate via a request `start_cursor` +
//    `page_size`; the response carries `has_more` + `next_cursor`. For block
//    children this is a query string; for search/query-database it is a body field.
//  - Block children are fetched with `GET /v1/blocks/{id}/children` and appended
//    with `PATCH /v1/blocks/{id}/children { children: [...] }`.
//  - Rows are created with `POST /v1/pages { parent: {database_id}, properties }`.

import { notionApiRoot, NOTION_VERSION } from './config.js';

export interface NotionRequest {
  url: string;
  method: 'GET' | 'POST' | 'PATCH';
  headers: Record<string, string>;
  body?: string;
}

/** Notion caps a single children fetch/append at 100 items. */
export const NOTION_MAX_PAGE_SIZE = 100;

// baseHeaders — auth + version on every call. JSON content-type is added only
// for writes (a GET has no body).
function baseHeaders(token: string, json = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// ── Blocks ─────────────────────────────────────────────────────────────────

export interface BlockChildrenParams {
  token: string;
  blockId: string; // a page id or a block id (both address a children list)
  base?: string;
  /** Opaque cursor from a previous page's `next_cursor`. */
  startCursor?: string;
  /** Page size (1..100); Notion defaults to 100. */
  pageSize?: number;
}

/**
 * retrieveBlockChildren shapes ONE page of `GET /v1/blocks/{id}/children`. The
 * caller loops on the response's `has_more`/`next_cursor` (see paginate below) —
 * this wrapper returns a single request so it stays pure. A page's own id IS a
 * block id, so this reads a page's top-level blocks and, given a block id, that
 * block's nested children (recursive read is composed in blocks.ts / app.ts).
 */
export function retrieveBlockChildren(p: BlockChildrenParams): NotionRequest {
  const q = new URLSearchParams();
  if (p.startCursor) q.set('start_cursor', p.startCursor);
  if (p.pageSize) q.set('page_size', String(Math.min(p.pageSize, NOTION_MAX_PAGE_SIZE)));
  const query = q.toString();
  return {
    url: `${notionApiRoot(p.base)}/blocks/${p.blockId}/children${query ? `?${query}` : ''}`,
    method: 'GET',
    headers: baseHeaders(p.token),
  };
}

export interface AppendChildrenParams {
  token: string;
  blockId: string; // parent page/block to append under
  children: unknown[]; // Notion block objects (from blocks.ts builders)
  base?: string;
  /** Append AFTER this existing child block id (Notion's `after` anchor). */
  after?: string;
}

/**
 * appendChildren shapes `PATCH /v1/blocks/{id}/children`. Notion wraps the new
 * blocks under a top-level `children` array (max 100). This is the write-back
 * path: a built callout/paragraph block list is appended to the page.
 */
export function appendChildren(p: AppendChildrenParams): NotionRequest {
  const body: Record<string, unknown> = { children: p.children };
  if (p.after) body.after = p.after;
  return {
    url: `${notionApiRoot(p.base)}/blocks/${p.blockId}/children`,
    method: 'PATCH',
    headers: baseHeaders(p.token, true),
    body: JSON.stringify(body),
  };
}

// ── Pages ────────────────────────────────────────────────────────────────

export interface RetrievePageParams {
  token: string;
  pageId: string;
  base?: string;
}

// retrievePage fetches a page's own properties (title, and — when the page is a
// database row — its property values). The block content is a separate call
// (retrieveBlockChildren).
export function retrievePage(p: RetrievePageParams): NotionRequest {
  return {
    url: `${notionApiRoot(p.base)}/pages/${p.pageId}`,
    method: 'GET',
    headers: baseHeaders(p.token),
  };
}

export interface CreatePageParams {
  token: string;
  base?: string;
  /**
   * The parent. A database row uses `{ database_id }`; a standalone page uses
   * `{ page_id }`. Passed through verbatim so the caller controls the target.
   */
  parent: { database_id: string } | { page_id: string };
  /** Notion property values, keyed by property name (built in blocks.ts). */
  properties: Record<string, unknown>;
  /** Optional page body blocks to create alongside the page. */
  children?: unknown[];
}

/**
 * createPage shapes `POST /v1/pages`. This is BOTH "create a database row"
 * (parent = { database_id }) and "create a sub-page" (parent = { page_id }) —
 * one endpoint, the parent selects which. Used by the extract→database action.
 */
export function createPage(p: CreatePageParams): NotionRequest {
  const body: Record<string, unknown> = { parent: p.parent, properties: p.properties };
  if (p.children && p.children.length) body.children = p.children;
  return {
    url: `${notionApiRoot(p.base)}/pages`,
    method: 'POST',
    headers: baseHeaders(p.token, true),
    body: JSON.stringify(body),
  };
}

// ── Databases ────────────────────────────────────────────────────────────

export interface RetrieveDatabaseParams {
  token: string;
  databaseId: string;
  base?: string;
}

// retrieveDatabase fetches a database's schema (its `properties` map: names,
// types, select options). The extract action reads this to map AI-extracted
// fields onto the right property types.
export function retrieveDatabase(p: RetrieveDatabaseParams): NotionRequest {
  return {
    url: `${notionApiRoot(p.base)}/databases/${p.databaseId}`,
    method: 'GET',
    headers: baseHeaders(p.token),
  };
}

export interface QueryDatabaseParams {
  token: string;
  databaseId: string;
  base?: string;
  filter?: unknown; // Notion filter object, passed through
  sorts?: unknown[]; // Notion sort array, passed through
  startCursor?: string;
  pageSize?: number;
}

/**
 * queryDatabase shapes `POST /v1/databases/{id}/query`. Filter/sorts/cursor go
 * in the JSON BODY (not the query string, unlike block children). Returns one
 * page of rows; paginate on `has_more`/`next_cursor`.
 */
export function queryDatabase(p: QueryDatabaseParams): NotionRequest {
  const body: Record<string, unknown> = {};
  if (p.filter !== undefined) body.filter = p.filter;
  if (p.sorts !== undefined) body.sorts = p.sorts;
  if (p.startCursor) body.start_cursor = p.startCursor;
  if (p.pageSize) body.page_size = Math.min(p.pageSize, NOTION_MAX_PAGE_SIZE);
  return {
    url: `${notionApiRoot(p.base)}/databases/${p.databaseId}/query`,
    method: 'POST',
    headers: baseHeaders(p.token, true),
    body: JSON.stringify(body),
  };
}

// ── Search ───────────────────────────────────────────────────────────────

export interface SearchParams {
  token: string;
  base?: string;
  /** Free-text query over titles of pages/databases the bot can see. */
  query?: string;
  /** Restrict results to one object kind. */
  filterObject?: 'page' | 'database';
  startCursor?: string;
  pageSize?: number;
}

/**
 * search shapes `POST /v1/search`. Notion's search only spans content the
 * integration has been GRANTED — it is the discovery entry point (list the
 * pages/databases the user shared). The object filter is Notion's nested
 * `{ value, property: 'object' }` shape.
 */
export function search(p: SearchParams): NotionRequest {
  const body: Record<string, unknown> = {};
  if (p.query) body.query = p.query;
  if (p.filterObject) body.filter = { value: p.filterObject, property: 'object' };
  if (p.startCursor) body.start_cursor = p.startCursor;
  if (p.pageSize) body.page_size = Math.min(p.pageSize, NOTION_MAX_PAGE_SIZE);
  return {
    url: `${notionApiRoot(p.base)}/search`,
    method: 'POST',
    headers: baseHeaders(p.token, true),
    body: JSON.stringify(body),
  };
}

// ── Response reading (pure) ────────────────────────────────────────────────

/**
 * A Notion list response's paging fields. Every paginated endpoint (block
 * children, search, database query) returns `{ results, has_more, next_cursor }`.
 */
export interface NotionListPage<T = any> {
  results: T[];
  hasMore: boolean;
  nextCursor: string;
}

/**
 * readListPage extracts `{ results, has_more, next_cursor }` from a Notion list
 * response and throws on Notion's `{ object: 'error', message }` shape so callers
 * surface the real message. Pure.
 */
export function readListPage<T = any>(payload: any): NotionListPage<T> {
  throwOnError(payload);
  return {
    results: Array.isArray(payload?.results) ? payload.results : [],
    hasMore: payload?.has_more === true,
    nextCursor: typeof payload?.next_cursor === 'string' ? payload.next_cursor : '',
  };
}

// throwOnError surfaces Notion's error envelope ({ object:'error', code, message }).
function throwOnError(payload: any): void {
  if (payload && payload.object === 'error') {
    const msg = payload.message || payload.code || 'unknown error';
    throw new Error(`Notion API error: ${msg}`);
  }
}

// ── The one thin network place ────────────────────────────────────────────

/**
 * notionFetch executes a shaped NotionRequest and returns the parsed JSON.
 * Errors carry Notion's status + message so failures are diagnosable. `doFetch`
 * is injectable for tests; defaults to global fetch.
 */
export async function notionFetch(
  req: NotionRequest,
  doFetch: typeof fetch = fetch,
): Promise<any> {
  const resp = await doFetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await resp.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Notion API ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const msg = data?.message || data?.code || `HTTP ${resp.status}`;
    throw new Error(`Notion API ${resp.status}: ${msg}`);
  }
  return data;
}

/**
 * paginate drives a cursor loop over any wrapper that takes a `startCursor` and
 * returns a Notion list page — collecting every result across pages. `makeReq`
 * takes the current cursor and returns the shaped request; `doFetch` is the
 * (injectable) network. A `maxPages` guard bounds a runaway workspace. This is
 * the ONE pagination code path — block children, search, and database query all
 * reuse it (composition over three copied loops).
 */
export async function paginate<T = any>(
  makeReq: (cursor: string | undefined) => NotionRequest,
  opts: { doFetch?: typeof fetch; maxPages?: number } = {},
): Promise<T[]> {
  const doFetch = opts.doFetch ?? fetch;
  const maxPages = opts.maxPages ?? 50;
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = readListPage<T>(await notionFetch(makeReq(cursor), doFetch));
    out.push(...page.results);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}
