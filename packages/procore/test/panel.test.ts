import { describe, it, expect, vi } from 'vitest';
import { parseLaunchContext, proxyUrl, createProxyClient } from '../src/panel.js';

describe('panel: parseLaunchContext', () => {
  it('reads Procore snake_case company/project ids', () => {
    expect(parseLaunchContext('?company_id=42&project_id=100')).toEqual({ companyId: '42', projectId: '100' });
  });
  it('accepts camelCase fallbacks and defaults to empty', () => {
    expect(parseLaunchContext('?companyId=7')).toEqual({ companyId: '7', projectId: '' });
    expect(parseLaunchContext('')).toEqual({ companyId: '', projectId: '' });
  });
});

describe('panel: proxyUrl', () => {
  it('prefixes /proxy and appends a query, dropping empties', () => {
    expect(proxyUrl('', '/projects', { company_id: '42', page: '', per_page: '100' })).toBe(
      '/proxy/projects?company_id=42&per_page=100',
    );
  });
  it('strips a trailing slash from the base', () => {
    expect(proxyUrl('https://procore.hanzo.ai/', '/x')).toBe('https://procore.hanzo.ai/proxy/x');
  });
});

// jsonResponse builds a fetch Response-like with a Total header.
function jsonResponse(body: unknown, total?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (total) headers.set('Total', total);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

// fetchMockOf wraps a responder in a fetch-typed mock so calls[i] carries the
// (url, init) arg tuple TypeScript expects.
function fetchMockOf(responder: () => Response) {
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(responder()));
}

describe('panel: createProxyClient — scoping + shaping', () => {
  it('sends the company header + credentials and returns parsed items with the Total', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse([{ id: 1, name: 'Tower A' }], '137'));
    const client = createProxyClient({ companyId: '42', fetch: fetchMock as any });
    const { items, total } = await client.listProjects({ perPage: 100 });

    expect(items).toEqual([{ id: 1, name: 'Tower A', displayName: 'Tower A', active: false }]);
    expect(total).toBe(137);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/projects?company_id=42&per_page=100');
    expect((init as RequestInit).headers).toMatchObject({ 'Procore-Company-Id': '42' });
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('lists RFIs on the project path with pagination', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse([], '0'));
    const client = createProxyClient({ companyId: '42', fetch: fetchMock as any });
    await client.listRFIs(100, { page: 2, perPage: 50 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/projects/100/rfis?page=2&per_page=50');
  });

  it('gets one RFI and parses it', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({ id: 9, number: '042', subject: 'Conflict', status: 'open', question: { body: 'Q?' } }),
    );
    const client = createProxyClient({ companyId: '42', fetch: fetchMock as any });
    const rfi = await client.getRFI(100, 9);
    expect(rfi.number).toBe('042');
    expect(rfi.question.body).toBe('Q?');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/projects/100/rfis/9');
  });

  it('routes documents through folders_and_files with project_id', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ folders: [], files: [] }));
    const client = createProxyClient({ companyId: '42', fetch: fetchMock as any });
    await client.listDocuments(100);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/folders_and_files?project_id=100');
  });

  it('createReply POSTs the rfi_reply JSON body', async () => {
    const fetchMock = fetchMockOf(() => new Response('{}', { status: 201 }));
    const client = createProxyClient({ companyId: '42', fetch: fetchMock as any });
    await client.createReply(100, 9, 'S-201 governs.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/projects/100/rfis/9/replies');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ rfi_reply: { body: 'S-201 governs.' } });
  });

  it('surfaces a proxy error with status + message', async () => {
    const fetchMock = fetchMockOf(() => new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 }));
    const client = createProxyClient({ companyId: '42', fetch: fetchMock as any });
    await expect(client.listProjects()).rejects.toThrow(/401.*not authenticated/);
  });
});
