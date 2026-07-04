import { describe, it, expect } from 'vitest';
import {
  verifyToken,
  parseMention,
  routeEvent,
  TOKEN_HEADER,
  EVENT_HEADER,
  type RoutablePayload,
} from '../src/webhook.js';

const SECRET = 'topsecret';

describe('verifyToken (constant-time secret compare)', () => {
  it('accepts the exact secret', () => {
    expect(verifyToken(SECRET, SECRET)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(verifyToken('wrong', SECRET)).toBe(false);
  });

  it('rejects a token of a different length without throwing', () => {
    expect(verifyToken('short', SECRET)).toBe(false);
    expect(verifyToken(SECRET + 'x', SECRET)).toBe(false);
  });

  it('rejects a missing token or secret', () => {
    expect(verifyToken(undefined, SECRET)).toBe(false);
    expect(verifyToken(SECRET, '')).toBe(false);
    expect(verifyToken('', SECRET)).toBe(false);
  });

  it('exposes the header names it reads', () => {
    expect(TOKEN_HEADER).toBe('x-gitlab-token');
    expect(EVENT_HEADER).toBe('x-gitlab-event');
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
  it('routes Merge Request Hook open/update/reopen to review', () => {
    for (const action of ['open', 'update', 'reopen']) {
      const p: RoutablePayload = { object_kind: 'merge_request', object_attributes: { action } };
      expect(routeEvent('Merge Request Hook', p)).toEqual({ kind: 'review_mr' });
    }
  });

  it('ignores other merge_request actions', () => {
    const r = routeEvent('Merge Request Hook', {
      object_attributes: { action: 'close' },
    });
    expect(r.kind).toBe('ignore');
  });

  it('routes Issue Hook open/reopen to triage', () => {
    expect(routeEvent('Issue Hook', { object_attributes: { action: 'open' } })).toEqual({
      kind: 'triage_issue',
    });
    expect(routeEvent('Issue Hook', { object_attributes: { action: 'reopen' } })).toEqual({
      kind: 'triage_issue',
    });
  });

  it('ignores non-open issue actions', () => {
    expect(routeEvent('Issue Hook', { object_attributes: { action: 'update' } }).kind).toBe(
      'ignore',
    );
  });

  it('routes a Note Hook on an MR with @hanzo to answer_mention', () => {
    const r = routeEvent('Note Hook', {
      object_attributes: { noteable_type: 'MergeRequest', note: '@hanzo what is this?' },
    });
    expect(r).toEqual({ kind: 'answer_mention', question: 'what is this?' });
  });

  it('routes a Note Hook on an Issue with @hanzo to answer_mention', () => {
    const r = routeEvent('Note Hook', {
      object_attributes: { noteable_type: 'Issue', note: '@hanzo summarize' },
    });
    expect(r).toEqual({ kind: 'answer_mention', question: 'summarize' });
  });

  it('ignores a note without @hanzo', () => {
    const r = routeEvent('Note Hook', {
      object_attributes: { noteable_type: 'Issue', note: 'nice work' },
    });
    expect(r.kind).toBe('ignore');
  });

  it('ignores notes on unsupported noteables (commit, snippet)', () => {
    const r = routeEvent('Note Hook', {
      object_attributes: { noteable_type: 'Commit', note: '@hanzo hi' },
    });
    expect(r.kind).toBe('ignore');
  });

  it('ignores unknown events (Push Hook, Pipeline Hook)', () => {
    expect(routeEvent('Push Hook', {}).kind).toBe('ignore');
    expect(routeEvent('Pipeline Hook', { object_attributes: { action: 'open' } }).kind).toBe(
      'ignore',
    );
  });
});
