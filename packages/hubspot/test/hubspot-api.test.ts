import { describe, it, expect } from 'vitest';
import {
  getObject,
  getAssociations,
  batchReadObjects,
  createNote,
  createTask,
  parseObject,
  parseObjects,
  parseAssociationIds,
} from '../src/api/hubspot-api.js';
import { crmApiRoot } from '../src/config.js';

const ROOT = crmApiRoot(); // https://api.hubapi.com/crm/v3
const TOKEN = 'oauth-access-token';

describe('crmApiRoot', () => {
  it('is the v3 CRM root on the api host, no trailing slash', () => {
    expect(ROOT).toBe('https://api.hubapi.com/crm/v3');
  });
  it('strips a trailing slash from a custom base', () => {
    expect(crmApiRoot('https://example.com/')).toBe('https://example.com/crm/v3');
  });
});

describe('getObject', () => {
  it('shapes a GET with a comma-joined properties query', () => {
    const req = getObject(ROOT, 'contacts', '123', TOKEN, ['firstname', 'email']);
    expect(req.method).toBe('GET');
    expect(req.url).toBe(
      'https://api.hubapi.com/crm/v3/objects/contacts/123?properties=firstname%2Cemail',
    );
    expect(req.headers.Authorization).toBe('Bearer oauth-access-token');
    expect(req.body).toBeUndefined();
  });

  it('omits the query entirely when no properties are requested', () => {
    const req = getObject(ROOT, 'deals', '999', TOKEN);
    expect(req.url).toBe('https://api.hubapi.com/crm/v3/objects/deals/999');
  });

  it('url-encodes the object id defensively', () => {
    const req = getObject(ROOT, 'companies', 'a/b?c', TOKEN);
    expect(req.url).toContain('/companies/a%2Fb%3Fc');
    expect(req.url).not.toContain('a/b?c');
  });
});

describe('getAssociations', () => {
  it('shapes the associations GET with a limit', () => {
    const req = getAssociations(ROOT, 'contacts', '123', 'deals', TOKEN, 50);
    expect(req.method).toBe('GET');
    expect(req.url).toBe(
      'https://api.hubapi.com/crm/v3/objects/contacts/123/associations/deals?limit=50',
    );
  });
  it('defaults the limit to 100', () => {
    const req = getAssociations(ROOT, 'deals', '5', 'contacts', TOKEN);
    expect(req.url).toContain('limit=100');
  });
});

describe('batchReadObjects', () => {
  it('shapes a POST batch/read with inputs + properties', () => {
    const req = batchReadObjects(ROOT, 'deals', ['1', '2'], TOKEN, ['dealname', 'amount']);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.hubapi.com/crm/v3/objects/deals/batch/read');
    expect(req.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(req.body!);
    expect(body).toEqual({
      properties: ['dealname', 'amount'],
      inputs: [{ id: '1' }, { id: '2' }],
    });
  });
  it('handles an empty id list', () => {
    const req = batchReadObjects(ROOT, 'contacts', [], TOKEN);
    expect(JSON.parse(req.body!).inputs).toEqual([]);
  });
});

describe('createNote / createTask', () => {
  it('createNote POSTs to /objects/notes with the payload as JSON', () => {
    const payload = { properties: { hs_note_body: 'hi' } };
    const req = createNote(ROOT, payload, TOKEN);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.hubapi.com/crm/v3/objects/notes');
    expect(JSON.parse(req.body!)).toEqual(payload);
    expect(req.headers.Authorization).toBe('Bearer oauth-access-token');
  });
  it('createTask POSTs to /objects/tasks', () => {
    const req = createTask(ROOT, { properties: {} }, TOKEN);
    expect(req.url).toBe('https://api.hubapi.com/crm/v3/objects/tasks');
  });
});

describe('parseObject', () => {
  it('coerces property values to strings and defaults missing to ""', () => {
    const o = parseObject({ id: 7, properties: { amount: 1000, dealname: 'Big', note: null } });
    expect(o.id).toBe('7');
    expect(o.properties).toEqual({ amount: '1000', dealname: 'Big', note: '' });
  });
  it('tolerates a null/empty body', () => {
    expect(parseObject(null)).toEqual({ id: '', properties: {} });
    expect(parseObject({})).toEqual({ id: '', properties: {} });
  });
});

describe('parseObjects', () => {
  it('maps a results array and drops idless rows', () => {
    const list = parseObjects({
      results: [
        { id: '1', properties: { a: 'x' } },
        { properties: { a: 'y' } }, // no id → dropped
        { id: '2', properties: {} },
      ],
    });
    expect(list.map((o) => o.id)).toEqual(['1', '2']);
  });
  it('returns [] for a non-array body', () => {
    expect(parseObjects({})).toEqual([]);
    expect(parseObjects(null)).toEqual([]);
  });
});

describe('parseAssociationIds', () => {
  it('reads v4 toObjectId shape', () => {
    const ids = parseAssociationIds({ results: [{ toObjectId: 11 }, { toObjectId: '12' }] });
    expect(ids).toEqual(['11', '12']);
  });
  it('reads v3 id shape', () => {
    const ids = parseAssociationIds({ results: [{ id: 21 }, { id: 22 }] });
    expect(ids).toEqual(['21', '22']);
  });
  it('prefers toObjectId when both present, and skips empties', () => {
    const ids = parseAssociationIds({
      results: [{ toObjectId: 31, id: 999 }, { id: '' }, {}],
    });
    expect(ids).toEqual(['31']);
  });
  it('returns [] for a missing results array', () => {
    expect(parseAssociationIds({})).toEqual([]);
  });
});
