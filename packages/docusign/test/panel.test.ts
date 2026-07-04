import { describe, it, expect } from 'vitest';
import { parseLaunchContext, asPages, panelTitle } from '../src/panel';

describe('parseLaunchContext', () => {
  it('reads envelopeId/accountId/title from the launch query', () => {
    const ctx = parseLaunchContext('?envelopeId=env-9&accountId=acct-1&title=MSA');
    expect(ctx).toEqual({ envelopeId: 'env-9', accountId: 'acct-1', title: 'MSA' });
  });
  it('accepts the snake_case + emailSubject variants', () => {
    const ctx = parseLaunchContext('?envelope_id=e&account_id=a&emailSubject=Please%20sign');
    expect(ctx.envelopeId).toBe('e');
    expect(ctx.accountId).toBe('a');
    expect(ctx.title).toBe('Please sign');
  });
  it('is empty when the panel is opened without context', () => {
    expect(parseLaunchContext('')).toEqual({ envelopeId: '', accountId: '', title: '' });
  });
});

describe('asPages', () => {
  it('wraps pasted text as a single page', () => {
    expect(asPages('  hello  ')).toEqual([{ page: 1, text: 'hello' }]);
  });
  it('is empty for blank text', () => {
    expect(asPages('   ')).toEqual([]);
  });
});

describe('panelTitle', () => {
  it('prefers the subject, then the envelope id, then a default', () => {
    expect(panelTitle({ envelopeId: 'e', accountId: '', title: 'MSA' })).toBe('MSA');
    expect(panelTitle({ envelopeId: 'e', accountId: '', title: '' })).toBe('Envelope e');
    expect(panelTitle({ envelopeId: '', accountId: '', title: '' })).toBe('Agreement');
  });
});
