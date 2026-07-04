import { describe, it, expect, vi } from 'vitest';
import { parseLaunchContext, proxyUrl, createProxyClient } from '../src/panel.js';

describe('panel: parseLaunchContext', () => {
  it('reads snake_case customer/library/workspace/document ids', () => {
    expect(parseLaunchContext('?customer_id=1&library_id=ACTIVE_US&workspace_id=W1&document_id=D1')).toEqual({
      customerId: '1',
      libraryId: 'ACTIVE_US',
      workspaceId: 'W1',
      documentId: 'D1',
    });
  });
  it('accepts camelCase fallbacks and defaults to empty', () => {
    expect(parseLaunchContext('?customerId=7&libraryId=L')).toEqual({
      customerId: '7',
      libraryId: 'L',
      workspaceId: '',
      documentId: '',
    });
    expect(parseLaunchContext('')).toEqual({ customerId: '', libraryId: '', workspaceId: '', documentId: '' });
  });
});

describe('panel: proxyUrl', () => {
  it('prefixes /proxy and appends a query, dropping empties', () => {
    expect(proxyUrl('', '/customers/1/libraries/ACTIVE_US/workspaces', { limit: '100', offset: '' })).toBe(
      '/proxy/customers/1/libraries/ACTIVE_US/workspaces?limit=100',
    );
  });
  it('strips a trailing slash from the base', () => {
    expect(proxyUrl('https://imanage.hanzo.ai/', '/x')).toBe('https://imanage.hanzo.ai/proxy/x');
  });
});

// jsonResponse builds a fetch Response-like from an iManage envelope body.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

// fetchMockOf wraps a responder in a fetch-typed mock so calls[i] carries the
// (url, init) arg tuple TypeScript expects.
function fetchMockOf(responder: () => Response) {
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(responder()));
}

const scope = { customerId: '1', libraryId: 'ACTIVE_US' };

describe('panel: createProxyClient — scoping + shaping', () => {
  it('lists workspaces with the customer/library path, credentials, parsed items + paging', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({ data: [{ id: 'ACTIVE_US!12', name: 'Acme / Falcon', client: 'Acme', matter: 'M1' }], total_count: 1 }),
    );
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    const { items, paging } = await client.listWorkspaces({ limit: 100 });

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Acme / Falcon');
    expect(paging.total).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/customers/1/libraries/ACTIVE_US/workspaces?limit=100');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('gets one workspace by id', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ data: { id: 'W1', name: 'Solo' } }));
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    const ws = await client.getWorkspace('W1');
    expect(ws.name).toBe('Solo');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/customers/1/libraries/ACTIVE_US/workspaces/W1');
  });

  it('lists folder children split into folders + documents', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({
        data: [
          { id: 'F1', name: 'Contracts', type: 'folder' },
          { id: 'ACTIVE_US!4567.1', name: 'MSA', type: 'document', extension: 'DOCX' },
        ],
      }),
    );
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    const { items } = await client.listFolderChildren('W1', { limit: 100 });
    expect(items.folders.map((f) => f.id)).toEqual(['F1']);
    expect(items.documents.map((d) => d.id)).toEqual(['ACTIVE_US!4567.1']);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/customers/1/libraries/ACTIVE_US/folders/W1/children?limit=100');
  });

  it('gets a document profile and parses it', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({ data: { id: 'ACTIVE_US!4567.1', name: 'MSA', extension: 'DOCX', author_description: 'Jane Smith' } }),
    );
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    const doc = await client.getDocument('ACTIVE_US!4567.1');
    expect(doc.name).toBe('MSA');
    expect(doc.author).toBe('Jane Smith');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/customers/1/libraries/ACTIVE_US/documents/ACTIVE_US!4567.1');
  });

  it('fetches document content via /download and extracts text', async () => {
    const fetchMock = fetchMockOf(() => textResponse('Governing law: New York.\n\nTerm: 3 years.'));
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    const extracted = await client.getDocumentContent('ACTIVE_US!4567.1');
    expect(extracted.extracted).toBe(true);
    expect(extracted.text).toContain('Governing law: New York.');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/proxy/customers/1/libraries/ACTIVE_US/documents/ACTIVE_US!4567.1/download',
    );
  });

  it('searches documents with q + pagination', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({ data: [{ id: 'ACTIVE_US!4567.1', name: 'MSA', extension: 'DOCX' }], overflow: true }),
    );
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    const { items, paging } = await client.search('services agreement', { limit: 50 });
    expect(items).toHaveLength(1);
    expect(paging.hasMore).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/proxy/customers/1/libraries/ACTIVE_US/documents/search?q=services+agreement&limit=50',
    );
  });

  it('updateDocumentProfile PATCHes a data-wrapped body (the one write path)', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ data: { id: 'D1' } }));
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    await client.updateDocumentProfile('D1', { comment: 'AI summary' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/customers/1/libraries/ACTIVE_US/documents/D1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).credentials).toBe('include');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ data: { comment: 'AI summary' } });
  });

  it('surfaces a proxy error with status + message', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ error: 'not authenticated' }, 401));
    const client = createProxyClient({ ...scope, fetch: fetchMock as any });
    await expect(client.listWorkspaces()).rejects.toThrow(/401.*not authenticated/);
  });
});
