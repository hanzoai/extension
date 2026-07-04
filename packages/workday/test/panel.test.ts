import { describe, it, expect, vi } from 'vitest';
import { parseLaunchContext, proxyUrl, createProxyClient } from '../src/panel.js';

describe('panel: parseLaunchContext', () => {
  it('reads snake_case worker/organization ids', () => {
    expect(parseLaunchContext('?worker_id=w1&organization_id=o2')).toEqual({
      workerId: 'w1',
      organizationId: 'o2',
    });
  });
  it('accepts camelCase fallbacks and defaults to empty', () => {
    expect(parseLaunchContext('?workerId=w7')).toEqual({ workerId: 'w7', organizationId: '' });
    expect(parseLaunchContext('')).toEqual({ workerId: '', organizationId: '' });
  });
});

describe('panel: proxyUrl', () => {
  it('prefixes /proxy and appends a query, dropping empties', () => {
    expect(proxyUrl('', '/workers', { limit: '100', offset: '' })).toBe('/proxy/workers?limit=100');
  });
  it('strips a trailing slash from the base', () => {
    expect(proxyUrl('https://workday.hanzo.ai/', '/workers')).toBe('https://workday.hanzo.ai/proxy/workers');
  });
});

// jsonResponse builds a fetch Response-like from a body object.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// fetchMockOf wraps a responder in a fetch-typed mock so calls[i] carries the
// (url, init) arg tuple TypeScript expects.
function fetchMockOf(responder: () => Response) {
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(responder()));
}

const workerEnvelope = {
  total: 137,
  data: [
    {
      id: 'w1',
      descriptor: 'Logan McNeil',
      businessTitle: 'VP, HR',
      primarySupervisoryOrganization: { descriptor: 'Human Resources' },
    },
  ],
};

describe('panel: createProxyClient — routes, cookie, parsing', () => {
  it('lists workers with credentials and parses items + total', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse(workerEnvelope));
    const client = createProxyClient({ fetch: fetchMock as any });
    const { items, total } = await client.listWorkers({ limit: 100, offset: 200 });

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Logan McNeil');
    expect(items[0].organization).toBe('Human Resources');
    expect(total).toBe(137);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/proxy/workers?limit=100&offset=200');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('gets one worker and parses it', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({ id: 'w1', descriptor: 'Logan McNeil', primaryWorkEmail: 'l@x.co' }),
    );
    const client = createProxyClient({ fetch: fetchMock as any });
    const worker = await client.getWorker('w1');
    expect(worker.name).toBe('Logan McNeil');
    expect(worker.email).toBe('l@x.co');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/workers/w1');
  });

  it('lists direct reports on the worker route', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ total: 0, data: [] }));
    const client = createProxyClient({ fetch: fetchMock as any });
    await client.listDirectReports('w1', { limit: 50 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/workers/w1/directReports?limit=50');
  });

  it('lists organizations and requisitions on their routes', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ total: 0, data: [] }));
    const client = createProxyClient({ fetch: fetchMock as any });
    await client.listOrganizations();
    await client.listRequisitions({ offset: 10 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/organizations');
    expect(String(fetchMock.mock.calls[1][0])).toBe('/proxy/requisitions?offset=10');
  });

  it('lists eligible absence types on the worker absenceTypes route', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ total: 0, data: [] }));
    const client = createProxyClient({ fetch: fetchMock as any });
    await client.listAbsenceTypes('w1');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/workers/w1/absenceTypes');
  });

  it('runs a RaaS report and parses Report_Entry rows', async () => {
    const fetchMock = fetchMockOf(() =>
      jsonResponse({ Report_Entry: [{ Worker: { Descriptor: 'Amy' }, Balance: '12' }] }),
    );
    const client = createProxyClient({ fetch: fetchMock as any });
    const rows = await client.report('lmcneil', 'Team_Time_Off', { asOf: '2026-07-01' });
    expect(rows).toEqual([{ Worker: 'Amy', Balance: '12' }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/proxy/report/lmcneil/Team_Time_Off?asOf=2026-07-01');
  });

  it('surfaces a proxy error with status + message', async () => {
    const fetchMock = fetchMockOf(() => jsonResponse({ error: 'not authenticated' }, 401));
    const client = createProxyClient({ fetch: fetchMock as any });
    await expect(client.listWorkers()).rejects.toThrow(/401.*not authenticated/);
  });
});
