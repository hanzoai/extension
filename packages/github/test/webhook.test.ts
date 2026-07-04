import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  sign,
  verifySignature,
  parseMention,
  routeEvent,
  SIGNATURE_HEADER,
  type RoutablePayload,
} from '../src/webhook.js';

const SECRET = 'topsecret';
const BODY = JSON.stringify({ action: 'opened', hello: 'world' });

describe('sign / verifySignature (HMAC)', () => {
  it('sign matches a manual sha256 HMAC in GitHub format', () => {
    const expected = 'sha256=' + createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
    expect(sign(BODY, SECRET)).toBe(expected);
  });

  it('accepts a valid signature', () => {
    expect(verifySignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(BODY, SECRET);
    expect(verifySignature(BODY + 'x', sig, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifySignature(BODY, sign(BODY, 'other'), SECRET)).toBe(false);
  });

  it('rejects a missing signature or secret without throwing', () => {
    expect(verifySignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifySignature(BODY, sign(BODY, SECRET), '')).toBe(false);
  });

  it('rejects a wrong-length signature (constant-time guard)', () => {
    expect(verifySignature(BODY, 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('exposes the header name it verifies', () => {
    expect(SIGNATURE_HEADER).toBe('x-hub-signature-256');
  });
});

describe('parseMention', () => {
  it('extracts the question after @hanzo', () => {
    expect(parseMention('hey @hanzo why is this failing?')).toBe('why is this failing?');
  });

  it('is case-insensitive and matches at the start', () => {
    expect(parseMention('@Hanzo explain the diff')).toBe('explain the diff');
  });

  it('returns empty string for a bare mention', () => {
    expect(parseMention('@hanzo')).toBe('');
  });

  it('returns null when @hanzo is absent', () => {
    expect(parseMention('this mentions nobody')).toBeNull();
  });

  it('does not match an email-like substring', () => {
    expect(parseMention('mail me at bob@hanzo.ai')).toBeNull();
  });
});

describe('routeEvent', () => {
  it('routes pull_request opened/synchronize/reopened to review', () => {
    for (const action of ['opened', 'synchronize', 'reopened']) {
      const p: RoutablePayload = { action, pull_request: {} };
      expect(routeEvent('pull_request', p)).toEqual({ kind: 'review_pr' });
    }
  });

  it('ignores other pull_request actions', () => {
    const r = routeEvent('pull_request', { action: 'closed', pull_request: {} });
    expect(r.kind).toBe('ignore');
  });

  it('routes issues opened to triage', () => {
    expect(routeEvent('issues', { action: 'opened', issue: {} })).toEqual({ kind: 'triage_issue' });
  });

  it('ignores non-opened issues actions', () => {
    expect(routeEvent('issues', { action: 'edited', issue: {} }).kind).toBe('ignore');
  });

  it('routes issue_comment created with @hanzo to answer_mention', () => {
    const r = routeEvent('issue_comment', {
      action: 'created',
      comment: { body: '@hanzo what is this?' },
    });
    expect(r).toEqual({ kind: 'answer_mention', question: 'what is this?' });
  });

  it('ignores an issue_comment without @hanzo', () => {
    const r = routeEvent('issue_comment', { action: 'created', comment: { body: 'nice work' } });
    expect(r.kind).toBe('ignore');
  });

  it('ignores edited/deleted comments', () => {
    const r = routeEvent('issue_comment', {
      action: 'edited',
      comment: { body: '@hanzo hi' },
    });
    expect(r.kind).toBe('ignore');
  });

  it('ignores unknown events', () => {
    expect(routeEvent('star', {}).kind).toBe('ignore');
  });
});
