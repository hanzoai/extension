import { describe, it, expect } from 'vitest';
import {
  listMatters,
  getMatter,
  listDocuments,
  downloadDocument,
  listContacts,
  createNote,
  createActivity,
  unwrapData,
  extractNextPageToken,
} from '../src/clio-api';
import { clioBase, CLIO_API_VERSION } from '../src/config';

const token = 'TOK';
const base = clioBase('us');

function q(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('baseHeaders (via listMatters)', () => {
  it('sends Bearer auth, Accept json, and the pinned X-API-Version', () => {
    const r = listMatters({ token, base });
    expect(r.headers.Authorization).toBe('Bearer TOK');
    expect(r.headers.Accept).toBe('application/json');
    expect(r.headers['X-API-Version']).toBe(CLIO_API_VERSION);
    // GET → no content-type
    expect(r.headers['Content-Type']).toBeUndefined();
    expect(r.method).toBe('GET');
  });
});

describe('listMatters', () => {
  it('hits /matters with default fields joined by commas', () => {
    const r = listMatters({ token, base });
    expect(r.url.startsWith('https://app.clio.com/api/v4/matters?')).toBe(true);
    expect(q(r.url).get('fields')).toContain('display_number');
    expect(q(r.url).get('fields')).toContain('client{id,name}');
  });

  it('passes status, query, client_id, limit and page_token', () => {
    const r = listMatters({ token, base, status: 'open', query: 'smith', clientId: 42, limit: 25, pageToken: 'PT' });
    const p = q(r.url);
    expect(p.get('status')).toBe('open');
    expect(p.get('query')).toBe('smith');
    expect(p.get('client_id')).toBe('42');
    expect(p.get('limit')).toBe('25');
    expect(p.get('page_token')).toBe('PT');
  });

  it('drops undefined/empty params', () => {
    const r = listMatters({ token, base, query: '' });
    expect(q(r.url).has('query')).toBe(false);
    expect(q(r.url).has('status')).toBe(false);
  });

  it('accepts an explicit fields override', () => {
    const r = listMatters({ token, base, fields: ['id', 'description'] });
    expect(q(r.url).get('fields')).toBe('id,description');
  });
});

describe('getMatter', () => {
  it('hits /matters/{id} with the rich default field set', () => {
    const r = getMatter(token, base, 123);
    expect(r.url.startsWith('https://app.clio.com/api/v4/matters/123?')).toBe(true);
    const fields = q(r.url).get('fields')!;
    expect(fields).toContain('responsible_attorney{id,name}');
    expect(fields).toContain('practice_area{id,name}');
    expect(fields).toContain('open_date');
  });
  it('honors a fields override', () => {
    const r = getMatter(token, base, 1, ['id', 'status']);
    expect(q(r.url).get('fields')).toBe('id,status');
  });
});

describe('listDocuments', () => {
  it('scopes to a matter and paginates', () => {
    const r = listDocuments({ token, base, matterId: 9, limit: 25, pageToken: 'N' });
    const p = q(r.url);
    expect(r.url.startsWith('https://app.clio.com/api/v4/documents?')).toBe(true);
    expect(p.get('matter_id')).toBe('9');
    expect(p.get('limit')).toBe('25');
    expect(p.get('page_token')).toBe('N');
    expect(p.get('fields')).toContain('content_type');
  });
});

describe('downloadDocument', () => {
  it('hits the download sub-resource with auth + version but no JSON Accept', () => {
    const r = downloadDocument(token, base, 55);
    expect(r.url).toBe('https://app.clio.com/api/v4/documents/55/download');
    expect(r.headers.Authorization).toBe('Bearer TOK');
    expect(r.headers['X-API-Version']).toBe(CLIO_API_VERSION);
    expect(r.headers.Accept).toBeUndefined();
  });
});

describe('listContacts', () => {
  it('hits /contacts with default fields and optional query', () => {
    const r = listContacts(token, base, { query: 'acme', limit: 10 });
    const p = q(r.url);
    expect(r.url.startsWith('https://app.clio.com/api/v4/contacts?')).toBe(true);
    expect(p.get('query')).toBe('acme');
    expect(p.get('limit')).toBe('10');
    expect(p.get('fields')).toContain('primary_email_address');
  });
});

describe('createNote', () => {
  it('POSTs a matter-scoped note wrapped under data with JSON content-type', () => {
    const r = createNote({ token, base, matterId: 7, subject: 'S', detail: 'BODY' });
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://app.clio.com/api/v4/notes');
    expect(r.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(r.body!);
    expect(body.data.subject).toBe('S');
    expect(body.data.detail).toBe('BODY');
    expect(body.data.type).toBe('Matter');
    expect(body.data.matter).toEqual({ id: 7 });
  });
});

describe('createActivity', () => {
  it('POSTs a TimeEntry against a matter, quantity default 0', () => {
    const r = createActivity({ token, base, matterId: 3, note: 'logged by Hanzo' });
    expect(r.url).toBe('https://app.clio.com/api/v4/activities');
    const body = JSON.parse(r.body!);
    expect(body.data.type).toBe('TimeEntry');
    expect(body.data.matter).toEqual({ id: 3 });
    expect(body.data.note).toBe('logged by Hanzo');
    expect(body.data.quantity).toBe(0);
    expect(body.data.date).toBeUndefined();
  });
  it('passes an explicit quantity and date', () => {
    const r = createActivity({ token, base, matterId: 3, note: 'n', quantitySeconds: 900, date: '2026-01-02' });
    const body = JSON.parse(r.body!);
    expect(body.data.quantity).toBe(900);
    expect(body.data.date).toBe('2026-01-02');
  });
});

describe('unwrapData', () => {
  it('returns the data field of a Clio envelope', () => {
    expect(unwrapData({ data: { id: 1 } })).toEqual({ id: 1 });
    expect(unwrapData({ data: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
  });
  it('passes through a payload with no envelope', () => {
    expect(unwrapData({ id: 9 })).toEqual({ id: 9 });
  });
  it('throws on a Clio error / errors payload', () => {
    expect(() => unwrapData({ error: { message: 'nope' } })).toThrow(/nope/);
    expect(() => unwrapData({ errors: [{ type: 'x' }] })).toThrow(/Clio API error/);
  });
});

describe('extractNextPageToken', () => {
  it('pulls page_token from a full next URL', () => {
    const payload = { meta: { paging: { next: 'https://app.clio.com/api/v4/matters?limit=25&page_token=ABC123' } } };
    expect(extractNextPageToken(payload)).toBe('ABC123');
  });
  it('returns empty when there is no next page', () => {
    expect(extractNextPageToken({ meta: { paging: {} } })).toBe('');
    expect(extractNextPageToken({})).toBe('');
  });
  it('tolerates a bare token string', () => {
    expect(extractNextPageToken({ meta: { paging: { next: '?page_token=RAW' } } })).toBe('RAW');
  });
});
