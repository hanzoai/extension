import { describe, it, expect } from 'vitest';
import {
  AUTH_HEADER,
  DEFAULT_LIMIT,
  pageParams,
  parsePaging,
  unwrap,
  libBase,
  enc,
  listLibraries,
  listWorkspaces,
  getWorkspace,
  listFolderChildren,
  getDocument,
  getDocumentContent,
  updateDocumentProfile,
  search,
  type Scope,
} from '../src/imanage-api.js';
import { apiBaseUrl } from '../src/config.js';

const scope: Scope = {
  apiBase: apiBaseUrl('cloudimanage.com'),
  accessToken: 'at-123',
  customerId: 1,
  libraryId: 'ACTIVE_US',
};

function q(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('api: pageParams (offset/limit)', () => {
  it('emits nothing for no page', () => {
    expect(pageParams(undefined)).toEqual({});
  });
  it('emits offset + limit when set', () => {
    expect(pageParams({ offset: 50, limit: 25 })).toEqual({ offset: '50', limit: '25' });
  });
  it('clamps limit to the documented max', () => {
    expect(pageParams({ limit: 500 }).limit).toBe(String(DEFAULT_LIMIT));
  });
  it('ignores non-positive values', () => {
    expect(pageParams({ offset: 0, limit: -5 })).toEqual({});
  });
});

describe('api: libBase + enc', () => {
  it('builds the customer/library path prefix', () => {
    expect(libBase({ customerId: 1, libraryId: 'ACTIVE_US' })).toBe('/customers/1/libraries/ACTIVE_US');
  });
  it('encodes ids defensively: a slash cannot traverse the path; iManage’s ! and . pass through as valid path chars', () => {
    expect(enc('ACTIVE_US!4567.1')).toBe('ACTIVE_US!4567.1');
    expect(enc('a/b')).toBe('a%2Fb');
    expect(enc('a b')).toBe('a%20b');
  });
});

describe('api: auth scoping', () => {
  it('every read carries the X-Auth-Token header (never Authorization: Bearer)', () => {
    for (const req of [
      listLibraries(scope),
      listWorkspaces(scope),
      getWorkspace(scope, 'W1'),
      listFolderChildren(scope, 'F1'),
      getDocument(scope, 'D1'),
      getDocumentContent(scope, 'D1'),
      search(scope, 'nda'),
    ]) {
      expect(req.headers[AUTH_HEADER]).toBe('at-123');
      expect(req.headers.Authorization).toBeUndefined();
    }
  });
  it('AUTH_HEADER is exactly X-Auth-Token', () => {
    expect(AUTH_HEADER).toBe('X-Auth-Token');
  });
});

describe('api: libraries + workspaces', () => {
  it('lists libraries under the customer (no library in path)', () => {
    const req = listLibraries(scope);
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries');
  });
  it('lists workspaces scoped to customer + library with pagination', () => {
    const req = listWorkspaces(scope, { offset: 100, limit: 50 });
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/workspaces');
    expect(q(req.url).get('offset')).toBe('100');
    expect(q(req.url).get('limit')).toBe('50');
  });
  it('gets one workspace by id', () => {
    expect(new URL(getWorkspace(scope, 'W-7').url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/workspaces/W-7');
  });
});

describe('api: folder children (browse)', () => {
  it('lists a container’s children (folders + documents) with pagination', () => {
    const req = listFolderChildren(scope, 'FOLDER!9', { limit: 100 });
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/folders/FOLDER!9/children');
    expect(q(req.url).get('limit')).toBe('100');
  });
});

describe('api: documents', () => {
  it('gets a document profile by id', () => {
    const req = getDocument(scope, 'ACTIVE_US!4567.1');
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/documents/ACTIVE_US!4567.1');
  });
  it('gets document content via /download', () => {
    const req = getDocumentContent(scope, 'ACTIVE_US!4567.1');
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/documents/ACTIVE_US!4567.1/download');
  });
});

describe('api: updateDocumentProfile (the one write path)', () => {
  it('PATCHes a data-wrapped profile patch', () => {
    const req = updateDocumentProfile(scope, 'D1', { comment: 'AI summary' });
    expect(req.method).toBe('PATCH');
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/documents/D1');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers[AUTH_HEADER]).toBe('at-123');
    expect(JSON.parse(req.body)).toEqual({ data: { comment: 'AI summary' } });
  });
});

describe('api: search', () => {
  it('searches documents across the library with q + pagination', () => {
    const req = search(scope, 'master services agreement', { limit: 25, offset: 25 });
    expect(new URL(req.url).pathname).toBe('/api/v2/customers/1/libraries/ACTIVE_US/documents/search');
    expect(q(req.url).get('q')).toBe('master services agreement');
    expect(q(req.url).get('limit')).toBe('25');
    expect(q(req.url).get('offset')).toBe('25');
  });
});

describe('api: unwrap envelope', () => {
  it('returns the data payload of an envelope', () => {
    expect(unwrap({ data: { id: 'x' } })).toEqual({ id: 'x' });
    expect(unwrap({ data: [1, 2] })).toEqual([1, 2]);
  });
  it('returns a bare value unchanged', () => {
    expect(unwrap([1, 2])).toEqual([1, 2]);
    expect(unwrap({ id: 'y' })).toEqual({ id: 'y' });
  });
});

describe('api: parsePaging (body-based, not header)', () => {
  it('reads total_count and computes hasMore from offset+returned', () => {
    expect(parsePaging({ total_count: 137 }, 50, 0)).toEqual({ total: 137, hasMore: true });
    expect(parsePaging({ total_count: 40 }, 40, 0)).toEqual({ total: 40, hasMore: false });
  });
  it('honours an explicit overflow flag', () => {
    expect(parsePaging({ overflow: true }, 50, 0).hasMore).toBe(true);
  });
  it('honours a next cursor', () => {
    expect(parsePaging({ next: 'https://x/page2' }, 50, 0).hasMore).toBe(true);
  });
  it('reads count as a total fallback and defaults to 0', () => {
    expect(parsePaging({ count: 9 }, 9, 0).total).toBe(9);
    expect(parsePaging({}, 0, 0)).toEqual({ total: 0, hasMore: false });
  });
});
