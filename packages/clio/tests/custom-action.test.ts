import { describe, it, expect } from 'vitest';
import { parseSubjectUrl, parseCustomAction } from '../src/custom-action';

describe('parseSubjectUrl', () => {
  it('extracts the type + numeric id from a Clio matter URL', () => {
    expect(parseSubjectUrl('https://app.clio.com/api/v4/matters/1234.json')).toEqual({
      subjectType: 'matters',
      recordId: 1234,
    });
  });
  it('works without the .json suffix and for other record types', () => {
    expect(parseSubjectUrl('https://app.clio.com/api/v4/contacts/9')).toEqual({
      subjectType: 'contacts',
      recordId: 9,
    });
    expect(parseSubjectUrl('https://eu.app.clio.com/api/v4/documents/55.json')).toEqual({
      subjectType: 'documents',
      recordId: 55,
    });
  });
  it('tolerates a bare path', () => {
    expect(parseSubjectUrl('/api/v4/matters/77')).toEqual({ subjectType: 'matters', recordId: 77 });
  });
  it('returns empty for a non-matching URL or empty input', () => {
    expect(parseSubjectUrl('https://app.clio.com/nope')).toEqual({});
    expect(parseSubjectUrl('')).toEqual({});
  });
});

describe('parseCustomAction', () => {
  it('parses the full deep-link context and resolves matter_id from subject_url', () => {
    const params = new URLSearchParams({
      subject_url: 'https://app.clio.com/api/v4/matters/321.json',
      subject_id: '321',
      user_id: '42',
      custom_action_nonce: 'abc123',
    });
    const ctx = parseCustomAction(params);
    expect(ctx.subjectUrl).toBe('https://app.clio.com/api/v4/matters/321.json');
    expect(ctx.subjectId).toBe('321');
    expect(ctx.userId).toBe('42');
    expect(ctx.nonce).toBe('abc123');
    expect(ctx.subjectType).toBe('matters');
    expect(ctx.matterId).toBe(321);
  });

  it('leaves matterId undefined when the action fired on a non-matter record', () => {
    const ctx = parseCustomAction(
      new URLSearchParams({ subject_url: 'https://app.clio.com/api/v4/contacts/9', user_id: '1', custom_action_nonce: 'n' }),
    );
    expect(ctx.subjectType).toBe('contacts');
    expect(ctx.matterId).toBeUndefined();
  });

  it('accepts a plain record and fills missing params with empty strings', () => {
    const ctx = parseCustomAction({ user_id: '5' });
    expect(ctx.userId).toBe('5');
    expect(ctx.subjectUrl).toBe('');
    expect(ctx.nonce).toBe('');
    expect(ctx.matterId).toBeUndefined();
  });
});
