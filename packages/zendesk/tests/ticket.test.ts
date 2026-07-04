import { describe, it, expect } from 'vitest';
import {
  buildContext,
  contextNote,
  type TicketComment,
  type TicketInput,
} from '../src/ticket';

/** N comments, oldest→newest, each `perComment` chars of body. */
function comments(n: number, perComment: number): TicketComment[] {
  return Array.from({ length: n }, (_, i) => ({
    value: `c${i + 1}:` + 'x'.repeat(perComment),
    author: { name: i % 2 === 0 ? 'Customer' : 'Agent' },
    public: true,
    createdAt: `2026-01-0${(i % 9) + 1}T00:00:00Z`,
  }));
}

function input(over: Partial<TicketInput> = {}): TicketInput {
  return {
    subject: 'Login fails after password reset',
    requesterName: 'Ada Lovelace',
    comments: [],
    ...over,
  };
}

describe('buildContext — header', () => {
  it('always includes the subject and requester', () => {
    const ctx = buildContext(input({ comments: comments(1, 10) }));
    expect(ctx.text).toContain('Subject: Login fails after password reset');
    expect(ctx.text).toContain('Requester: Ada Lovelace');
  });

  it('handles a missing subject and requester honestly', () => {
    const ctx = buildContext(input({ subject: '  ', requesterName: '', comments: [] }));
    expect(ctx.text).toContain('Subject: (none)');
    expect(ctx.text).toContain('Requester: (unknown)');
  });
});

describe('buildContext — comment extraction', () => {
  it('empty thread → no comments, not truncated', () => {
    const ctx = buildContext(input({ comments: [] }));
    expect(ctx.totalComments).toBe(0);
    expect(ctx.includedComments).toBe(0);
    expect(ctx.truncated).toBe(false);
  });

  it('labels author and visibility per comment', () => {
    const ctx = buildContext(
      input({
        comments: [
          { value: 'hi there', author: { name: 'Ada' }, public: true },
          { value: 'internal thoughts', author: { name: 'Agent' }, public: false },
        ],
      }),
    );
    expect(ctx.text).toContain('[Ada · public reply]');
    expect(ctx.text).toContain('hi there');
    expect(ctx.text).toContain('[Agent · internal note]');
    expect(ctx.text).toContain('internal thoughts');
  });

  it('names an unknown author "Unknown"', () => {
    const ctx = buildContext(input({ comments: [{ value: 'anon', author: null, public: true }] }));
    expect(ctx.text).toContain('[Unknown · public reply]');
  });

  it('skips empty-bodied comments (they do not count as included)', () => {
    const ctx = buildContext(
      input({
        comments: [
          { value: '   ', author: { name: 'A' }, public: true },
          { value: 'real content', author: { name: 'B' }, public: true },
        ],
      }),
    );
    expect(ctx.totalComments).toBe(2); // both are in the thread
    expect(ctx.includedComments).toBe(1); // only the non-empty one carried text
    expect(ctx.truncated).toBe(false); // no NON-EMPTY comment was dropped
    expect(ctx.text).toContain('real content');
  });

  it('preserves oldest→newest reading order for the model', () => {
    const ctx = buildContext(input({ comments: comments(3, 20) }), 10_000);
    const first = ctx.text.indexOf('c1:');
    const second = ctx.text.indexOf('c2:');
    const third = ctx.text.indexOf('c3:');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });
});

describe('buildContext — truncation (newest-first)', () => {
  it('small thread fits whole → not truncated, covers every comment', () => {
    const ctx = buildContext(input({ comments: comments(3, 100) }), 10_000);
    expect(ctx.truncated).toBe(false);
    expect(ctx.includedComments).toBe(3);
  });

  it('drops the OLDEST comments first and marks truncated', () => {
    // 10 comments × ~1000 chars, small budget → only the newest few fit.
    const ctx = buildContext(input({ comments: comments(10, 1000) }), 3500);
    expect(ctx.truncated).toBe(true);
    expect(ctx.includedComments).toBeLessThan(10);
    expect(ctx.includedComments).toBeGreaterThan(0);
    // The newest comment (c10) must survive; the oldest (c1) must be dropped.
    expect(ctx.text).toContain('c10:');
    expect(ctx.text).not.toContain('c1:x');
    expect(ctx.text.length).toBeLessThanOrEqual(3500);
  });

  it('always includes the most recent comment, hard-cutting an oversized one', () => {
    const ctx = buildContext(input({ subject: 's', requesterName: 'r', comments: comments(2, 60_000) }), 1000);
    expect(ctx.includedComments).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('c2:'); // the newest comment's body, hard-cut
    expect(ctx.text.length).toBeLessThanOrEqual(1000);
  });

  it('uses a 48k default budget', () => {
    // 100 comments × 1000 chars = ~100k > 48k default → truncated.
    const ctx = buildContext(input({ comments: comments(100, 1000) }));
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBeLessThanOrEqual(48_000);
  });
});

describe('contextNote (honest scope)', () => {
  it('says full thread when nothing was dropped', () => {
    const note = contextNote(buildContext(input({ comments: comments(2, 50) }), 10_000));
    expect(note.toLowerCase()).toContain('full ticket thread');
    expect(note).toContain('2 comments');
  });

  it('singular "comment" for a single-comment thread', () => {
    const note = contextNote(buildContext(input({ comments: comments(1, 50) }), 10_000));
    expect(note).toContain('1 comment');
    expect(note).not.toContain('1 comments');
  });

  it('names the count and warns when truncated', () => {
    const note = contextNote(buildContext(input({ comments: comments(10, 1000) }), 3500));
    expect(note.toLowerCase()).toContain('most recent');
    expect(note).toMatch(/\d+ most recent of 10 comments/);
  });

  it('flags a ticket with no comments', () => {
    const note = contextNote(buildContext(input({ comments: [] })));
    expect(note.toLowerCase()).toContain('no comments yet');
  });
});
