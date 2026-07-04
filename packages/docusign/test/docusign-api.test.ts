import { describe, it, expect } from 'vitest';
import {
  getEnvelope,
  listDocuments,
  getDocument,
  listEnvelopes,
  parseDocuments,
  parseEnvelope,
  COMBINED_DOCUMENT_ID,
} from '../src/docusign-api';
import { apiBaseUrl } from '../src/docusign-oauth';

const API = apiBaseUrl('https://demo.docusign.net'); // .../restapi/v2.1
const ACCT = 'acct-1';
const ENV = 'env-9';
const TOK = 'AT-abc';

describe('request wrappers carry a Bearer and build the exact eSignature paths', () => {
  it('getEnvelope', () => {
    const r = getEnvelope(API, ACCT, ENV, TOK);
    expect(r.url).toBe(`${API}/accounts/acct-1/envelopes/env-9`);
    expect(r.headers.Authorization).toBe('Bearer AT-abc');
  });

  it('listDocuments', () => {
    const r = listDocuments(API, ACCT, ENV, TOK);
    expect(r.url).toBe(`${API}/accounts/acct-1/envelopes/env-9/documents`);
    expect(r.headers.Authorization).toBe('Bearer AT-abc');
  });

  it('getDocument defaults to the combined PDF and asks for application/pdf', () => {
    const r = getDocument(API, ACCT, ENV, TOK);
    expect(r.url).toBe(`${API}/accounts/acct-1/envelopes/env-9/documents/${COMBINED_DOCUMENT_ID}`);
    expect(r.headers.Accept).toBe('application/pdf');
    expect(r.headers.Authorization).toBe('Bearer AT-abc');
  });

  it('getDocument targets a specific document id when given', () => {
    expect(getDocument(API, ACCT, ENV, TOK, '2').url).toBe(`${API}/accounts/acct-1/envelopes/env-9/documents/2`);
  });

  it('encodes path segments defensively', () => {
    const r = getEnvelope(API, 'a/b', 'e?x', TOK);
    expect(r.url).toBe(`${API}/accounts/a%2Fb/envelopes/e%3Fx`);
  });

  it('listEnvelopes requires a from_date query', () => {
    const r = listEnvelopes(API, ACCT, TOK, '2026-01-01');
    const u = new URL(r.url);
    expect(u.pathname).toBe('/restapi/v2.1/accounts/acct-1/envelopes');
    expect(u.searchParams.get('from_date')).toBe('2026-01-01');
  });
});

describe('parseDocuments', () => {
  it('reads envelopeDocuments, sorts by order, drops id-less entries', () => {
    const docs = parseDocuments({
      envelopeDocuments: [
        { documentId: '2', name: 'Addendum', type: 'content', order: '2' },
        { documentId: '1', name: 'MSA', type: 'content', order: '1' },
        { name: 'broken' },
        { documentId: 'certificate', name: 'Summary', type: 'summary', order: '999' },
      ],
    });
    expect(docs.map((d) => d.documentId)).toEqual(['1', '2', 'certificate']);
    expect(docs[0].name).toBe('MSA');
  });

  it('returns [] for a body with no documents', () => {
    expect(parseDocuments({})).toEqual([]);
    expect(parseDocuments(null)).toEqual([]);
  });
});

describe('parseEnvelope', () => {
  it('reads the metadata fields, defaulting missing ones to empty strings', () => {
    const e = parseEnvelope({ envelopeId: 'env-9', status: 'completed', emailSubject: 'Please sign', sentDateTime: '2026-06-01', completedDateTime: '2026-06-02' });
    expect(e).toEqual({
      envelopeId: 'env-9',
      status: 'completed',
      emailSubject: 'Please sign',
      sentDateTime: '2026-06-01',
      completedDateTime: '2026-06-02',
    });
  });
  it('is total over a sparse body', () => {
    const e = parseEnvelope({ status: 'sent' });
    expect(e.envelopeId).toBe('');
    expect(e.status).toBe('sent');
    expect(e.emailSubject).toBe('');
  });
});
